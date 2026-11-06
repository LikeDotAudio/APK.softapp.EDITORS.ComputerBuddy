// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* computerIfc.js — THE COMPUTE NODE BLOCK'S .IFC TWIN (ROAD-3583). Save Model writes the native block
   (ComputerNodeModel.toBlock) AND this IFC4X3_ADD2 file through APKSoftapp.saveModel; Open Model reads it
   back to the same block. Written with the contracts STEP codec (vendor/apk-contracts/apk-ifc.js,
   scripts/vendor-ifc.mjs), no IfcOpenShell in the page. Byte-deterministic: the same block writes the
   same file.

     IfcProject ─ IfcSite ─ IfcBuilding ─ IfcBuildingStorey 'Computers'   units: mm, W
     the machine  IfcCommunicationsAppliance COMPUTER (Name = hostname, Tag = the block id), contained in
                  the storey, typed by an IfcCommunicationsApplianceType COMPUTER named for its form
                  factor. GlobalId inst/mac:<mac> when the network gave it a MAC identity (the contracts role
                  grammar; APK_Identity IdentityKey + MacAddress), else the block's own. Never an IP.
                  Pset_ElectricalDeviceCommon.NominalPowerConsumption (W) when the power is a number;
                  APK_AVDevice.RackUnits when the form factor names a U count;
                  APK_Computer: FormFactor, OperatingSystem, Processor, Memory, Graphics, Storage (as the
                  editor words them), Services, Source (who said so: 'network' for a machine taken live)
     a NIC        IfcDistributionPort CABLE DATA SOURCEANDSINK nested in order (IfcRelNests), Name = the
                  interface name; Pset_DistributionPortCommon.PortNumber; Pset_DistributionPortTypeCable
                  .Protocols when its role names a media transport; APK_NetworkPort IpAddress, SubnetMask,
                  MacAddress, LinkSpeed, Role, Vlan (as configured or reported: addressing, never identity)
   Every APK_ set is declared in DATABASE.server.BIM SRC/tools/ifc (apk_psets.py + apk_psets_editors.py).
   A live machine's tier, score and live state are not written: nothing unverified is stored as truth. */

import { entitiesByType, enumv, getPsets, ifcGuid, isRef, parseStep, ports as portsOfEntity, real, ref, typed, writeStep } from '../vendor/apk-contracts/apk-ifc.js';

export const COMPUTER_IFC_SCHEMA = 'IFC4X3_ADD2';
const STAMP = '1970-01-01T00:00:00';   // fixed: the file is a function of the block, never of the clock

const str = (v) => (v == null ? '' : String(v));
const label = (s) => typed('IFCLABEL', String(s));
const ident = (s) => typed('IFCIDENTIFIER', String(s));
const int = (n) => typed('IFCINTEGER', Math.trunc(n));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const MAC_RE = /^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i;
const macOf = (s) => (MAC_RE.test(str(s).trim()) ? str(s).trim().toLowerCase().replace(/-/g, ':') : '');

/** The media transports a NIC's role names (Pset_DistributionPortTypeCable.Protocols); [] when none. */
export function protocolsOf(role) {
  const t = String(role || '').toLowerCase();
  const out = [];
  if (/dante/.test(t)) out.push('Dante');
  if (/aes67/.test(t)) out.push('AES67');
  if (/2110/.test(t)) out.push('SMPTE ST 2110');
  if (/\bndi\b/.test(t)) out.push('NDI');
  if (/\bptp\b/.test(t)) out.push('PTPv2');
  return out;
}

const FIELDS = [   // APK_Computer property ← block field
  ['FormFactor', 'formFactor'], ['OperatingSystem', 'os'], ['Processor', 'cpu'],
  ['Memory', 'ram'], ['Graphics', 'gpu'], ['Storage', 'storage'],
];
const NIC = [      // APK_NetworkPort property ← interface field
  ['IpAddress', 'ip'], ['SubnetMask', 'subnet'], ['MacAddress', 'mac'], ['LinkSpeed', 'speed'], ['Role', 'role'], ['Vlan', 'vlan'],
];

class Writer {
  constructor() { this.entities = []; }
  add(type, ...args) {
    const id = this.entities.length + 1;
    this.entities.push({ id, type, args });
    return ref(id);
  }
}

const stemOf = (name) => String(name || 'computer_node').replace(/\.(ifc|json)$/i, '');

