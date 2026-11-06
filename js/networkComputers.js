// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* networkComputers.js — THE REAL COMPUTERS ON THE NETWORK, read off the bus.

   No DOM, no bus client: it is fed (topic, text) pairs and answers "which of
   the things the bus knows about are computers, how sure, alive or not, and
   what does each one look like as a computer_node block". networkPanel.js
   wires it to window.APKBus; the tests feed it a capture of the real bus.

   WHERE THE FACTS COME FROM (roots are passed in from APKContracts.Topics, so
   no topic is spelled here):
     System/BareMetal/{target}/…     an agent describing ITSELF — rows of
                                     {node, key, value, unit, last_seen}
                                     (identity/device_manifest, host,
                                     host/filesystem_layout, network/…), and a
                                     MonitorProbes status object. Certain.
     System/BareMetal/{target}/{node}/timeline
                                     the same tables as one post of the last
                                     minute (contracts BareMetalTimeline:
                                     baseline + timed deltas, every 30 s). Folded
                                     into the rows above — each row reads what it
                                     read at the post's `to`, last_seen = `to` —
                                     and kept whole as agent.timeline for history.
                                     The retained tables are restated only on
                                     change (or every few minutes), so the
                                     timeline is what keeps an agent fresh.
     System/Protocols/{proto}/Device/[kind/]{id}/{field}
                                     what a scanner saw: device_class,
                                     manufacturer (the MAC's OUI), model, name,
                                     ips, mac, router, gateway, interface,
                                     state, presence_topic. Circumstantial.
     Discovery/{proto}/{deviceId}    the DiscoveryPresence document; alive or
                                     dead is the contract's own rule
                                     (APKContracts.discoveryPresenceActive).

   IDENTITY is the MAC (or the agent's own name), never an IP: an agent and the
   scanners' sightings of its NICs fold into one machine by MAC.

   WHAT IS A COMPUTER is config/computer-rules.json: every fact adds or takes
   points, the total picks a tier (computer / likely / unsure / not), and every
   point carries its reason so the panel can say why. TRUST DECAYS: a machine
   nobody re-verified within rules.trustMinutes is "kinda", never "good"; one
   that is gone is "dead" (unreachable is dead). */

const MAC_RE = /(?<![0-9a-f])(?<![0-9a-f]{2}[:_-])([0-9a-f]{2})([:_-])([0-9a-f]{2})\2([0-9a-f]{2})\2([0-9a-f]{2})\2([0-9a-f]{2})\2([0-9a-f]{2})(?![:_-]?[0-9a-f])/i;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const HASHY_RE = /^[0-9a-f-]{16,}$/i;

/** A contracts BareMetalTimeline post (baremetal-timeline.ts): told by its shape, not its topic. */
export function isTimeline(doc) {
  return !!doc && typeof doc === 'object' && !Array.isArray(doc)
    && Array.isArray(doc.deltas) && !!doc.baseline && typeof doc.baseline === 'object' && typeof doc.to === 'string';
}

/** The tables at `to`: table → key → {value, unit?, t}, `t` being when that value began (contracts foldTimeline). */
export function foldTimeline(doc) {
  const out = {};
  for (const [table, keys] of Object.entries(doc.baseline || {})) {
    out[table] = {};
    for (const [key, e] of Object.entries(keys || {})) if (e && typeof e === 'object') out[table][key] = { value: e.value ?? null, unit: e.unit, t: doc.from };
  }
  for (const d of doc.deltas) {
    if (!d || !d.table || !d.key) continue;
    const table = (out[d.table] ||= {});
    table[d.key] = { value: d.value ?? null, unit: d.unit ?? table[d.key]?.unit, t: d.t };
  }
  return out;
}

/** The MAC inside any string ("ping_00_07_F5_42_06_A2", "nic:b8:27:eb:…"), as aa:bb:cc:dd:ee:ff, or null. */
export function macIn(s) {
  if (typeof s !== 'string') return null;
  const m = MAC_RE.exec(s);
  return m ? [m[1], m[3], m[4], m[5], m[6], m[7]].join(':').toLowerCase() : null;
}

/** A locally administered (randomised / virtual) MAC: bit 1 of the first octet. */
export function isRandomisedMac(mac) {
  return !!mac && (parseInt(mac.slice(0, 2), 16) & 2) === 2;
}

function lc(s) { return String(s ?? '').toLowerCase(); }
function matchAny(value, list) {
  const v = lc(value);
  return v ? (list || []).find((m) => v.includes(lc(m))) : undefined;
}
function realValue(s) {
  const v = String(s ?? '').trim();
  return v && v !== '-' && v !== 'null' && !v.startsWith('APK:audio') ? v : '';
}
function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { return undefined; }
}
export function ago(ms) {
  if (!Number.isFinite(ms)) return 'never';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
function speedText(value, unit) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n) || n <= 0) return '';
  const mbps = /g/i.test(unit || '') ? n * 1000 : n;
  return mbps >= 1000 ? `${+(mbps / 1000).toFixed(1)} Gbps` : `${mbps} Mbps`;
}

