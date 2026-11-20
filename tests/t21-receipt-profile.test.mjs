import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJson } from '../lib/fixtures.mjs';
import { ARCHIVES_PIN, prepareContracts, prepareSubject } from '../lib/pins.mjs';
import { stage1Subject } from '../lib/stage1-subject.mjs';

test('Cooperative admission, owner task offer and replay agree with the recorded profile', async (t) => {
  const hq = prepareSubject('hq', ARCHIVES_PIN['hq-t21'], 'hq-t21');
  const contracts = prepareContracts(readJson(hq, 'governance/soul-contracts.json'), 'contracts-t21');
  const fixture = readJson(contracts, 'fixtures/positive/hello.first-start.json').input;
  const profile = 'managed-cooperative';
  const hello = { ...fixture, requested_profile: profile };
  const subject = await stage1Subject(hq, contracts, hello, { notices: true });
  const session = await subject.open();
  t.after(() => session.close());

  assert.equal(session.profile, profile);
  const admission = await session.hello(hello);
  assert.equal(admission.ok, true);
  assert.equal(admission.result.profile, profile);
  const offerInput = {
    operation_id: 'op_t21_offer',
    objective: 'Check the profile recorded for an owner task offer.',
    done_criteria: 'HQ records the offer.',
    accountable_soul: hello.soul_id,
  };
  const offer = await session.owner('tasks.offer', offerInput);
  assert.equal(offer.ok, true);
  assert.ok(offer.result.receipt_id);
  assert.equal(offer.result.operation_id, offerInput.operation_id);
  assert.equal(offer.result.profile, profile);
  const replay = await session.owner('tasks.offer', offerInput);
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.result, offer.result);

  const receipts = session.receipts();
  const admitted = receipts.find((r) => r.kind === 'hq.admission' && r.request_id === hello.request_id);
  assert.equal(admitted?.profile_in_force, profile);
  const offers = receipts.filter((r) => r.kind === 'task.offer' && r.operation_id === offerInput.operation_id);
  assert.deepEqual(offers.map((r) => [r.receipt_id, r.profile]), [[offer.result.receipt_id, profile]]);
  for (const receipt of receipts) {
    assert.equal(receipt.profile, profile, `HQ audit receipt ${receipt.seq} (${receipt.kind})`);
  }
});
