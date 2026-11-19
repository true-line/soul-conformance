import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { machineCommandInHome } = await import(pathToFileURL(process.env.HQ_PLAN_MODULE));
const [home, socket, pin, expectedFile] = process.argv.slice(2);
const run = (...args) => machineCommandInHome(args, home, process.getuid());
if (!socket) {
  process.stdout.write((await run('identity')).public_key);
} else {
  const expected = JSON.parse(readFileSync(expectedFile, 'utf8'));
  const list = (...after) => run('members-plans', 'list', '--socket', socket, ...after);
  const get = (id) => run('members-plans', 'get', id, '--socket', socket);
  await assert.rejects(list(), /requires the daemon pin/);
  const status = await run('status', '--socket', socket, '--daemon-key', pin);
  assert.equal(status.channel, 'signed');
  const first = await list();
  assert.equal(first.state, 'listed');
  assert.deepEqual(first.plan_ids, expected.ids.slice(0, 64));
  assert.equal(first.next_after, expected.ids[63]);
  const rest = await list('--after', first.next_after);
  assert.deepEqual(rest.plan_ids, expected.ids.slice(64));
  assert.equal(rest.next_after, undefined);
  for (const plan of expected.plans) {
    const result = await get(plan.plan_id);
    assert.equal(result.state, 'found');
    assert.equal(result.daemon_fingerprint, status.daemon_fingerprint);
    assert.equal(result.plan_canonical, plan.plan_canonical);
    assert.equal(result.plan_digest, plan.plan_digest);
    assert.equal(result.plan_id, plan.plan_id);
  }
  await assert.rejects(get('plan-20261118T010000Z-ffff'), /Machine refused signed members-plans/);
}