/* Union-find over identity keys: an agent, its MACs and every sighting of them. */
class Groups {
  constructor() { this.parent = new Map(); }
  find(k) {
    if (!this.parent.has(k)) this.parent.set(k, k);
    let r = k;
    while (this.parent.get(r) !== r) r = this.parent.get(r);
    this.parent.set(k, r);
    return r;
  }
  union(keys) {
    const ks = keys.filter(Boolean);
    if (!ks.length) return null;
    const r = this.find(ks[0]);
    for (const k of ks.slice(1)) this.parent.set(this.find(k), r);
    return r;
  }
}

export class NetworkComputers {
  /**
   * @param {object} o
   * @param {object} o.rules            config/computer-rules.json
   * @param {object} o.roots            { protocols, bareMetal, discovery } topic prefixes (from APKContracts.Topics)
   * @param {function} o.presenceActive APKContracts.discoveryPresenceActive
   * @param {function} [o.now]
   */
  constructor({ rules, roots, presenceActive, now = () => Date.now() }) {
    this.rules = rules;
    this.roots = roots;
    this.presenceActive = presenceActive;
    this.now = now;
    this.virtualRe = new RegExp(rules.virtualInterfacesRe || '^$', 'i');
    this.nameRe = rules.nameHintsRe ? new RegExp(rules.nameHintsRe.pattern, 'i') : null;
    this.ignore = new Set(rules.ignoreProtocols || []);
    this.agents = new Map();    // node -> { node, target, sections: Map<section, Map<key,row>>, status }
    this.hosts = new Map();     // proto/kind/id -> { proto, kind, id, fields }
    this.presence = new Map();  // deviceId -> { proto, deviceId, doc }
    this.protocolsSeen = new Set();
  }

  /** Feed one bus message. Returns true when it changed anything. */
  ingest(topic, text) {
    const { protocols, bareMetal, discovery } = this.roots;
    if (topic.startsWith(protocols + '/')) return this._protocol(topic.slice(protocols.length + 1).split('/'), text);
    if (topic.startsWith(bareMetal + '/')) return this._bareMetal(topic.slice(bareMetal.length + 1).split('/'), text);
    if (topic.startsWith(discovery + '/')) return this._presence(topic.slice(discovery.length + 1).split('/'), text);
    return false;
  }

  _protocol(seg, text) {
    const proto = seg[0];
    if (!proto || this.ignore.has(proto)) return false;
    this.protocolsSeen.add(proto);
    const d = seg.indexOf('Device');
    if (d < 0) return false;
    const tail = seg.slice(d + 1);
    let kind = '', id, field;
    if (tail.length === 2) [id, field] = tail;
    else if (tail.length === 3) [kind, id, field] = tail;
    else return false;
    // nic/Device/Interface is the scanning host's own NICs — its agent describes those.
    if (proto === 'nic' && kind === 'Interface') return false;
    const key = `${proto}/${kind}/${id}`;
    let h = this.hosts.get(key);
    if (text === '' || text === undefined) {
      if (h) delete h.fields[field];
      return !!h;
    }
    if (!h) { h = { proto, kind, id, fields: {} }; this.hosts.set(key, h); }
    h.fields[field] = text;
    return true;
  }

  _bareMetal(seg, text) {
    const target = seg[0];
    const doc = parseJson(text);
    if (isTimeline(doc)) return this._timeline(seg, doc);
    if (Array.isArray(doc)) {
      let changed = false;
      for (const row of doc) {
        if (!row || typeof row !== 'object' || !row.node || !row.key) continue;
        const at = seg.indexOf(row.node);
        const section = (at >= 0 ? seg.slice(at + 1) : seg.slice(1)).join('/') || '-';
        const a = this._agent(row.node, target);
        if (!a.sections.has(section)) a.sections.set(section, new Map());
        a.sections.get(section).set(row.key, row);
        changed = true;
      }
      return changed;
    }
    if (doc && typeof doc === 'object') {
      // A status / heartbeat object: MonitorProbes/{kind}/{node}/status, ESP32/{node}/identity/heartbeat.
      const node = doc.hostname || doc.node || (target === 'MonitorProbes' ? seg[2] : seg[1]);
      if (!node) return false;
      const a = this._agent(node, target);
      if (target === 'MonitorProbes') a.probeKind = seg[1];
      a.status = doc;
      return true;
    }
    return false;
  }

