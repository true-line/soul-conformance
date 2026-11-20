import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { readJson } from '../lib/fixtures.mjs';
import { ARCHIVES_PIN, CACHE, prepareContracts, prepareSubject, verifyContracts } from '../lib/pins.mjs';
import { stage1Subject } from '../lib/stage1-subject.mjs';

test('Cooperative admission, owner offer and brokered member receipts agree with the recorded profile', async (t) => {
  const hq = prepareSubject('hq', ARCHIVES_PIN['hq-t21'], 'hq-t21');
  const contracts = prepareContracts(readJson(hq, 'governance/soul-contracts.json'), 'contracts-t21');
  await checkReceipts(t, hq, contracts);
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
    await checkReceipts(t, hq, contracts, true);
  });

async function checkReceipts(t, hq, contracts, bundledBroker = false) {
  const fixture = readJson(contracts, 'fixtures/positive/hello.first-start.json').input;
  const profile = 'managed-cooperative';
  const protectedRequest = readJson(contracts, 'fixtures/negative/hello.unsupported-profile.json');
  const hello = { ...fixture, request_id: 'req_t21_coop', requested_profile: profile };
  const subject = await stage1Subject(hq, contracts, hello, { notices: true, bundledBroker });
  const stateHome = mkdtempSync(join(CACHE, 'equip-'));
  t.after(() => rmSync(stateHome, { recursive: true, force: true }));
  const handles = new Set();
  const bindings = new Set();
  const first = await subject.open({ stateHome });
  let admission;
  try {
    t.diagnostic(await assertProtectedPreference(first, protectedRequest));
    admission = await assertReceipts(first, hello);
    await assertEquipment(first, admission, handles, bindings);
  } finally { await first.close(); }

  const restarted = await subject.open({ stateHome });
  try {
    assert.equal(restarted.profile, profile);
    const reply = await restarted.hello({ ...hello, request_id: 'req_t21_restart',
      prior_installation_epoch: admission.installation_epoch });
    assert.equal(reply.ok, true);
    assert.equal(reply.result.profile, profile);
    assert.equal(reply.result.installation_epoch, admission.installation_epoch);
    assert.equal(reply.result.lease_generation, admission.lease_generation + 1);
    await assertEquipment(restarted, reply.result, handles, bindings);
    t.diagnostic('Both members received distinct, runtime-bound handles before and after HQ restarted. Every Equip receipt recorded the cooperative profile.');
  } finally { await restarted.close(); }
}

async function assertEquipment(session, admission, handles, bindings) {
  const runtimes = admission.admitted_runtimes;
  assert.deepEqual(runtimes.map(runtime => runtime.role).sort(), ['lead', 'specialist']);
  for (const runtime of runtimes) {
    const reply = await session.equip(runtime.runtime_id);
    assert.equal(reply.ok, true);
    const equipment = reply.result;
    assert.equal(equipment.runtime_id, runtime.runtime_id);
    assert.deepEqual(equipment.credential_references, []);
    assert.deepEqual(equipment.approved_destinations, []);
    assert.equal(equipment.grant_handles.length, 1);
    const [grant] = equipment.grant_handles;
    assert.equal(grant.member_id, runtime.member_id);
    assert.ok(typeof runtime.channel_binding === 'string' && runtime.channel_binding.length > 0);
    assert.ok(grant.channel_binding === runtime.channel_binding, 'wrong member channel');
    bindings.add(runtime.channel_binding);
    assert.ok(typeof grant.handle === 'string' && grant.handle.length >= 16);
    assert.ok(!handles.has(grant.handle), 'each admitted runtime needs its own opaque handle');
    handles.add(grant.handle);
    const repeat = await session.equip(runtime.runtime_id);
    assert.equal(repeat.ok, true);
    assert.ok(repeat.result.grant_handles[0]?.handle === grant.handle, 'repeated Equip must retain the runtime handle');
  }
  const { receipts } = readJson(session.hqHome, 'store.json');
  for (const runtime of runtimes) {
    const rows = receipts.filter(row => row.kind === 'hq.equip' && row.runtime_id === runtime.runtime_id);
    assert.deepEqual(rows.map(row => [row.credential_references, row.profile]),
      [[0, session.profile], [0, session.profile]]);
  }
  // Include lifecycle and admission receipts written by the restarted HQ.
  for (const row of receipts) {
    assert.equal(row.profile, session.profile, `HQ audit receipt ${row.seq} (${row.kind})`);
  }
  const audit = JSON.stringify(receipts);
  for (const opaque of [...handles, ...bindings]) {
    assert.ok(!audit.includes(opaque), 'public audit receipts must omit grant handles and channel bindings');
  }
}

// A Hello expresses a preference. The contract permits a typed refusal or a
// visibly weaker admission. A required protected credential has a stricter rule.
async function assertProtectedPreference(session, fixture) {
  const request = fixture.input;
  assert.equal(session.profile, 'managed-cooperative');
  assert.equal(request.requested_profile, 'managed-protected');
  const reply = await session.hello(request);
  if (reply.ok) {
    assert.equal(reply.result.profile, session.profile);
    assert.equal(reply.result.request_id, request.request_id);
    const disclosed = reply.result.warnings?.some(warning =>
      warning.includes(request.requested_profile) && warning.includes(session.profile));
    assert.ok(disclosed, 'HQ must disclose the requested profile and the weaker profile in force');
    const repeated = await session.hello(request);
    assert.equal(repeated.ok, true);
    assert.deepEqual(repeated.result, reply.result);
  } else {
    assert.equal(reply.refusal?.error, fixture.expect.error);
    assert.equal(reply.refusal.request_id, request.request_id);
  }

  const { receipts } = readJson(session.hqHome, 'store.json');
  const decisions = receipts.filter(row => row.request_id === request.request_id &&
    ['hq.admission', 'hq.hello.refused'].includes(row.kind));
  assert.equal(decisions.length, 1);
  const [record] = decisions;
  assert.equal(record.profile, session.profile);
  if (reply.ok) {
    assert.equal(record.kind, 'hq.admission');
    assert.equal(record.decision_id, reply.result.decision_id);
    assert.equal(record.profile_in_force, session.profile);
    return 'Protected preference produced an explicit cooperative admission on both replies and one cooperative receipt.';
  }
  assert.equal(record.kind, 'hq.hello.refused');
  assert.equal(record.code, fixture.expect.error);
  return 'Protected preference was refused with profile_insufficient and recorded under the cooperative profile.';
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
  return admission.result;
}
