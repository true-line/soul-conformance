import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../templates/stage2a-stock-hello.soul/Contents/', import.meta.url);
const files = ['SoulInfo.json', 'SoulLock.json', 'opt/stock-claude.json', 'primitives/qualification-task.json'];
const bytes = (path) => readFileSync(new URL(path, root));
const json = (path) => JSON.parse(bytes(path));

test('stock Claude candidate has a closed source inventory and stable claimed revision', () => {
  assert.deepEqual(readdirSync(root).sort(), ['SoulInfo.json', 'SoulLock.json', 'opt', 'primitives']);
  assert.deepEqual(readdirSync(new URL('opt/', root)), ['stock-claude.json']);
  assert.deepEqual(readdirSync(new URL('primitives/', root)), ['qualification-task.json']);
  const h = createHash('sha256').update('stage2a-stock-hello-source/v1\0');
  for (const path of files.filter((path) => path !== 'SoulLock.json')) {
    const data = bytes(path);
    h.update(path).update('\0').update(String(data.length)).update('\0').update(data);
  }
  assert.equal(json('SoulLock.json').definition_digest, `sha256:${h.digest('hex')}`);
});

test('one stock first turn pins the source and exact lead prompt', () => {
  const info = json('SoulInfo.json');
  const pins = json('opt/stock-claude.json');
  const task = json('primitives/qualification-task.json');
  assert.equal(info.soul_id, 'agent_0b3f1e2a-7c4d-4e8f-9a1b-2c3d4e5f6a7b');
  assert.deepEqual(info.members.map(({ member_id, role, adapter_id, adapter_version }) =>
    [member_id, role, adapter_id, adapter_version]), [
    ['m_lead', 'lead', 'claude-code', '0.109.0'],
    ['m_spec', 'specialist', 'claude-code', '0.109.0'],
  ]);
  assert.equal(task.objective, 'Return the fixture response.');
  assert.deepEqual(task.write_scope, []);
  assert.equal(pins.release_asset_sha256, 'sha256:603fdb593f00335a996986f9ed9f8a84928dad4b20e08b25862782fd770b2a28');
  assert.equal(pins.executable_sha256, 'sha256:2d48a3f9ee728def1365e89bbd0571141a607ae281344999b0349ab209bc4d39');
  assert.equal(pins.adjacent_cli_sha256, 'sha256:e85547190ef8cd983033ba61b17194045a6fea00035da349efeabed86badacc9');
});