  /** A BareMetalTimeline post: fold baseline + deltas to the tables at `to`. A row already
   *  holding a newer reading (a retained table restated after this post) is left alone. */
  _timeline(seg, doc) {
    const node = doc.node || seg[1];
    if (!node) return false;
    const a = this._agent(node, seg[0]);
    const to = Date.parse(doc.to);
    if (a.timeline && Date.parse(a.timeline.to) > to) return false;
    a.timeline = doc;
    for (const [section, rows] of Object.entries(foldTimeline(doc))) {
      if (!a.sections.has(section)) a.sections.set(section, new Map());
      const sec = a.sections.get(section);
      for (const [key, r] of Object.entries(rows)) {
        const had = sec.get(key);
        if (had && Date.parse(had.last_seen) > to) continue;
        if (r.value === null && r.t !== doc.from) { sec.delete(key); continue; }
        sec.set(key, { node, key, value: r.value, ...(r.unit ? { unit: r.unit } : {}), last_seen: doc.to, since: r.t });
      }
    }
    return true;
  }

  _agent(node, target) {
    let a = this.agents.get(node);
    if (!a) { a = { node, target, sections: new Map(), status: null }; this.agents.set(node, a); }
    // A machine seen both as a probe and as a PI keeps the more specific target.
    if (target !== 'MonitorProbes') a.target = target;
    return a;
  }

  _presence(seg, text) {
    if (seg.length !== 2 || seg[0].startsWith('_') || this.ignore.has(seg[0])) return false;
    const deviceId = seg[1];
    if (text === '' || text === undefined) return this.presence.delete(deviceId);
    const doc = parseJson(text);
    if (!doc || typeof doc !== 'object') return false;
    this.presence.set(deviceId, { proto: seg[0], deviceId, doc });
    return true;
  }

  /* ---------- the view ---------- */

  /** Every machine the bus knows, merged by identity, classified and timed. */
  machines() {
    const g = new Groups();
    const agentKey = new Map();
    for (const a of this.agents.values()) {
      const keys = [`agent:${a.node}`];
      const man = a.sections.get('identity/device_manifest');
      const mac = macIn(man?.get('mac')?.value) || macIn(a.status?.mac);
      if (mac) keys.push(mac);
      for (const iface of this._agentInterfaces(a)) if (!iface.virtual && iface.mac) keys.push(iface.mac);
      agentKey.set(a.node, g.union(keys));
    }
    const hostKey = new Map();
    for (const [k, h] of this.hosts) {
      const mac = macIn(h.fields.mac) || macIn(h.fields.serial) || macIn(h.id);
      hostKey.set(k, g.union([`host:${k}`, mac]));
    }
    const presKey = new Map();
    for (const [id, p] of this.presence) presKey.set(id, g.union([`presence:${id}`, macIn(id)]));

    const out = new Map();
    const bucket = (root) => {
      const r = g.find(root);
      if (!out.has(r)) out.set(r, { agent: null, hosts: [], presence: [] });
      return out.get(r);
    };
    for (const a of this.agents.values()) bucket(agentKey.get(a.node)).agent = a;
    for (const [k, h] of this.hosts) bucket(hostKey.get(k)).hosts.push(h);
    for (const [id, p] of this.presence) {
      const r = g.find(presKey.get(id));
      if (out.has(r)) out.get(r).presence.push(p);   // presence alone is not a machine
    }

    const list = [];
    for (const raw of out.values()) {
      if (!raw.agent && !raw.hosts.length) continue;
      list.push(this._describe(raw));
    }
    const tierRank = { computer: 0, likely: 1, unsure: 2, not: 3 };
    const liveRank = { good: 0, kinda: 1, dead: 2 };
    list.sort((x, y) => tierRank[x.tier] - tierRank[y.tier]
      || liveRank[x.live.state] - liveRank[y.live.state]
      || x.name.localeCompare(y.name));
    return list;
  }

