import assert from 'node:assert/strict';

export const STAGE2A_PROFILES = Object.freeze({
  T01: 'managed-protected',
  T02: 'managed-protected',
  T03: 'managed-protected',
  T21: 'managed-cooperative',
});

const stage2aTests = Object.keys(STAGE2A_PROFILES);

function requireHQStartedSoul(check) {
  const execution = check.execution;
  assert.equal(execution?.started_by, 'agent-bot-hq', `${check.id} must be started by HQ`);
  assert.equal(execution?.entrypoint, 'agent-bot-souls run', `${check.id} must use the Soul runner`);
  assert.match(execution?.runner_commit ?? '', /^[a-f0-9]{40}$/, `${check.id} must identify the Soul runner revision`);
  const receipt = execution?.hq_launch_receipt;
  assert.equal(receipt?.kind, 'hq.launch', `${check.id} must reference an HQ launch receipt`);
  assert.ok(typeof receipt.launch_id === 'string' && receipt.launch_id.length > 0, `${check.id} must identify its HQ launch`);
  assert.ok(typeof receipt.soul_id === 'string' && receipt.soul_id.length > 0, `${check.id} must identify the launched Soul`);
  assert.equal(receipt.argv0, 'agent-bot-souls', `${check.id} must launch the Soul runner binary`);
  assert.match(receipt.argv_sha256 ?? '', /^[a-f0-9]{64}$/, `${check.id} must identify the launched command digest`);
  assert.equal(receipt.argv_sha256, execution.expected_argv_sha256, `${check.id} HQ receipt must match the pinned Soul runner command`);
  assert.equal(check.soul_id, receipt.soul_id, `${check.id} must tie its observation to the HQ-launched Soul`);
  assert.equal(check.profile, STAGE2A_PROFILES[check.id], `${check.id} must run in ${STAGE2A_PROFILES[check.id]}`);
}

// A report's own launch fields are useful for rejecting mismatches, but they
// cannot authenticate an HQ receipt. Acceptance stays closed until the
// independent runner verifies signed host evidence and the release trust chain.
export function validateStage2aGate(report) {
  assert.equal(report?.stage, '2a');
  const checks = (report.checks ?? []).filter((check) => stage2aTests.includes(check.id));
  for (const check of checks) {
    if (check.result === 'pass') requireHQStartedSoul(check);
  }
  if (report.outcome === 'pass') {
    assert.deepEqual(checks.map((check) => check.id).sort(), [...stage2aTests].sort(), 'a Stage 2a pass needs T01, T02, T03 and T21');
    assert.ok(checks.every((check) => check.result === 'pass'), 'all Stage 2a acceptance tests must pass');
  }
  if (checks.some((check) => check.result === 'pass') || report.outcome === 'pass') {
    throw new Error('authenticated Stage 2a launch and host evidence verification is not implemented');
  }
  return report;
}
