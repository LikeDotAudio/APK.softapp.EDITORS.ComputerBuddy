// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* networkPanel.js — the "On the network" column: the real computers on the bus.

   SDK: window.APKContracts (vendor/apk-contracts/apk-contracts.global.js) gives
   the topic builders and the presence rule. API: window.APKBus
   (/FrontEnd/shared/apk-bus.js, the shell's one softapp bus helper) picks the
   broker and reuses the OS shell's session when framed. No topic is written
   by hand here; no broker is guessed. No helper or no broker: the panel says
   so and the editor still works on files. */

import { NetworkComputers } from './networkComputers.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TIER_LABEL = { computer: 'computer', likely: 'likely', unsure: 'unsure', not: 'not a computer' };
const SHOW = {
  computers: (m) => m.tier === 'computer' || m.tier === 'likely',
  agents: (m) => m.selfReported,
  unsure: (m) => m.tier !== 'not',
  all: () => true,
};

export class NetworkPanel {
  constructor({ root, onPick, onUpdate }) {
    this.root = root;
    this.onPick = onPick;
    this.onUpdate = onUpdate || (() => {});
    this.list = root.querySelector('#net-list');
    this.status = root.querySelector('#net-status');
    this.why = root.querySelector('#net-why');
    this.filter = root.querySelector('#net-filter');
    this.search = root.querySelector('#net-search');
    this.selected = null;
    this.machines = [];
    this.pending = 0;
    this.filter?.addEventListener('change', () => this.render());
    this.search?.addEventListener('input', () => this.render());
    this.list?.addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (row) this.pick(row.dataset.id);
    });
    setInterval(() => this.refresh(), 15_000);   // trust decays even when the bus is quiet
  }

  async start() {
    const C = window.APKContracts;
    if (!C?.Topics) return this.say('dead', 'SDK missing: vendor/apk-contracts/apk-contracts.global.js did not load.');
    const S = window.APKSoftapp;
    const retry = () => this.start();
    const r = await S.fetchJson(new URL('../config/computer-rules.json', import.meta.url).href, { subject: 'config/computer-rules.json' });
    if (!r.ok) {
      this.say('dead', `Could not read config/computer-rules.json (${r.problem.title}).`);
      S.showProblem(r.problem, {
        fix: ['config/computer-rules.json beside this app says which machines count as computers; restore it from the repo if it is missing or broken.'],
        onRetry: retry,
      });
      return;
    }
    const rules = r.data;
    const strip = (t) => t.replace(/\/#$/, '');
    this.model = new NetworkComputers({
      rules,
      presenceActive: C.discoveryPresenceActive,
      roots: {
        protocols: strip(C.Topics.protocols.wildcard()),
        bareMetal: C.Topics.bareMetal.ROOT,
        discovery: strip(C.Topics.discoveryWildcard()),
      },
    });
    if (!window.APKBus) {
      return this.say('dead', 'No bus here: open Computer Buddy from the APK.audio OS to see the real computers on the network.');
    }
    this.say('kinda', 'Connecting to the bus…');
    let bus;
    try {
      bus = await window.APKBus.connect({ clientId: 'computer-buddy-' + Math.random().toString(16).slice(2) });
    } catch (_) { bus = null; }
    if (!bus) {
      this.say('dead', 'No broker reachable from this page.');
      S.showProblem('broker_unreachable', { subject: 'Network panel', onRetry: retry });
      return;
    }
    this.bus = bus;
    const feed = (topic, text) => { if (this.model.ingest(topic, text)) this.schedule(); this.watchPresence(); };
    this.presenceSubs = new Set();
    bus.subscribe(C.Topics.bareMetal.wildcard(), feed);
    bus.subscribe(C.Topics.protocols.wildcard(), feed);
    this.feed = feed;
    const where = bus.shared ? 'the OS shell’s bus' : (bus.url || 'the bus');
    const up = () => { this.say('good', `Listening to ${where}`); this.render(); };
    const down = () => this.say('dead', `Not connected to ${bus.url || 'a broker'}: retrying. Open Computer Buddy from the APK.audio OS, or set the broker in the OS.`);
    bus.on('connect', up);
    bus.on('close', down);
    if (bus.connected) up(); else this.say('kinda', `Connecting to ${where}…`);
  }

  /* Presence lives at Discovery/{proto}/{id}; one single-level wildcard per protocol actually seen. */
  watchPresence() {
    const C = window.APKContracts;
    for (const proto of this.model.protocolsSeen) {
      if (this.presenceSubs.has(proto)) continue;
      this.presenceSubs.add(proto);
      try { this.bus.subscribe(C.Topics.discoveryWildcard(proto), this.feed); } catch (_) { /* not a valid segment */ }
    }
  }

  schedule() {
    if (this.pending) return;
    this.pending = setTimeout(() => { this.pending = 0; this.refresh(); }, 300);
  }

  refresh() {
    if (!this.model) return;
    this.machines = this.model.machines();
    this.render();
    const sel = this.machines.find((m) => m.id === this.selected);
    if (sel) this.onUpdate(sel, this.model.toBlock(sel));
  }

  pick(id) {
    const m = this.machines.find((x) => x.id === id);
    if (!m) return;
    this.selected = id;
    this.render();
    this.onPick(m, this.model.toBlock(m));
  }

  say(state, text) {
    if (this.status) {
      this.status.dataset.apkState = state;
      this.status.textContent = text;
    }
  }

  render() {
    if (!this.list) return;
    const show = SHOW[this.filter?.value || 'computers'] || SHOW.computers;
    const q = (this.search?.value || '').trim().toLowerCase();
    const rows = this.machines.filter(show).filter((m) => !q
      || [m.name, m.mac, ...m.ips, ...m.vendors, ...m.models].join(' ').toLowerCase().includes(q));
    const n = (t) => this.machines.filter((m) => m.tier === t).length;
    if (this.model && this.bus?.connected) this.say('good', `${n('computer')} computers · ${n('likely')} likely · ${n('unsure')} unsure, live from the bus`);
    this.list.innerHTML = rows.length ? rows.map((m) => `
      <button class="net-row${m.id === this.selected ? ' selected' : ''}" data-id="${esc(m.id)}"
              title="${esc(m.reasons.map((r) => `${r.score > 0 ? '+' : ''}${r.score}  ${r.why}`).join('\n') || 'no evidence either way')}">
        <span class="net-dot" data-apk-state="${m.live.state}"></span>
        <span class="net-main">
          <span class="net-name">${esc(m.name)}</span>
          <span class="net-sub">${esc([m.models[0] || m.vendors[0], m.ips[0], m.mac].filter(Boolean).join(' · '))}</span>
        </span>
        <span class="net-tier tier-${m.tier}">${m.selfReported ? 'reports itself' : TIER_LABEL[m.tier]}</span>
      </button>`).join('')
      : `<div class="net-empty">${this.machines.length ? 'Nothing matches. Widen the filter.' : 'No machines on the bus yet.'}</div>`;
    this.renderWhy();
  }

  renderWhy() {
    if (!this.why) return;
    const m = this.machines.find((x) => x.id === this.selected);
    if (!m) { this.why.innerHTML = '<div class="net-empty">Pick a machine to load it into the editor.</div>'; return; }
    this.why.innerHTML = `
      <div class="why-head"><span class="net-dot" data-apk-state="${m.live.state}"></span>${esc(m.live.why)}</div>
      <div class="why-sub">Why ${esc(TIER_LABEL[m.tier])} (score ${m.score}):</div>
      <ul>${m.reasons.map((r) => `<li><b class="${r.score > 0 ? 'plus' : 'minus'}">${r.score > 0 ? '+' : ''}${r.score}</b> ${esc(r.why)}</li>`).join('') || '<li>no evidence either way</li>'}</ul>`;
  }
}
