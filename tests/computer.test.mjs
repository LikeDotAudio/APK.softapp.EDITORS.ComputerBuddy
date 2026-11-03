import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerNodeModel } from '../js/computerApp.js';

test('ComputerNodeModel manages network interfaces and system telemetry', () => {
  const node = new ComputerNodeModel('NODE-01');
  assert.equal(node.interfaces.length, 2);

  node.addInterface({ name: 'eth2', ip: '192.168.1.10', mac: 'AA:BB:CC:DD:EE:FF', speed: '1 Gbps', role: 'Control' });
  assert.equal(node.interfaces.length, 3);

  node.removeInterface('eth0');
  assert.equal(node.interfaces.length, 2);
  assert.equal(node.interfaces.some(i => i.name === 'eth0'), false);
});
