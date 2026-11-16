import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireRefusal, requireThrown, verdict, mandatoryCaseIds, tableDigest } from '../suites/T14-version-mismatch/oracles.mjs';
import { platformContext } from '../scripts/platform.mjs';
test('negative controls: a permissive or generic-failure implementation cannot pass refusal acceptance', () => {
  const good = { ok: false, refusal: { error: 'unsupported_version', request_id: 'r' } };
  requireRefusal(good, 'unsupported_version', 'r');
  for (const bad of [{ ok: true, result: {} }, { ok: false, host_refusal: { code: 'unsupported_version' } }, { ok: false, refusal: { error: 'caller_mismatch', request_id: 'r' } }, { ...good, refusal: { ...good.refusal, request_id: 'other' } }]) assert.throws(() => requireRefusal(bad, 'unsupported_version', 'r'));
});
test('negative controls: silent acceptance and unrelated exceptions cannot pass semantic codec refusal', async () => {
  await assert.rejects(requireThrown(() => ({}), 'required_capability_missing'));
  await assert.rejects(requireThrown(() => { throw new TypeError('bug'); }, 'required_capability_missing'));
  await requireThrown(() => { throw Object.assign(new Error(), { code: 'required_capability_missing' }); }, 'required_capability_missing');
});
test('mandatory inventory: missing, duplicate, extra and unknown outcomes cannot pass', () => {
  const complete = mandatoryCaseIds.map((id) => ({ id, outcome: 'passed' }));
  for (const bad of [[], complete.slice(1), [...complete, complete[0]], [{ id: 'unrelated', outcome: 'passed' }], [...complete.slice(1), { ...complete[0], outcome: 'skipped' }], [...complete.slice(1), { ...complete[0], outcome: 'failed' }]]) assert.equal(verdict(bad).implemented, 'failed');
  assert.equal(verdict(complete).implemented, 'passed');
  assert.equal(verdict(complete).overallT14, 'blocked');
  assert.equal(verdict(complete).policyBlocked, true);
});
test('fresh-platform failures and missing IDs fail closed rather than use cached rules', async () => {
  await assert.rejects(platformContext(async () => ({ ok: false, status: 503 })));
  await assert.rejects(platformContext(async (url) => ({ ok: true, text: async () => url.endsWith('/commits/main') ? JSON.stringify({ sha: 'a'.repeat(40) }) : 'missing' })));
});

test('effect snapshot observes mutations inside existing row Maps without exposing row data', () => {
  const tables = new Map([['state', new Map([['runtime', { generation: 1, binding: 'PRIVATE_CANARY' }]])]]);
  const before = tableDigest(tables, () => true);
  tables.get('state').get('runtime').generation = 2;
  const after = tableDigest(tables, () => true);
  assert.notEqual(after, before); assert.match(after, /^[0-9a-f]{64}$/); assert.equal(after.includes('PRIVATE_CANARY'), false);
});
