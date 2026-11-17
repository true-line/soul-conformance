import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJson } from '../lib/fixtures.mjs';
import { prepareContracts, prepareSubject } from '../lib/pins.mjs';
import { stage1Subject } from '../lib/stage1-subject.mjs';

test('HQ audit receipts name the cooperative profile during admission and task offer', async (t) => {
  const contracts = prepareContracts();
  const fixture = readJson(contracts, 'fixtures/positive/hello.first-start.json').input;
  const profile = 'managed-cooperative';
  const hello = { ...fixture, requested_profile: profile };
  const subject = await stage1Subject(prepareSubject('hq'), contracts, hello);
  const session = await subject.open();
  t.after(() => session.close());

  assert.equal(session.profile, profile);
  const admission = await session.hello(hello);
  assert.equal(admission.ok, true);
  assert.equal(admission.result.profile, profile);
  const offer = await session.owner('tasks.offer', {
    operation_id: 'op_t21_offer',
    objective: 'Check the profile recorded for an owner task offer.',
    done_criteria: 'HQ records the offer.',
    accountable_soul: hello.soul_id,
  });
  assert.equal(offer.ok, true);
  assert.ok(offer.result.receipt_id);

  const receipts = session.receipts();
  const admitted = receipts.find((r) => r.kind === 'hq.admission' && r.request_id === hello.request_id);
  assert.equal(admitted?.profile_in_force, profile);
  assert.ok(receipts.some((r) => r.kind === 'task.offer' && r.receipt_id === offer.result.receipt_id));
  for (const receipt of receipts) {
    assert.equal(receipt.profile, profile, `HQ audit receipt ${receipt.seq} (${receipt.kind})`);
  }
});
