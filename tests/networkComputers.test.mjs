// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
// The bus messages below are copied in shape from the live bench (2026-11-04).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Topics, discoveryPresenceActive } from '../vendor/apk-contracts/apk-contracts.mjs';
import { NetworkComputers, macIn, isRandomisedMac } from '../js/networkComputers.js';

const rules = JSON.parse(fs.readFileSync(new URL('../config/computer-rules.json', import.meta.url)));
const NOW = Date.parse('2026-11-04T12:00:00Z');
const strip = (t) => t.replace(/\/#$/, '');
const P = strip(Topics.protocols.wildcard());
const B = Topics.bareMetal.ROOT;
const D = strip(Topics.discoveryWildcard());

function make() {
  return new NetworkComputers({ rules, presenceActive: discoveryPresenceActive, now: () => NOW,
    roots: { protocols: P, bareMetal: B, discovery: D } });
}
const row = (key, value, last_seen = '2026-11-04T11:58:00Z', unit) => ({ key, value, node: 'APK-Shop', last_seen, ...(unit ? { unit } : {}) });
function feedAgent(nc, seen) {
  nc.ingest(`${B}/PI/APK-Shop/identity/device_manifest`, JSON.stringify([
    row('hostname', 'APK-Shop', seen), row('mac', '34:5a:60:be:6f:e8', seen),
    row('model', 'Micro-Star International Co., Ltd. MS-7E66', seen),
    row('os.system', 'Linux', seen), row('os.release', '7.0.0-38-generic', seen), row('os.architecture', 'x86_64', seen),
    row('probe', 'Linux Desktop Monitor', seen), row('probe_version', '2.0.0', seen)]));
  nc.ingest(`${B}/PI/APK-Shop/host`, JSON.stringify([row('cpu.cores', 12, seen), row('memory.used', 52.7, seen, '%')]));
  nc.ingest(`${B}/PI/APK-Shop/host/filesystem_layout`, JSON.stringify([row('/.size', 1966.74, seen, 'GB'), row('/.fstype', 'ext4', seen)]));
  nc.ingest(`${B}/PI/APK-Shop/network/interfaces_and_vlans`, JSON.stringify([
    row('enp12s0.mac', '34:5a:60:be:6f:e8', seen), row('enp12s0.ipv4', '44.44.44.168', seen), row('enp12s0.speed', 1000, seen, 'Mb/s'), row('enp12s0.state', 'up', seen),
    row('docker0.mac', '9a:1a:69:21:89:47', seen), row('docker0.ipv4', '172.17.0.1', seen)]));
}
const host = (nc, proto, kindId, fields) => { for (const [k, v] of Object.entries(fields)) nc.ingest(`${P}/${proto}/Device/${kindId}/${k}`, v); };

test('macIn finds a MAC in every spelling the scanners use, and not inside an EUI-64', () => {
  assert.equal(macIn('ping_00_07_F5_42_06_A2'), '00:07:f5:42:06:a2');
  assert.equal(macIn('nic:b8:27:eb:f0:ac:70'), 'b8:27:eb:f0:ac:70');
  assert.equal(macIn('00_07_F5_FF_FE_42_06_A2-1-d44'), null);
  assert.equal(isRandomisedMac('06:1c:93:71:58:7b'), true);
  assert.equal(isRandomisedMac('b8:27:eb:f0:ac:70'), false);
});

test('an agent that reports itself is a computer, merged with sightings of its MAC, and becomes a full block', () => {
  const nc = make();
  feedAgent(nc, '2026-11-04T11:58:00Z');
  host(nc, 'ping', 'ping_34_5A_60_BE_6F_E8', { manufacturer: 'Micro-Star INTL CO., LTD.', notes: 'answers ICMP echo at 44.44.44.168', device_class: 'Network Host' });
  const ms = nc.machines();
  assert.equal(ms.length, 1, 'the ping sighting folds into the agent by MAC');
  const m = ms[0];
  assert.equal(m.tier, 'computer');
  assert.equal(m.selfReported, true);
  assert.equal(m.live.state, 'good');
  const b = nc.toBlock(m);
  assert.equal(b.hostname, 'APK-Shop');
  assert.equal(b.os, 'Linux 7.0.0-38-generic (x86_64)');
  assert.equal(b.cpu, '12 cores');
  assert.equal(b.formFactor, 'Desktop / Tower');
  assert.deepEqual(b.interfaces.map((i) => [i.name, i.ip, i.speed]), [['enp12s0', '44.44.44.168', '1 Gbps']], 'docker0 is not a NIC');
  assert.match(b.storage, /1966.74 GB ext4/);
  assert.ok(b.services.includes('APK agent: Linux Desktop Monitor 2.0.0'));
});

test('trust decays: an agent silent past trustMinutes is kinda, one whose probe says offline is dead', () => {
  const stale = make();
  feedAgent(stale, '2026-11-04T11:30:00Z');
  assert.equal(stale.machines()[0].live.state, 'kinda');
  stale.ingest(`${B}/MonitorProbes/LinuxDesktop/APK-Shop/status`, JSON.stringify({ hostname: 'APK-Shop', mac: '34:5a:60:be:6f:e8', status: 'offline', reason: 'connection_lost' }));
  assert.equal(stale.machines()[0].live.state, 'dead');
});

test('the best guesses: a Raspberry Pi MAC is a computer; a Chromecast, a router and a container are not', () => {
  const nc = make();
  host(nc, 'ping', 'ping_B8_27_EB_F0_AC_70', { manufacturer: 'Raspberry Pi Foundation', notes: 'answers ICMP echo at 44.44.44.171' });
  host(nc, 'nic', 'Neighbor/00_14_d1_1e_a0_5f', { mac: '00:14:d1:1e:a0:5f', router: 'yes', ips: '44.44.44.1', interface: 'enp12s0' });
  host(nc, 'nic', 'Neighbor/02_42_ac_16_00_04', { mac: '02:42:ac:16:00:04', ips: '172.22.0.4', interface: 'br-d9a9540c8106' });
  host(nc, 'dnssd', '_googlecast__tcp/Chromecast-52d6', { device_class: 'Media Player', model: 'Chromecast', manufacturer: '-' });
  host(nc, 'dnssd', '_ssh__tcp/build-server', { device_class: 'Network Host', name: 'build-server', manufacturer: '-' });
  nc.ingest(`${D}/ping/ping:b8:27:eb:f0:ac:70`, JSON.stringify({ lastOnline: '2026-11-04T11:59:00Z', lastOffline: null, lastDiscovered: '2026-11-04T11:59:00Z' }));
  const by = Object.fromEntries(nc.machines().map((m) => [m.name, m]));
  const pi = Object.values(by).find((m) => m.mac === 'b8:27:eb:f0:ac:70');
  assert.equal(pi.tier, 'computer');
  assert.equal(pi.live.state, 'good', 'presence from the contract rule, verified a minute ago');
  assert.equal(nc.toBlock(pi).formFactor, 'Single-Board Computer');
  assert.equal(Object.values(by).find((m) => m.mac === '00:14:d1:1e:a0:5f').tier, 'not');
  assert.equal(Object.values(by).find((m) => m.mac === '02:42:ac:16:00:04').tier, 'not');
  assert.equal(by['Chromecast-52d6'].tier, 'not');
  assert.equal(by['build-server'].tier, 'computer', 'ssh + a computer-like name');
  host(nc, 'dnssd', '_ssh__tcp/quiet', { device_class: 'Network Host', name: 'quiet', manufacturer: '-' });
  assert.equal(nc.machines().find((m) => m.name === 'quiet').tier, 'likely', 'ssh alone is a guess, not a certainty');
});

test('ignored protocols and an ESP32 never show as computers', () => {
  const nc = make();
  host(nc, 'nmos', '045e7de2-6af0-5578-a885-061687c6477f', { device_class: 'NMOS Device', manufacturer: 'APK:audio:DataBus' });
  nc.ingest(`${B}/ESP32/esp-01/identity/heartbeat`, JSON.stringify({ node: 'esp-01', status: 'online' }));
  const ms = nc.machines();
  assert.equal(ms.length, 1);
  assert.equal(ms[0].tier, 'not');
});
