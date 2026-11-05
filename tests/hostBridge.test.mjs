// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* ROAD-3488: the computer_node block goes in and out over
   cad.like.audio/host@1 (vendor/apk-softapp), never '*'. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { world, hostContract, ORIGIN } from './softappWorld.mjs';
import { ComputerNodeModel } from '../js/computerModel.js';

function editor(S) {
  const model = new ComputerNodeModel();
  const host = S.connectHost({
    editor: 'Computer Buddy', blockType: 'computer_node', notice: false,
    onLoad: (block) => model.fromBlock(block),
    onRequest: () => ({ block: model.toBlock(), meta: { name: model.hostname } }),
  });
  return { model, host };
}

test('block round trip: load from the CAD, edit, request answers blockSave with the edit, at our origin', async () => {
  const { S, toParent, fire } = world();
  const { model, host } = editor(S);
  assert.equal(host.embedded, true);
  assert.deepEqual(toParent[0], { m: { protocol: 'cad.like.audio/host@1', type: 'editorReady', editor: 'Computer Buddy', blockType: 'computer_node' }, o: ORIGIN });
  const sent = new ComputerNodeModel('SRV-PLAYOUT-1', 'Debian 13');
  fire({ protocol: 'cad.like.audio/host@1', type: 'load', block: sent.toBlock(), meta: { blockName: 'SRV_1' } });
  assert.equal(model.hostname, 'SRV-PLAYOUT-1');
  model.addService('ptp4l');
  host.changed(model.toBlock());
  fire({ protocol: 'cad.like.audio/host@1', type: 'request' });
  const [ready, changed, save] = toParent;
  assert.equal(changed.m.type, 'blockChanged');
  assert.equal(save.m.type, 'blockSave');
  assert.ok(save.m.block.services.includes('ptp4l'));
  assert.equal(save.m.meta.blockName, 'SRV_1');
  assert.ok(toParent.every((x) => x.o === ORIGIN), 'never "*"');
  const contract = await hostContract();
  if (contract) for (const { m } of [ready, changed, save]) assert.deepEqual(contract.validateMessage(contract.schema, 'toCad', m), [], m.type);
});

test('the old private APK_LOAD_BLOCK and a foreign origin are ignored; standalone Save downloads', () => {
  const framed = world();
  const { model } = editor(framed.S);
  framed.fire({ type: 'APK_LOAD_BLOCK', block: { hostname: 'OLD' } });
  framed.fire({ protocol: 'cad.like.audio/host@1', type: 'load', block: { hostname: 'X' } }, { origin: 'http://evil' });
  assert.notEqual(model.hostname, 'OLD');
  assert.notEqual(model.hostname, 'X');

  const alone = world({ framed: false });
  const { model: m2, host } = editor(alone.S);
  assert.equal(host.save(m2.toBlock(), { filename: 'srv' }), 'download');
  assert.equal(alone.downloads[0].name, 'srv.json');
});
