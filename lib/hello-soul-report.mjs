import assert from 'node:assert/strict';
import { arch, platform, release } from 'node:os';
import { ARCHIVES_PIN, CONTRACTS_PIN, SUBJECTS_PIN } from './pins.mjs';
import { suiteRevision } from './report.mjs';

const expectedPass = (observed) => observed.profile === 'managed-cooperative'
  && observed.member_count === 2
  && observed.task_status === 'completed'
  && observed.task_revision === 3
  && observed.proposal_count === 1
  && observed.proposal_role === 'specialist'
  && observed.final_commitments === 1
  && observed.final_by === 'm_lead'
  && observed.prompt_member === 'm_lead'
  && observed.artifact_exists === true;

export function validateHelloSoulResult(result) {
  assert.ok(result && ['pass', 'fail'].includes(result.outcome));
  assert.ok(result.observed && typeof result.observed === 'object');
  const expected = expectedPass(result.observed) ? 'pass' : 'fail';
  assert.equal(result.outcome, expected, `hello.soul outcome ${result.outcome} contradicts evidence (${expected})`);
}

export function buildHelloSoulReport(result, { hello, platformContext, platformContract }) {
  validateHelloSoulResult(result);
  const run = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  const report = {
    report: 'soul-conformance/hello-soul',
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
    policy_digest: { value: platformContract.strategy_sha256, source: platformContract.strategy_path },
    dependency_versions: {
      'soul-contracts': { tag: CONTRACTS_PIN.tag, commit: CONTRACTS_PIN.commit, digest: CONTRACTS_PIN.digest },
      hq: { repository: SUBJECTS_PIN.subjects.hq.repository, commit: SUBJECTS_PIN.subjects.hq.commit, archive_sha256: ARCHIVES_PIN.hq.sha256 },
      runtime: { repository: SUBJECTS_PIN.subjects.runtime.repository, commit: SUBJECTS_PIN.subjects.runtime.commit, archive_sha256: ARCHIVES_PIN.runtime.sha256 },
    },
    enforcement_profile: { in_force: result.observed.profile, note: 'Runnable hello.soul quickstart under the cooperative profile; no protected-host containment claim.' },
    host: { os: platform(), release: release(), arch: arch(), node: process.version, ci: process.env.GITHUB_ACTIONS === 'true' ? `github-actions ${process.env.RUNNER_NAME ?? ''}`.trim() : 'local' },
    adapter_versions: { 'agent-bot-souls/fake-adapter': '0.1.0' },
    simulator_versions: { 'conformance-broker': '1.0.0' },
    coverage_limitations: [
      'Exercises the pinned production agent-bot-souls entry point and its built-in fake adapter, not an installed system CLI.',
      'The deterministic conformance broker supplies transport; this quickstart does not exercise agent-bot-comms.',
      'The workspace and service are simulated and use no credentials.',
      'No protected-host containment claim.',
    ],
    checks: [{ id: 'hello-soul', gating: true, result: result.outcome, observed: result.observed }],
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
  assert.equal(report?.report, 'soul-conformance/hello-soul');
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
  assert.equal(report.enforcement_profile?.in_force, 'managed-cooperative');
  assert.match(report.enforcement_profile?.note ?? '', /no protected-host containment claim/i);
  assert.deepEqual(report.adapter_versions, { 'agent-bot-souls/fake-adapter': '0.1.0' });
  assert.deepEqual(report.simulator_versions, { 'conformance-broker': '1.0.0' });
  assert.ok(Array.isArray(report.coverage_limitations) && report.coverage_limitations.length >= 4);
  assert.deepEqual(report.checks?.map((check) => [check.id, check.gating]), [['hello-soul', true]]);
  validateHelloSoulResult({ outcome: report.checks[0].result, observed: report.checks[0].observed });
  assert.equal(report.outcome, report.checks[0].result);
  assert.ok(report.evidence_references.some((url) => url.includes(`/blob/${report.platform_main}/docs/user-guide/tutorials/quickstart.md`)));
}

export function helloSoulMarkdown(report) {
  const observed = report.checks[0].observed;
  return `${[
    `## hello.soul quickstart: ${report.outcome.toUpperCase()}`, '',
    `Suite \`${report.suite_revision.commit}\`${report.suite_revision.clean ? '' : ' (dirty)'}; runtime \`${report.dependency_versions.runtime.commit.slice(0, 7)}\`; profile ${report.enforcement_profile.in_force}.`,
    '',
    '| Task | Proposals | Final commitments | Artifact |',
    '|---|---:|---:|---|',
    `| ${observed.task_status} r${observed.task_revision} | ${observed.proposal_count} | ${observed.final_commitments} | ${observed.artifact_exists ? 'created' : 'missing'} |`,
  ].join('\n')}\n`;
}
