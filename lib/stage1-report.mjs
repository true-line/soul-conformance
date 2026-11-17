import { arch, platform, release } from 'node:os';
import assert from 'node:assert/strict';
import { ARCHIVES_PIN, CONTRACTS_PIN, SUBJECTS_PIN } from './pins.mjs';
import { suiteRevision } from './report.mjs';
import { validateStage1 } from './stage1.mjs';
import { STAGE1_CONTRACT } from './stage1-platform.mjs';

export function buildStage1Report(result, { hello, platformContext, platformContract }) {
  validateStage1(result);
  const run = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const report = {
    report: 'soul-conformance/stage1', report_version: 1,
    stage: '1', outcome: result.outcome, tests: ['T04', 'T05', 'T20'], verifies: ['R3', 'R6'],
    generated_at: new Date().toISOString(), suite_revision: suiteRevision(),
    platform_main: platformContext.revision,
    platform_contract: platformContract,
    definition_revision: { soul_id: hello.soul_id, definition_digest: hello.definition_digest, source: 'soul-contracts fixtures/positive/hello.first-start.json' },
    policy_digest: { value: platformContract.strategy_sha256, source: platformContract.strategy_path },
    dependency_versions: {
      'soul-contracts': { tag: CONTRACTS_PIN.tag, commit: CONTRACTS_PIN.commit, digest: CONTRACTS_PIN.digest },
      hq: { repository: SUBJECTS_PIN.subjects.hq.repository, commit: SUBJECTS_PIN.subjects.hq.commit, archive_sha256: ARCHIVES_PIN.hq.sha256, archive_bytes: ARCHIVES_PIN.hq.archiveBytes },
    },
    enforcement_profile: { in_force: result.profile, note: 'Stage 1 semantic authority checks under the cooperative profile; no protected-host containment claim.' },
    host: { os: platform(), release: release(), arch: arch(), node: process.version, ci: process.env.GITHUB_ACTIONS === 'true' ? `github-actions ${process.env.RUNNER_NAME ?? ''}`.trim() : 'local' },
    adapter_versions: {},
    simulator_versions: { 'conformance-broker': '1.0.0' },
    requested_adapter_versions: Object.fromEntries(hello.requested_roles.map((role) => [role.adapter_id, role.adapter_version])),
    coverage_limitations: [
      'T04 enters the pinned production hq-tasks provider through its peer-source port because no peer wire transport is specified.',
      'The deterministic conformance broker supplies transport only; this report does not exercise the pinned agent-comms broker subject.',
      'The task flow uses the contract fixture roles rather than launching agent-bot-souls; component entry-point evidence remains separate.',
      'No protected-host containment claim.',
    ],
    checks: result.checks,
    evidence_references: [
      ...(run ? [run] : []),
      `https://github.com/true-line/agent-bot-platform/blob/${platformContext.revision}/registry/tests.yaml`,
      `https://github.com/true-line/agent-bot-platform/blob/${platformContext.revision}/docs/07-verification/test-strategy.md`,
    ],
  };
  validateStage1Report(report);
  return report;
}

export function validateStage1Report(report) {
  assert.equal(report?.report, 'soul-conformance/stage1');
  assert.equal(report.report_version, 1);
  assert.equal(report.stage, '1');
  assert.deepEqual(report.tests, ['T04', 'T05', 'T20']);
  validateStage1({ outcome: report.outcome, profile: report.enforcement_profile?.in_force, checks: report.checks });
  assert.match(report.generated_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
  assert.match(report.suite_revision?.commit ?? '', /^[a-f0-9]{40}$/);
  assert.equal(typeof report.suite_revision.clean, 'boolean');
  assert.match(report.suite_revision.source_sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.match(report.platform_main ?? '', /^[a-f0-9]{40}$/);
  assert.equal(report.platform_contract?.revision, report.platform_main);
  assert.match(report.platform_contract?.registry_sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.match(report.platform_contract?.strategy_sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(report.platform_contract?.strategy_path, 'docs/07-verification/test-strategy.md');
  assert.deepEqual(report.platform_contract?.tests, Object.entries(STAGE1_CONTRACT).map(([id, value]) => ({ id, ...value })));
  assert.match(report.definition_revision?.soul_id ?? '', /^agent_[0-9a-f-]{36}$/);
  assert.match(report.definition_revision?.definition_digest ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.equal(report.policy_digest?.value, report.platform_contract.strategy_sha256);
  assert.equal(report.policy_digest?.source, report.platform_contract.strategy_path);
  assert.deepEqual(Object.keys(report.dependency_versions ?? {}).sort(), ['hq', 'soul-contracts']);
  assert.match(report.dependency_versions.hq.commit ?? '', /^[a-f0-9]{40}$/);
  assert.match(report.dependency_versions.hq.archive_sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(report.enforcement_profile.in_force, 'managed-cooperative');
  assert.match(report.enforcement_profile.note ?? '', /no protected-host containment claim/i);
  for (const key of ['os', 'release', 'arch', 'node', 'ci']) assert.ok(report.host?.[key], `missing host.${key}`);
  assert.deepEqual(report.adapter_versions, {});
  assert.deepEqual(report.simulator_versions, { 'conformance-broker': '1.0.0' });
  assert.ok(Object.keys(report.requested_adapter_versions ?? {}).length > 0);
  assert.ok(Array.isArray(report.coverage_limitations) && report.coverage_limitations.length >= 4);
  assert.ok(Array.isArray(report.evidence_references) && report.evidence_references.some((url) => url.includes(`/blob/${report.platform_main}/registry/tests.yaml`)));
  assert.ok(report.evidence_references.some((url) => url.includes(`/blob/${report.platform_main}/${report.platform_contract.strategy_path}`)));
}

export function stage1Markdown(report) {
  return `${[
    `## Stage 1 T04/T05/T20: ${report.outcome.toUpperCase()}`, '',
    `Suite \`${report.suite_revision.commit}\`${report.suite_revision.clean ? '' : ' (dirty)'}; HQ \`${report.dependency_versions.hq.commit.slice(0, 7)}\`; profile ${report.enforcement_profile.in_force}.`,
    '', '| Test | Result | Observed |', '|---|---|---|',
    ...report.checks.map((check) => `| ${check.id} ${check.title} | ${check.result} | ${JSON.stringify(check.observed).replace(/\|/g, '\\|')} |`),
  ].join('\n')}\n`;
}
