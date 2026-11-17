import assert from 'node:assert/strict';
import { arch, platform, release } from 'node:os';
import { ARCHIVES_PIN, CONTRACTS_PIN, SUBJECTS_PIN } from './pins.mjs';
import { suiteRevision } from './report.mjs';

const exactMembers = (members) => JSON.stringify(members) === JSON.stringify([
  { member_id: 'm_lead', role: 'lead' },
  { member_id: 'm_spec', role: 'specialist' },
]);

const evidencePasses = (seed, observed) => {
  const proposal = observed.proposals?.[0];
  const finals = (observed.commits ?? []).filter((receipt) => receipt.outcome === 'committed' && receipt.status === 'completed');
  return observed.profile === 'managed-cooperative'
    && exactMembers(observed.members)
    && observed.task?.requester === 'owner'
    && observed.task?.objective === seed.objective
    && observed.task?.done_criteria === seed.done_criteria
    && JSON.stringify(observed.task?.write_scope) === JSON.stringify(seed.write_scope)
    && observed.task?.status === 'completed'
    && observed.task?.revision === 3
    && observed.proposals?.length === 1
    && proposal?.member_id === 'm_spec'
    && proposal?.role === 'specialist'
    && proposal?.transition === 'completed'
    && proposal?.task_status === 'running'
    && finals.length === 1
    && finals[0]?.by === 'm_lead'
    && observed.task?.evidence?.includes(proposal?.proposal_id)
    && proposal?.evidence?.every((item) => observed.task?.evidence?.includes(item))
    && observed.chat?.exit_code === 0
    && observed.artifact?.exists === true
    && proposal?.evidence?.includes(observed.artifact?.id);
};

export function validateHelloSoulResult(result) {
  assert.ok(result && ['pass', 'fail'].includes(result.outcome));
  assert.ok(result.seed && typeof result.seed === 'object');
  assert.ok(result.observed && typeof result.observed === 'object');
  const expected = evidencePasses(result.seed, result.observed) ? 'pass' : 'fail';
  assert.equal(result.outcome, expected, `hello.soul outcome ${result.outcome} contradicts evidence (${expected})`);
}

export function buildHelloSoulReport(result, { hello, platformContext, platformContract }) {
  validateHelloSoulResult(result);
  const run = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  const report = {
    report: 'soul-conformance/hello',
    report_version: 1,
    stage: '1',
    outcome: result.outcome,
    generated_at: new Date().toISOString(),
    suite_revision: suiteRevision(),
    platform_main: platformContext.revision,
    platform_contract: platformContract,
    definition_revision: {
      soul_id: hello.soul_id,
      definition_digest: hello.definition_digest,
      source: 'templates/hello.soul/Contents',
    },
    seed: result.seed,
    policy_digest: { value: platformContract.strategy_sha256, source: platformContract.strategy_path },
    dependency_versions: {
      'soul-contracts': { tag: CONTRACTS_PIN.tag, commit: CONTRACTS_PIN.commit, digest: CONTRACTS_PIN.digest, files: CONTRACTS_PIN.files },
      hq: { repository: SUBJECTS_PIN.subjects.hq.repository, commit: SUBJECTS_PIN.subjects.hq.commit, archive_sha256: ARCHIVES_PIN.hq.sha256, archive_bytes: ARCHIVES_PIN.hq.archiveBytes },
      runtime: { repository: SUBJECTS_PIN.subjects.runtime.repository, commit: SUBJECTS_PIN.subjects.runtime.commit, archive_sha256: ARCHIVES_PIN.runtime.sha256, archive_bytes: ARCHIVES_PIN.runtime.archiveBytes },
    },
    entry_point: { source_commit: SUBJECTS_PIN.subjects.runtime.commit, command_surface: 'agent-bot-souls chat' },
    enforcement_profile: { in_force: result.observed.profile, note: 'Runnable hello.soul quickstart under the cooperative profile; no protected-host containment claim.' },
    host: { os: platform(), release: release(), arch: arch(), node: process.version, ci: process.env.GITHUB_ACTIONS === 'true' ? `github-actions ${process.env.RUNNER_NAME ?? ''}`.trim() : 'local' },
    adapter_versions: { 'agent-bot-souls/fake-adapter': { version: '0.1.0', source_commit: SUBJECTS_PIN.subjects.runtime.commit } },
    simulator_versions: { 'conformance-broker': '1.0.0', 'legacy-enrollment-stub': '1.0.0' },
    observations: result.observed,
    coverage_limitations: [
      'Exercises the pinned production agent-bot-souls chat entry point and its built-in fake adapter from source, not an installed distribution.',
      'The deterministic conformance broker supplies transport; this quickstart does not exercise agent-bot-comms.',
      'The workspace and service are simulated and use no credentials, provider, model or real repository.',
      'No protected-host containment claim.',
    ],
    evidence_references: [
      ...(run ? [run] : []),
      `https://github.com/true-line/agent-bot-platform/blob/${platformContext.revision}/docs/user-guide/tutorials/quickstart.md`,
      `https://github.com/true-line/agent-bot-platform/blob/${platformContext.revision}/docs/07-verification/test-strategy.md`,
    ],
  };
  validateHelloSoulReport(report);
  return report;
}