  _describe(raw) {
    const macs = new Set();
    const ips = new Set();
    const vendors = new Set();
    const models = new Set();
    const names = [];
    const a = raw.agent;
    const man = a?.sections.get('identity/device_manifest');
    if (a) {
      const m = macIn(man?.get('mac')?.value) || macIn(a.status?.mac);
      if (m) macs.add(m);
      names.push(man?.get('hostname')?.value || a.status?.hostname || a.node);
      if (man?.get('model')?.value) models.add(man.get('model').value);
      for (const i of this._agentInterfaces(a)) if (!i.virtual && i.ip) ips.add(i.ip);
    }
    for (const h of raw.hosts) {
      const f = h.fields;
      const m = macIn(f.mac) || macIn(f.serial) || macIn(h.id);
      if (m) macs.add(m);
      for (const ip of String(f.ips || '').split(/[\s,]+/)) if (IPV4_RE.test(ip)) ips.add(ip);
      const noteIp = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(f.notes || '');
      if (noteIp) ips.add(noteIp[1]);
      if (realValue(f.manufacturer)) vendors.add(realValue(f.manufacturer));
      if (realValue(f.model)) models.add(realValue(f.model));
      const n = realValue(f.name);
      if (n && !IPV4_RE.test(n) && !macIn(n) && !HASHY_RE.test(n) && !n.startsWith(h.proto + '_')) names.push(n.replace(/_/g, ' '));
    }
    const mac = [...macs][0] || '';
    for (const h of raw.hosts) {
      if (!macIn(h.id) && !HASHY_RE.test(h.id) && !IPV4_RE.test(h.id)) names.push(h.id.replace(/_/g, ' '));
    }
    const name = names[0]
      || (vendors.size ? `${[...vendors][0].replace(/[,.]? (inc|co|ltd|corp|corporation|gmbh|ag)\b.*$/i, '')} ${mac.slice(-5)}`.trim() : '')
      || [...ips][0] || mac || 'unnamed';
    const id = a ? `agent:${a.node}` : (mac || `host:${raw.hosts[0].proto}/${raw.hosts[0].kind}/${raw.hosts[0].id}`);

    const verdict = this._classify(raw, { names, vendors, macs, models });
    return {
      id, name, mac, macs: [...macs], ips: [...ips], vendors: [...vendors], models: [...models],
      agent: a ? { node: a.node, target: a.target, probe: man?.get('probe')?.value || a.status?.probe || '' } : null,
      protocols: [...new Set(raw.hosts.map((h) => h.proto))],
      ...verdict,
      live: this._live(raw),
      raw,
    };
  }

  _classify(raw, { names, vendors, macs, models }) {
    const R = this.rules;
    const reasons = new Map();        // one entry per distinct reason: repeated sightings do not add up
    const add = (score, why) => { if (score && !reasons.has(why)) reasons.set(why, score); };
    const a = raw.agent;
    if (a) {
      const not = R.agent?.notComputerTargets?.[a.target];
      if (not) add(-100, not);
      else add(R.agent?.score ?? 100, `${R.agent?.why || 'reports itself'}${a.target ? ` (${a.target})` : ''}`);
    }
    for (const h of raw.hosts) {
      const f = h.fields;
      const cls = realValue(f.device_class);
      if (cls) {
        const yes = matchAny(cls, R.computerClasses?.match);
        const no = matchAny(cls, R.notComputerClasses?.match);
        if (yes) add(R.computerClasses.score, `${h.proto} calls it a ${cls}`);
        else if (no) add(R.notComputerClasses.score, `${h.proto} calls it a ${cls}`);
      }
      if (h.proto === 'dnssd' && h.kind) {
        const svc = h.kind.replace(/__/g, '._');
        const hit = matchAny(svc, R.computerServices?.match);
        if (hit) add(R.computerServices.score, `advertises ${svc}`);
      }
      if (/^yes$/i.test(f.router || '') || /^yes$/i.test(f.gateway || '')) add(R.routerScore, 'is the router / gateway');
      const via = f.interface || (/\bon (\S+)/.exec(f.notes || '') || [])[1];
      if (via && this.virtualRe.test(via)) add(R.virtualInterfaceScore, `seen only on ${via} (a container, not a machine)`);
    }
    for (const v of vendors) {
      const yes = (R.computerVendors || []).find((r) => lc(v).includes(lc(r.match)));
      if (yes) add(yes.score, `MAC vendor ${v} builds computers`);
      else if (matchAny(v, R.notComputerVendors?.match)) add(R.notComputerVendors.score, `MAC vendor ${v} builds appliances, not computers`);
    }
    const notModel = R.notComputerModelsRe ? new RegExp(R.notComputerModelsRe.pattern, 'i') : null;
    for (const m of models) {
      if (/raspberry pi/i.test(m)) add(70, `model ${m}`);
      else if (notModel && notModel.test(m)) add(R.notComputerModelsRe.score, `model ${m} is an appliance`);
    }
    if (this.nameRe) for (const n of names) if (this.nameRe.test(n)) add(R.nameHintsRe.score, `named like a computer (${n})`);
    const positive = [...reasons.values()].some((s) => s > 0);
    if (!positive && !a && [...macs].some(isRandomisedMac)) add(R.randomisedMacScore, 'private (randomised) MAC, as phones and laptops use');

    const score = [...reasons.values()].reduce((s, v) => s + v, 0);
    const t = R.tiers || { computer: 60, likely: 30, unsure: -29 };
    let tier = score >= t.computer ? 'computer' : score >= t.likely ? 'likely' : score >= t.unsure ? 'unsure' : 'not';
    if (a && !R.agent?.notComputerTargets?.[a.target]) tier = 'computer';
    return {
      score, tier, selfReported: !!a && tier === 'computer',
      reasons: [...reasons].map(([why, s]) => ({ why, score: s })).sort((x, y) => Math.abs(y.score) - Math.abs(x.score)),
    };
  }