/** The compute node block (toBlock) as IFC4X3_ADD2 STEP text. `name` is the file stem. */
export function computerToIfc(block, { name } = {}) {
  const b = block || {};
  const nics = Array.isArray(b.interfaces) ? b.interfaces : [];
  const stem = stemOf(name || b.hostname);
  const blockId = str(b.id) || stem;
  const W = new Writer();
  const P = ifcGuid('computer', blockId);
  const rel = (...roles) => ifcGuid('rel', ...roles);

  const person = W.add('IFCPERSON', null, 'APK.audio', null, null, null, null, null, null);
  const org = W.add('IFCORGANIZATION', null, 'APK.audio', 'Computer editor', null, null);
  const po = W.add('IFCPERSONANDORGANIZATION', person, org, null);
  const app = W.add('IFCAPPLICATION', org, '1', 'APK.audio computer editor', 'EDITORS.ComputerBuddy');
  const oh = W.add('IFCOWNERHISTORY', po, app, null, null, null, null, null, 0);
  const mm = W.add('IFCSIUNIT', { kind: 'derived' }, enumv('LENGTHUNIT'), enumv('MILLI'), enumv('METRE'));
  const watt = W.add('IFCSIUNIT', { kind: 'derived' }, enumv('POWERUNIT'), null, enumv('WATT'));
  const units = W.add('IFCUNITASSIGNMENT', [mm, watt]);
  const origin = W.add('IFCAXIS2PLACEMENT3D', W.add('IFCCARTESIANPOINT', [real(0), real(0), real(0)]), null, null);
  const ctx = W.add('IFCGEOMETRICREPRESENTATIONCONTEXT', null, 'Model', 3, real(1e-5), origin, null);
  const project = W.add('IFCPROJECT', P, oh, str(b.hostname) || stem, 'Computer editor: one compute node', null, null, null, [ctx], units);
  const sitePl = W.add('IFCLOCALPLACEMENT', null, origin);
  const buildingPl = W.add('IFCLOCALPLACEMENT', sitePl, origin);
  const storeyPl = W.add('IFCLOCALPLACEMENT', buildingPl, origin);
  const siteGid = ifcGuid('site', P, 'site');
  const buildingGid = ifcGuid('site', P, 'building');
  const storeyGid = ifcGuid('site', P, 'storey');
  const site = W.add('IFCSITE', siteGid, oh, 'Site', null, null, sitePl, null, null, enumv('ELEMENT'), null, null, null, null, null);
  const building = W.add('IFCBUILDING', buildingGid, oh, 'Building', null, null, buildingPl, null, null, enumv('ELEMENT'), null, null, null);
  const storey = W.add('IFCBUILDINGSTOREY', storeyGid, oh, 'Computers', null, null, storeyPl, null, null, enumv('ELEMENT'), real(0));
  W.add('IFCRELAGGREGATES', rel('aggregates', P), oh, null, null, project, [site]);
  W.add('IFCRELAGGREGATES', rel('aggregates', siteGid), oh, null, null, site, [building]);
  W.add('IFCRELAGGREGATES', rel('aggregates', buildingGid), oh, null, null, building, [storey]);

  const defs = [];
  const prop = (n, v) => (v == null || v === '' ? null : W.add('IFCPROPERTYSINGLEVALUE', n, null, v, null));
  const listProp = (n, vs) => (vs.length ? W.add('IFCPROPERTYLISTVALUE', n, null, vs, null) : null);
  const pset = (setName, ownerGid, props, owner) => {
    const list = props.filter(Boolean);
    if (!list.length) return;
    const ps = W.add('IFCPROPERTYSET', ifcGuid('rel', 'pset', ownerGid, setName), oh, setName, null, list);
    defs.push([ifcGuid('rel', 'props', ownerGid, setName), owner, ps]);
  };

  // ---- the type and the machine
  const typeGid = ifcGuid('decl', P, 'type');
  const type = W.add('IFCCOMMUNICATIONSAPPLIANCETYPE', typeGid, oh, str(b.formFactor) || 'Computer', null, null, null, null, null, null, enumv('COMPUTER'));
  W.add('IFCRELDECLARES', rel('declares', P), oh, null, null, project, [type]);
  const src = b.source && typeof b.source === 'object' ? b.source : null;
  const mac = macOf(src && src.identity);
  const pcGid = mac ? ifcGuid('inst', `mac:${mac}`) : ifcGuid('decl', P, 'computer');
  const pc = W.add('IFCCOMMUNICATIONSAPPLIANCE', pcGid, oh, str(b.hostname) || stem, null, null, W.add('IFCLOCALPLACEMENT', storeyPl, origin), null, blockId, enumv('COMPUTER'));
  W.add('IFCRELDEFINESBYTYPE', rel('type', pcGid), oh, null, null, [pc], type);
  W.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', rel('contains', storeyGid), oh, null, null, [pc], storey);
  const watts = num(b.powerWatts);
  if (watts != null) pset('Pset_ElectricalDeviceCommon', pcGid, [prop('NominalPowerConsumption', typed('IFCPOWERMEASURE', real(watts)))], pc);
  const ru = /(\d+)\s*U\b/i.exec(str(b.formFactor));
  if (ru && Number(ru[1]) > 0) pset('APK_AVDevice', pcGid, [prop('RackUnits', int(Number(ru[1])))], pc);
  const services = (Array.isArray(b.services) ? b.services : []).map(str).filter(Boolean);
  pset('APK_Computer', pcGid, [
    ...FIELDS.map(([p, f]) => prop(p, str(b[f]) ? label(b[f]) : null)),
    listProp('Services', services.map(label)),
    prop('Source', src && src.kind ? label(src.kind) : null),
  ], pc);
  if (mac) pset('APK_Identity', pcGid, [prop('IdentityKey', ident(`mac:${mac}`)), prop('MacAddress', ident(mac))], pc);

  // ---- its interfaces, in order
  const ports = nics.map((n, i) => {
    const gid = ifcGuid('decl', P, 'nic', String(i));
    const port = W.add('IFCDISTRIBUTIONPORT', gid, oh, str(n.name) || `nic${i}`, null, null, null, null,
      enumv('SOURCEANDSINK'), enumv('CABLE'), enumv('DATA'));
    pset('Pset_DistributionPortCommon', gid, [prop('PortNumber', int(i + 1))], port);
    const protocols = protocolsOf(n.role);
    if (protocols.length) pset('Pset_DistributionPortTypeCable', gid, [listProp('Protocols', protocols.map(ident))], port);
    pset('APK_NetworkPort', gid, NIC.map(([p, f]) => prop(p, str(n[f]) ? (p === 'MacAddress' ? ident(n[f]) : label(n[f])) : null)), port);
    return port;
  });
  if (ports.length) W.add('IFCRELNESTS', rel('nests', pcGid), oh, null, null, pc, ports);
  for (const [g, owner, ps] of defs) W.add('IFCRELDEFINESBYPROPERTIES', g, oh, null, null, [owner], ps);

  return writeStep({
    header: [
      { type: 'FILE_DESCRIPTION', args: [['ViewDefinition [ReferenceView]'], '2;1'] },
      { type: 'FILE_NAME', args: [`${stem}.ifc`, STAMP, ['APK.audio'], ['APK.audio'], 'APK.audio computer editor', 'EDITORS.ComputerBuddy', ''] },
      { type: 'FILE_SCHEMA', args: [[COMPUTER_IFC_SCHEMA]] },
    ],
    entities: W.entities,
  });
}

