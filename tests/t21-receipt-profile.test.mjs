import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { readJson } from '../lib/fixtures.mjs';
import { ARCHIVES_PIN, CACHE, prepareContracts, prepareSubject, verifyContracts } from '../lib/pins.mjs';
import { stage1Subject } from '../lib/stage1-subject.mjs';

test('Cooperative admission, owner offer and brokered member receipts agree with the recorded profile', async () => {
  const hq = prepareSubject('hq', ARCHIVES_PIN['hq-t21'], 'hq-t21');
  const contracts = prepareContracts(readJson(hq, 'governance/soul-contracts.json'), 'contracts-t21');
  await checkReceipts(hq, contracts);
});

const { SOUL_T21_HQ_TAR: archive, SOUL_T21_HQ_SHA256: sha256, SOUL_T21_HQ_COMMIT: commit } = process.env;
test('Darwin archive serves cooperative T21 receipts through its release-pinned broker host',
  { skip: ![archive, sha256, commit].some(Boolean) }, async (t) => {
    assert.equal(process.platform, 'darwin', 'run the Darwin archive on macOS');
    assert.ok(archive && /^[a-f0-9]{64}$/.test(sha256) && /^[a-f0-9]{40}$/.test(commit), 'provide the approved archive, digest and source commit');
    mkdirSync(CACHE, { recursive: true });
    const tmp = mkdtempSync(join(CACHE, 'archive-'));
    t.after(() => rmSync(tmp, { recursive: true, force: true }));
    const hq = join(tmp, 'hq');
    execFileSync('python3', [fileURLToPath(new URL('../scripts/archive.py', import.meta.url)), '--darwin-hq-tar', archive, sha256, hq]);
    const metadata = readJson(hq, 'governance/interim-release.json');
    assert.equal(metadata.hq_commit, commit);
    assert.equal(metadata.target_platform, 'darwin');
    const contracts = join(hq, 'vendor/soul-contracts');
    verifyContracts(contracts, readJson(hq, 'governance/soul-contracts.json'));
    await checkReceipts(hq, contracts, true);
  });

async function checkReceipts(hq, contracts, bundledBroker = false) {
  const fixture = readJson(contracts, 'fixtures/positive/hello.first-start.json').input;
  const profile = 'managed-cooperative';
  const hello = { ...fixture, requested_profile: profile };
  const subject = await stage1Subject(hq, contracts, hello, { notices: true, bundledBroker });
  const session = await subject.open();
  try {
    await assertReceipts(session, hello);
  } finally { await session.close(); }
}

async function assertReceipts(session, hello) {
  const profile = hello.requested_profile;
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

  // Both member roles get a task receipt over their own bound broker connection.
  // Redelivery after a fresh bind must return the original cooperative receipt.
  let revision = offer.result.revision;
  const memberReceipts = [];
  for (const [role, transition, outcome] of [
    ['lead', 'accepted', 'committed'], ['specialist', 'completed', 'proposal'],
  ]) {
    const runtime = admission.result.admitted_runtimes.find((r) => r.role === role);
    assert.ok(runtime, `missing admitted ${role}`);
    const request = {
      contract: 'task/v1', request_id: `req_t21_${role}`, operation_id: `op_t21_${role}`,
      installation_epoch: admission.result.installation_epoch, lease_generation: admission.result.lease_generation,
      task_id: offer.result.task_id, runtime_id: runtime.runtime_id, expected_revision: revision, transition,
      ...(role === 'specialist' ? { result_ref: 'artifact_t21' } : {}),
    };
    const member = await session.member(runtime);
    const reply = await member.request('task.commit', request);
    assert.equal(reply.ok, true);
    const receipt = reply.result;
    assert.ok(receipt.receipt_id);
    assert.equal(receipt.profile, profile);
    assert.equal(receipt.task_id, request.task_id);
    assert.equal(receipt.operation_id, request.operation_id);
    assert.equal(receipt.by, runtime.member_id);
    assert.equal(receipt.outcome, outcome);
    const secondConnection = await session.member(runtime);
    const repeated = await secondConnection.request('task.commit', request);
    assert.equal(repeated.ok, true);
    assert.deepEqual(repeated.result, receipt);
    memberReceipts.push(receipt);
    revision = receipt.revision;
  }

  const { receipts } = readJson(session.hqHome, 'store.json');
  const admitted = receipts.find((r) => r.kind === 'hq.admission' && r.request_id === hello.request_id);
  assert.equal(admitted?.profile_in_force, profile);
  const offers = receipts.filter((r) => r.kind === 'task.offer' && r.operation_id === offerInput.operation_id);
  assert.deepEqual(offers.map((r) => [r.receipt_id, r.profile]), [[offer.result.receipt_id, profile]]);
  for (const member of memberReceipts) {
    const rows = receipts.filter((r) => r.kind === 'task.commit' && r.operation_id === member.operation_id);
    assert.deepEqual(rows.map((r) => [r.receipt_id, r.profile, r.by, r.outcome]),
      [[member.receipt_id, profile, member.by, member.outcome]]);
  }
  for (const receipt of receipts) {
    assert.equal(receipt.profile, profile, `HQ audit receipt ${receipt.seq} (${receipt.kind})`);
  }
}