  /** good / kinda / dead, with the evidence. The freshest timed fact wins; trust decays after rules.trustMinutes. */
  _live(raw) {
    const now = this.now();
    const trustMs = (this.rules.trustMinutes ?? 5) * 60_000;
    const facts = [];
    const a = raw.agent;
    if (a) {
      let newest = NaN;
      for (const sec of a.sections.values()) for (const row of sec.values()) {
        const t = Date.parse(row.last_seen);
        if (Number.isFinite(t) && !(t <= newest)) newest = t;
      }
      const offline = a.status && /offline|dead|lost/i.test(String(a.status.status || ''));
      if (Number.isFinite(newest)) {
        const age = now - newest;
        facts.push(age <= trustMs
          ? { t: newest, state: 'good', why: `its agent reported ${ago(age)}` }
          : { t: newest, state: offline ? 'dead' : 'kinda', why: offline
            ? `its agent went offline (${a.status.reason || a.status.status}); last report ${ago(age)}`
            : `its agent last reported ${ago(age)}, not re-verified since` });
      } else if (offline) {
        facts.push({ t: 0, state: 'dead', why: `its agent is offline (${a.status.reason || a.status.status})` });
      }
    }
    for (const p of raw.presence) {
      const active = this.presenceActive ? this.presenceActive(p.doc) : null;
      if (active === null) continue;
      const seen = Date.parse(p.doc.lastDiscovered || p.doc.lastOnline);
      const age = now - seen;
      if (active) facts.push(age <= trustMs
        ? { t: seen, state: 'good', why: `${p.proto} verified it ${ago(age)}` }
        : { t: seen, state: 'kinda', why: `${p.proto} last verified it ${ago(age)}` });
      else facts.push({ t: Date.parse(p.doc.lastOffline) || 0, state: 'dead', why: `${p.proto} lost it ${ago(now - Date.parse(p.doc.lastOffline))}` });
    }
    if (facts.length) {
      facts.sort((x, y) => y.t - x.t);
      return facts[0];
    }
    for (const h of raw.hosts) {
      const s = lc(h.fields.state);
      if (s === 'reachable' || s === 'permanent') return { t: NaN, state: 'good', why: `${h.proto}: ${s}` };
      if (s === 'failed' || s === 'incomplete') return { t: NaN, state: 'dead', why: `${h.proto}: ${s}` };
    }
    return { t: NaN, state: 'kinda', why: 'seen on the network, never verified' };
  }

  _agentInterfaces(a) {
    const sec = a.sections.get('network/interfaces_and_vlans');
    if (!sec) return [];
    const by = new Map();
    for (const row of sec.values()) {
      const dot = row.key.lastIndexOf('.');
      if (dot <= 0) continue;
      const name = row.key.slice(0, dot);
      const attr = row.key.slice(dot + 1);
      if (!by.has(name)) by.set(name, { name });
      const o = by.get(name);
      o[attr] = row.value;
      if (attr === 'speed') o.speedUnit = row.unit;
    }
    return [...by.values()].map((o) => ({
      name: o.name,
      ip: o.ipv4 ? String(o.ipv4).split('/')[0] : '',
      subnet: o.netmask || (o.ipv4 && String(o.ipv4).includes('/') ? '/' + String(o.ipv4).split('/')[1] : ''),
      mac: macIn(o.mac) || '',
      speed: speedText(o.speed, o.speedUnit),
      state: o.state || '',
      vlan: o.vlan !== undefined && o.vlan !== null ? String(o.vlan) : '',
      virtual: this.virtualRe.test(o.name),
    }));
  }

