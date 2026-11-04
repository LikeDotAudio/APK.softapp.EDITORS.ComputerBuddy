import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputerNodeModel } from '../js/computerModel.js';

test('ComputerNodeModel manages network interfaces and system telemetry', () => {
  const node = new ComputerNodeModel('NODE-01');
  assert.equal(node.interfaces.length, 2);

  node.addInterface({ name: 'eth2', ip: '192.168.1.10', mac: 'AA:BB:CC:DD:EE:FF', speed: '1 Gbps', role: 'Control' });
  assert.equal(node.interfaces.length, 3);

  node.removeInterface('eth0');
  assert.equal(node.interfaces.length, 2);
  assert.equal(node.interfaces.some(i => i.name === 'eth0'), false);
});

test('ComputerNodeModel exports and imports block schemas correctly', () => {
  const node = new ComputerNodeModel('SRV-DSP-02', 'Ubuntu 24.04 LTS');
  node.addService('ptp4l');
  
  const block = node.toBlock();
  assert.equal(block.type, 'computer_node');
  assert.equal(block.hostname, 'SRV-DSP-02');
  assert.ok(block.services.includes('ptp4l'));

  const restored = new ComputerNodeModel();
  restored.fromBlock(block);
  assert.equal(restored.hostname, 'SRV-DSP-02');
  assert.equal(restored.os, 'Ubuntu 24.04 LTS');
  assert.ok(restored.services.includes('ptp4l'));
});
