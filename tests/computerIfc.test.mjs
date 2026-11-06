// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
// ROAD-3583: the compute node block's .ifc twin (js/computerIfc.js) — written byte-deterministically, read
// back to the same block; Save Model standalone writes both files. IFC_OUT=<dir> npm test also writes the
// fixtures there, for IfcOpenShell validate + the BIM oracle (DATABASE.server.BIM editors_census.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComputerNodeModel } from '../js/computerModel.js';
import { computerToIfc, computerFromIfc, saveComputerModel, protocolsOf, schemaOf } from '../js/computerIfc.js';
import { ifcGuid } from '../vendor/apk-contracts/apk-ifc.js';
import { world } from './softappWorld.mjs';

function out(name, text) {
  if (!process.env.IFC_OUT) return;
  mkdirSync(process.env.IFC_OUT, { recursive: true });
  writeFileSync(join(process.env.IFC_OUT, name), text);
}

/** A machine taken live from the network: what it reported, '' where nobody said, a MAC identity. */
const LIVE = {
  type: 'computer_node', id: 'compute_stagepi', hostname: 'stagepi', formFactor: 'Single-Board Computer',
  os: 'Debian GNU/Linux 12', cpu: 'Cortex-A76 x4', ram: '8 GB', gpu: '', storage: '/ 58 GB ext4', powerWatts: '',
  interfaces: [{ name: 'eth0', ip: '10.10.20.31', subnet: '255.255.255.0', mac: 'b8:27:eb:00:00:01', speed: '1 Gbps', role: 'link up', vlan: '' }],
  services: ['APK agent: 2.1', '_ssh._tcp'],
  source: { kind: 'network', identity: 'B8:27:EB:00:00:01', tier: 'computer', score: 170, reasons: ['an agent'], live: { state: 'good', why: 'seen' }, protocols: ['mdns'] },
};

test('the same block writes the same bytes, and reads back to the same block', () => {
  const block = new ComputerNodeModel('SRV-AUD-01').toBlock();
  const a = computerToIfc(block, { name: 'SRV-AUD-01' });
  assert.equal(a, computerToIfc(JSON.parse(JSON.stringify(block)), { name: 'SRV-AUD-01' }));
  assert.match(a, /^ISO-10303-21;/);
  assert.equal(schemaOf(a), 'IFC4X3_ADD2');
  out('computer-srv-aud-01.ifc', a);
  assert.match(a, /IFCCOMMUNICATIONSAPPLIANCE\('[^']+',#\d+,'SRV-AUD-01',\$,\$,#\d+,\$,'compute_srv_aud_01',\.COMPUTER\.\)/);
  assert.match(a, /IFCCOMMUNICATIONSAPPLIANCETYPE\('[^']+',#\d+,'1U Rackmount',\$,\$,\$,\$,\$,\$,\.COMPUTER\.\)/);
  assert.match(a, /'NominalPowerConsumption',\$,IFCPOWERMEASURE\(250\.\)/);
  assert.match(a, /IFCSIUNIT\(\*,\.POWERUNIT\.,\$,\.WATT\.\)/);
  assert.match(a, /'RackUnits',\$,IFCINTEGER\(1\)/);
  assert.match(a, /IFCDISTRIBUTIONPORT\('[^']+',#\d+,'eth1',\$,\$,\$,\$,\.SOURCEANDSINK\.,\.CABLE\.,\.DATA\.\)/);
  assert.match(a, /'Protocols',\$,\(IFCIDENTIFIER\('Dante'\)\)/);
  assert.match(a, /'Services',\$,\(IFCLABEL\('systemd-timesyncd \(PTP\)'\)/);
  const b = computerFromIfc(a);
  assert.deepEqual(b, block);
  assert.equal(computerToIfc(b, { name: 'SRV-AUD-01' }), a, 'read and written again: the same file');
});

test('a machine from the network: GlobalId inst/mac:<mac>, its identity kept, its live state not stored', () => {
  const a = computerToIfc(LIVE, { name: 'stagepi' });
  out('computer-live.ifc', a);
  assert.ok(a.includes(`IFCCOMMUNICATIONSAPPLIANCE('${ifcGuid('inst', 'mac:b8:27:eb:00:00:01')}'`));
  assert.match(a, /'IdentityKey',\$,IFCIDENTIFIER\('mac:b8:27:eb:00:00:01'\)/);
  assert.match(a, /'IpAddress',\$,IFCLABEL\('10\.10\.20\.31'\)/);
  assert.doesNotMatch(a, /NominalPowerConsumption/, 'no power reported, none written');
  assert.doesNotMatch(a, /'good'|score|tier/i, 'nothing unverified is stored as truth');
  const b = computerFromIfc(a);
  assert.deepEqual(b.source, { kind: 'network', identity: 'b8:27:eb:00:00:01' });
  const { source, ...rest } = LIVE;
  const { source: _s, ...got } = b;
  assert.deepEqual(got, rest);
});

test('the role words: transports only when the role names them', () => {
  assert.deepEqual(protocolsOf('Dante Primary'), ['Dante']);
  assert.deepEqual(protocolsOf('ST 2110 / PTP'), ['SMPTE ST 2110', 'PTPv2']);
  assert.deepEqual(protocolsOf('Management'), []);
});

test('not a computer: a sentence, never a half-read block', () => {
  const a = computerToIfc(LIVE, { name: 'x' }).replace(/IFCCOMMUNICATIONSAPPLIANCE\(/g, 'IFCAUDIOVISUALAPPLIANCE(');
  assert.throws(() => computerFromIfc(a), /no computer in this IFC/);
});

test('standalone Save Model: <hostname>.ifc and <hostname>.json, both downloaded; in the CAD, back to the drawing', async () => {
  const alone = world({ framed: false });
  const model = new ComputerNodeModel('SRV-DSP-02');
  const host = alone.S.connectHost({ editor: 'Computer Buddy', blockType: 'computer_node', notice: false, onRequest: () => ({ block: model.toBlock() }) });
  assert.equal(await saveComputerModel(alone.S, host, model.toBlock()), 'download');
  assert.deepEqual(alone.downloads.map((d) => d.name), ['SRV-DSP-02.ifc', 'SRV-DSP-02.json']);
  assert.deepEqual(computerFromIfc(alone.downloads[0].text), JSON.parse(alone.downloads[1].text));

  const framed = world();
  const h2 = framed.S.connectHost({ editor: 'Computer Buddy', blockType: 'computer_node', notice: false, onRequest: () => ({ block: model.toBlock() }) });
  await saveComputerModel(framed.S, h2, model.toBlock());
  assert.equal(framed.toParent.at(-1).m.type, 'blockSave');
});