  /** The machine as a computer_node block — what it reports, '' where nobody said. */
  toBlock(m) {
    const a = m.raw.agent;
    const val = (section, key) => a?.sections.get(section)?.get(key);
    const v = (section, key) => { const r = val(section, key); return r ? r.value : undefined; };
    const model = m.models[0] || '';
    const formFactor = this._formFactor(m, model);

    let os = '', cpu = '', ram = '', storage = '', interfaces = [], services = [];
    if (a) {
      const M = 'identity/device_manifest';
      os = [v(M, 'os.pretty_name') || v(M, 'os.name') || v(M, 'os.system'), v(M, 'os.release'), v(M, 'os.architecture') && `(${v(M, 'os.architecture')})`]
        .filter(Boolean).join(' ');
      const cores = v('host', 'cpu.cores');
      cpu = [v(M, 'cpu.model') || v('host', 'cpu.model'), cores !== undefined && `${cores} cores`].filter(Boolean).join(' · ');
      const total = val('host', 'memory.total') || val(M, 'memory.total');
      const used = val('host', 'memory.used');
      ram = [total && `${total.value} ${total.unit || ''}`.trim(), used && `${used.value}${used.unit || ''} used`].filter(Boolean).join(' · ');
      const fs = a.sections.get('host/filesystem_layout');
      if (fs) {
        const mounts = new Map();
        for (const row of fs.values()) {
          const dot = row.key.lastIndexOf('.');
          const mount = row.key.slice(0, dot), attr = row.key.slice(dot + 1);
          if (!mounts.has(mount)) mounts.set(mount, {});
          mounts.get(mount)[attr] = row;
        }
        storage = [...mounts].map(([mnt, o]) => [mnt, o.size && `${o.size.value} ${o.size.unit || ''}`.trim(), o.fstype?.value, o.used && `${o.used.value}${o.used.unit || ''} used`]
          .filter(Boolean).join(' ')).join(', ');
      }
      interfaces = this._agentInterfaces(a).filter((i) => !i.virtual)
        .map((i) => ({ name: i.name, ip: i.ip, subnet: i.subnet, mac: i.mac, speed: i.speed, role: i.state ? `link ${i.state}` : '', vlan: i.vlan }));
      const probe = [v(M, 'probe') || a.status?.probe, v(M, 'probe_version')].filter(Boolean).join(' ');
      if (probe) services.push(`APK agent: ${probe}`);
      for (const s of a.sections.keys()) if (s !== M && s !== '-') services.push(`agent ${s.split('/').pop()}`);
    }
    if (!interfaces.length) {
      interfaces = m.macs.map((mac, i) => ({ name: `nic${i}`, ip: m.ips[i] || (i === 0 ? m.ips[0] || '' : ''), subnet: '', mac, speed: '', role: '', vlan: '' }));
    }
    for (const h of m.raw.hosts) if (h.proto === 'dnssd' && h.kind) services.push(h.kind.replace(/__/g, '._'));

    return {
      type: 'computer_node',
      id: `compute_${lc(m.name).replace(/[^a-z0-9]/g, '_')}`,
      hostname: m.name,
      formFactor,
      os, cpu, ram, gpu: '', storage, powerWatts: '',
      model,
      vendor: m.vendors[0] || '',
      interfaces,
      services: [...new Set(services)],
      source: {
        kind: 'network',
        identity: m.mac || m.id,
        tier: m.tier,
        score: m.score,
        reasons: m.reasons,
        live: { state: m.live.state, why: m.live.why },
        protocols: m.protocols,
      },
    };
  }

  _formFactor(m, model) {
    const R = this.rules;
    const text = [model, ...m.vendors, m.name].join(' ');
    for (const h of R.formFactorHintsRe || []) if (new RegExp(h.pattern, 'i').test(text)) return h.formFactor;
    for (const v of m.vendors) {
      const r = (R.computerVendors || []).find((x) => lc(v).includes(lc(x.match)));
      if (r?.formFactor) return r.formFactor;
    }
    return 'Unknown';
  }
}
