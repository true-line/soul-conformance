import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../lib/fixtures.mjs';
import { prepareContracts, prepareSubject } from '../lib/pins.mjs';
import { runStage1, validateStage1 } from '../lib/stage1.mjs';
import { stage1Subject } from '../lib/stage1-subject.mjs';

const contracts = prepareContracts();
const hq = prepareSubject('hq');
const hello = readJson(contracts, 'fixtures/positive/hello.first-start.json').input;
const subject = await stage1Subject(hq, contracts, hello);
const failures = (result) => result.checks.filter((check) => check.result === 'fail').map((check) => check.id);

test('the pinned real HQ passes T04, T05 and T20 with no skipped gate', async () => {
  const result = await runStage1({ subject, hello });
  assert.equal(result.outcome, 'pass');
  assert.deepEqual(result.checks.map((check) => [check.id, check.gating, check.result]), [
    ['T04', true, 'pass'], ['T05', true, 'pass'], ['T20', true, 'pass'],
  ]);
});

test('the run refuses a profile that differs between HQ status and admission', async () => {
  const mismatched = { async open() {
    const session = await subject.open();
    return {
      ...session,
      async hello(payload) {
        const response = await session.hello(payload);
        return { ...response, result: { ...response.result, profile: 'managed-protected' } };
      },
    };
  } };
  await assert.rejects(runStage1({ subject: mismatched, hello }), /Stage 1 profile mismatch/);
});

test('T04 fails if a peer acquires owner authority, a directive, or a grant', async () => {
  for (const change of [
    (observed) => ({ ...observed, requester: 'owner' }),
    (observed) => ({ ...observed, requester: 'peer:agent_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }),
    (observed) => ({ ...observed, directives: 1 }),
    (observed) => ({ ...observed, grant_rows: 1 }),
  ]) assert.deepEqual(failures(await runStage1({ subject, hello, mutate: { T04: change } })), ['T04']);
});

test('T04 records a peer-offer refusal as a failed gate and still runs T05 and T20', async () => {
  const refusing = { async open() {
    const session = await subject.open();
    return { ...session, peerOffer: async () => { throw Object.assign(new Error('peer data discarded'), { code: 'host.invalid_request' }); } };
  } };
  const result = await runStage1({ subject: refusing, hello });
  assert.deepEqual(failures(result), ['T04']);
  assert.equal(result.checks.find((check) => check.id === 'T04').observed.refusal, 'host.invalid_request');
});

test('T05 fails if a replay changes its receipt or commits twice', async () => {
  for (const change of [
    (observed) => ({ ...observed, stable_receipt: false }),
    (observed) => ({ ...observed, task_revision: 2 }),
    (observed) => ({ ...observed, committed_receipts: 2 }),
  ]) assert.deepEqual(failures(await runStage1({ subject, hello, mutate: { T05: change } })), ['T05']);
});

test('T20 fails if a specialist finalizes or the lead does not', async () => {
  for (const change of [
    (observed) => ({ ...observed, specialist_outcome: 'committed', status_after_specialist: 'completed' }),
    (observed) => ({ ...observed, specialist_proposals: 0 }),
    (observed) => ({ ...observed, final_status: 'running' }),
  ]) assert.deepEqual(failures(await runStage1({ subject, hello, mutate: { T20: change } })), ['T20']);
});

test('Stage 1 inventory refuses omissions, duplicates, non-gating rows and false outcomes', () => {
  const observed = {
    T04: { requester: 'peer:agent_99999999-8888-4777-8666-555555555555', task_status: 'offered', directives: 0, grant_rows: 0, authority_receipts: 0 },
    T05: { response_count: 4, stable_receipt: true, task_revision: 1, task_status: 'accepted', committed_receipts: 1 },
    T20: { specialist_outcome: 'proposal', status_after_specialist: 'running', specialist_proposals: 1, lead_outcome: 'committed', final_status: 'completed', final_revision: 3 },
  };
  const complete = () => ({ outcome: 'pass', profile: 'managed-cooperative', checks: ['T04', 'T05', 'T20'].map((id) => ({ id, gating: true, result: 'pass', observed: structuredClone(observed[id]) })) });
  assert.doesNotThrow(() => validateStage1(complete()));
  for (const mutate of [
    (result) => result.checks.pop(),
    (result) => result.checks.push(result.checks[0]),
    (result) => { result.checks[0].gating = false; },
    (result) => { result.checks[0].result = 'skipped'; },
    (result) => { result.outcome = 'fail'; },
    (result) => { delete result.profile; },
    (result) => { result.profile = 'managed-protected'; },
  ]) {
    const result = complete(); mutate(result); assert.throws(() => validateStage1(result));
  }
});