export function validateHelloSoulReport(report) {
  assert.equal(report?.report, 'soul-conformance/hello');
  assert.equal(report.report_version, 1);
  assert.equal(report.stage, '1');
  assert.match(report.generated_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
  assert.match(report.suite_revision?.commit ?? '', /^[a-f0-9]{40}$/);
  assert.equal(typeof report.suite_revision.clean, 'boolean');
  assert.match(report.suite_revision.source_sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.match(report.platform_main ?? '', /^[a-f0-9]{40}$/);
  assert.equal(report.platform_contract?.revision, report.platform_main);
  assert.match(report.platform_contract?.registry_sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.match(report.platform_contract?.strategy_sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(report.policy_digest?.value, report.platform_contract.strategy_sha256);
  assert.equal(report.policy_digest?.source, 'docs/07-verification/test-strategy.md');
  assert.match(report.definition_revision?.soul_id ?? '', /^agent_[0-9a-f-]{36}$/);
  assert.match(report.definition_revision?.definition_digest ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(report.dependency_versions ?? {}).sort(), ['hq', 'runtime', 'soul-contracts']);
  for (const name of ['hq', 'runtime']) {
    assert.match(report.dependency_versions[name]?.commit ?? '', /^[a-f0-9]{40}$/);
    assert.match(report.dependency_versions[name]?.archive_sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(report.dependency_versions[name]?.archive_bytes));
  }
  assert.equal(report.entry_point?.source_commit, report.dependency_versions.runtime.commit);
  assert.equal(report.entry_point?.command_surface, 'agent-bot-souls chat');
  assert.equal(report.enforcement_profile?.in_force, 'managed-cooperative');
  assert.match(report.enforcement_profile?.note ?? '', /no protected-host containment claim/i);
  assert.deepEqual(report.adapter_versions, { 'agent-bot-souls/fake-adapter': { version: '0.1.0', source_commit: report.dependency_versions.runtime.commit } });
  assert.deepEqual(report.simulator_versions, { 'conformance-broker': '1.0.0', 'legacy-enrollment-stub': '1.0.0' });
  assert.ok(Array.isArray(report.coverage_limitations) && report.coverage_limitations.length >= 4);
  validateHelloSoulResult({ outcome: report.outcome, seed: report.seed, observed: report.observations });
  assert.ok(report.evidence_references.some((url) => url.includes(`/blob/${report.platform_main}/docs/user-guide/tutorials/quickstart.md`)));
}

export function helloSoulMarkdown(report) {
  return `${[
    `## hello.soul quickstart: ${report.outcome.toUpperCase()}`, '',
    `Suite \`${report.suite_revision.commit}\`${report.suite_revision.clean ? '' : ' (dirty)'}; runtime \`${report.dependency_versions.runtime.commit.slice(0, 7)}\`; profile ${report.enforcement_profile.in_force}.`,
    '',
    '| Task | Proposals | Final commitments | Artifact |',
    '|---|---:|---:|---|',
    `| ${report.observations.task.status} r${report.observations.task.revision} | ${report.observations.proposals.length} | ${report.observations.commits.filter((receipt) => receipt.outcome === 'committed' && receipt.status === 'completed').length} | ${report.observations.artifact.exists ? 'created' : 'missing'} |`,
  ].join('\n')}\n`;
}
