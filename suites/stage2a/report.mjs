import assert from 'node:assert/strict';
import { validateStage2aGate } from '../../lib/stage2a-gate.mjs';

export function hostReport({started, suite, platform, environment, os, arch, release, os_version, archive_sha256, meta, policy, observations}) {
  assert.equal(observations.length, 2);
  const first = observations[0];
  assert.ok(/^sha256:[a-f0-9]{64}$/.test(first.definition_digest));
  assert.ok(typeof first.soul_id === 'string' && first.soul_id.length > 0);
  for (const [i, o] of observations.entries()) {
    assert.equal(o.profile, 'managed-cooperative');
    assert.equal(o.pass, i+1);
    assert.equal(o.account_count, 2);
    assert.equal(o.binds, 4);
    assert.equal(o.directives, 2);
    assert.equal(o.persisted_receipts, (i+1)*4);
    assert.equal(o.task_offer_receipts, 1);
    assert.equal(o.cooperative_task_receipts, 2);
    assert.equal(o.task_receipts_replayed, 2);
    assert.equal(o.task_state_retained, i === 0 ? null : true);
    assert.equal(o.soul_id, first.soul_id);
    assert.equal(o.definition_digest, first.definition_digest);
  }
  return validateStage2aGate({
    report:'soul-conformance/stage2a-host', report_version:1, stage:'2a', outcome:'incomplete',
    started_at:started, generated_at:new Date().toISOString(), suite_revision:suite, platform_main:platform,
    host:{os, arch, release, os_version, environment, node:process.version},
    enforcement_profile:{in_force:first.profile},
    execution_scope:{hq_started_soul:false, entrypoint:null, note:'This fixture measured HQ protocol and receipts directly; it did not start a Soul through agent-bot-souls run.'},
    definition_revision:{soul_id:first.soul_id, definition_digest:first.definition_digest},
    policy_digest:{value:policy, source:'packaged plugin allowlist only'},
    dependency_versions:{hq:{commit:meta.hq_commit,archive_sha256}, contracts:{commit:meta.contracts_commit, digest:meta.contracts_digest},
      broker:os === 'darwin' ? {name:meta.broker.name,version:meta.broker.version,sha256:meta.broker.sha256,source_commit:meta.broker.source_commit} : {source:'archived HQ reference broker'}},
    adapter_versions:{},
    checks:[{id:'T01-positive',result:'pass',observed:observations.map(o => ({pass:o.pass,
      distinct_harness_uids:o.account_count, own_account_binds:o.binds, directive_reads:o.directives,
      persisted_cooperative_bind_receipts:o.persisted_receipts, owner_task_offer_receipts:o.task_offer_receipts,
      cooperative_member_task_receipts:o.cooperative_task_receipts, idempotent_task_receipt_replays:o.task_receipts_replayed,
      task_state_retained_after_restart:o.task_state_retained}))},
      ...['T01','T02','T03','T21'].map(id => ({id,result:'not-qualified'}))],
    evidence_references:['https://github.com/true-line/agent-bot-hq/blob/' + meta.hq_commit + '/hq/admission.mjs',
      'https://github.com/true-line/agent-bot-hq/issues/56','https://github.com/true-line/agent-bot-platform/issues/68'],
    coverage_limitations:[...(platform ? [] : ['Offline run; fresh Platform main was not fetched on this host.']), 'Two separate packaged HQ processes used a test-only enrolled-device status and a fresh private fixture store.',
      'No hardware signature, installed adapter version, provider call or protected host qualification was measured.'],
  });
}