/* ───────────────────────── reading it back ───────────────────────── */

/** The schema an .ifc text declares (FILE_SCHEMA), '' when none. */
export function schemaOf(t) {
  const m = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(String(t || ''));
  return m ? m[1] : '';
}

/**
 * An IFC model → the compute node block: the first IfcCommunicationsAppliance COMPUTER (else the first
 * communications appliance); throws a sentence when the file holds none.
 */
export function computerFromIfc(t) {
  const file = parseStep(String(t));
  const all = entitiesByType(file, 'IFCCOMMUNICATIONSAPPLIANCE');
  const pc = all.find((e) => e.args[8]?.value === 'COMPUTER') || all[0];
  if (!pc) throw new TypeError('no computer in this IFC: it has no IfcCommunicationsAppliance (COMPUTER)');
  let type = null;
  for (const r of entitiesByType(file, 'IFCRELDEFINESBYTYPE')) {
    if ((r.args[4] || []).some((x) => isRef(x) && x.id === pc.id)) type = file.byId.get(r.args[5]?.id);
  }
  const ps = getPsets(file, pc);
  const info = ps.APK_Computer || {};
  const hostname = str(pc.args[2]);
  const interfaces = portsOfEntity(file, pc).map((port, i) => {
    const pp = getPsets(file, port);
    const nic = pp.APK_NetworkPort || {};
    const out = { name: str(port.args[2]) };
    for (const [p, f] of NIC) out[f] = str(nic[p]);
    return { out, n: num(pp.Pset_DistributionPortCommon?.PortNumber) ?? i + 1 };
  }).sort((a, z) => a.n - z.n).map((x) => x.out);
  const watts = num(ps.Pset_ElectricalDeviceCommon?.NominalPowerConsumption);
  const block = {
    type: 'computer_node',
    id: str(pc.args[7]) || `compute_${hostname.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
    hostname,
  };
  for (const [p, f] of FIELDS) block[f] = str(info[p]);
  if (!block.formFactor && type) block.formFactor = str(type.args[2]);
  block.powerWatts = watts ?? '';
  block.interfaces = interfaces;
  block.services = (Array.isArray(info.Services) ? info.Services : info.Services ? [info.Services] : []).map(str);
  const mac = str(ps.APK_Identity?.MacAddress);
  if (info.Source || mac) block.source = { kind: str(info.Source) || 'network', ...(mac ? { identity: mac } : {}) };
  return block;
}

/* ───────────────────────── Save Model ───────────────────────── */

/** The file stem a compute node saves as (the hostname, as Save & Return always named the download). */
export const fileStemOf = (block) => str(block && block.hostname) || 'computer_node';

/**
 * Save: inside the CAD, the block back to the drawing (host.save); standalone, Save Model — the block's
 * .json AND its .ifc twin, both or neither. Resolves to 'cad' | 'download' | 'directory' | '' (failed or
 * cancelled; a failure shows its problem card).
 */
export async function saveComputerModel(S, host, block, { onRetry } = {}) {
  const meta = { name: str(block.hostname), filename: fileStemOf(block) };
  if (host.embedded || typeof S.saveModel !== 'function') return host.save(block, meta);
  const r = await S.saveModel(block, { name: meta.filename, toIfc: (b) => computerToIfc(b, { name: meta.filename }) });
  if (!r.ok && !r.cancelled) S.showProblem(r.problem || 'save_failed', { onRetry });
  return r.ok ? r.via : '';
}
