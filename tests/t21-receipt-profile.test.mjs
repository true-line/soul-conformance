import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { readJson } from '../lib/fixtures.mjs';
import { ARCHIVES_PIN, CACHE, prepareContracts, prepareSubject, verifyContracts } from '../lib/pins.mjs';
import { stage1Subject } from '../lib/stage1-subject.mjs';

test('Cooperative admission, owner task offer and replay agree with the recorded profile', async () => {
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
    await assertReceipts(session, hello, bundledBroker);
  } finally { await session.close(); }
}

async function assertReceipts(session, hello, bundledBroker) {
  const profile = hello.requested_profile;
  assert.equal(session.profile, profile);
  const admission = await session.hello(hello);
  assert.equal(admission.ok, true);
  assert.equal(admission.result.profile, profile);
  if (bundledBroker) await session.member(admission.result.admitted_runtimes[0]);
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
}
