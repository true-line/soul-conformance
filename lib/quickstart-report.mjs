import assert from 'node:assert/strict';
import { arch, platform, release } from 'node:os';
import { ARCHIVES_PIN, CONTRACTS_PIN, SUBJECTS_PIN } from './pins.mjs';
import { validateQuickstartResult } from './quickstart.mjs';

export function buildQuickstartReport(result, { platformContext, suiteRevision }) {
  validateQuickstartResult(result);
  assert.equal(suiteRevision?.clean, true, 'hello.soul evidence requires a clean suite checkout');
  const run = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const report = {
    report: 'soul-conformance/hello-soul-quickstart', report_version: 1,
    stage: '1', outcome: result.outcome, generated_at: new Date().toISOString(),
    suite_revision: suiteRevision, platform_main: platformContext.revision,
    template_revision: result.template,
    dependency_versions: {
      'soul-contracts': { tag: CONTRACTS_PIN.tag, commit: CONTRACTS_PIN.commit, digest: CONTRACTS_PIN.digest },
      hq: { repository: SUBJECTS_PIN.subjects.hq.repository, commit: SUBJECTS_PIN.subjects.hq.commit, archive_sha256: ARCHIVES_PIN.hq.sha256 },
      runtime: { repository: SUBJECTS_PIN.subjects.runtime.repository, commit: SUBJECTS_PIN.subjects.runtime.commit, archive_sha256: ARCHIVES_PIN.runtime.sha256, entry: 'lib/entry-point.mjs' },
    },
    enforcement_profile: { in_force: result.profile, note: 'Runnable hello.soul quickstart under the cooperative profile; no protected-host containment claim.' },
    host: { os: platform(), release: release(), arch: arch(), node: process.version, ci: process.env.GITHUB_ACTIONS === 'true' ? `github-actions ${process.env.RUNNER_NAME ?? ''}`.trim() : 'local' },
    adapter_versions: { 'fake-adapter': '0.1.0' },
    simulator_versions: { 'conformance-broker': '1.0.0', 'hello-soul-workspace-wrapper': '1.0.0' },
    exercised_runtime: result.runtime_entry,
    task_id: result.task_id,
    checks: result.checks,
    coverage_limitations: [
      'The pinned production agent-bot-souls entry point and its fake ACP adapter are exercised; no real model provider is contacted.',
      'The deterministic conformance broker supplies transport only; pinned HQ owns admission, task authority, persistence and receipts.',
      'The checked-in workspace wrapper performs the deterministic file repair and approved check before the specialist proposal.',
      'No protected-host containment claim.',
    ],
    evidence_references: [
      ...(run ? [run] : []),
      `https://github.com/true-line/agent-bot-platform/blob/${platformContext.revision}/docs/08-release/release-conformance-report.md`,
      `https://github.com/true-line/agent-bot-platform/blob/${platformContext.revision}/docs/10-program/roadmap.md`,
    ],
  };
  validateQuickstartReport(report);
  return report;
}

export function validateQuickstartReport(report) {
  assert.equal(report?.report, 'soul-conformance/hello-soul-quickstart');
  assert.equal(report.report_version, 1);
  assert.equal(report.stage, '1');
  validateQuickstartResult({ outcome: report.outcome, profile: report.enforcement_profile?.in_force, checks: report.checks });
  assert.equal(report.suite_revision?.clean, true);
  assert.match(report.suite_revision?.commit ?? '', /^[a-f0-9]{40}$/);
  assert.match(report.suite_revision?.source_sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.match(report.platform_main ?? '', /^[a-f0-9]{40}$/);
  assert.ok(Number.isSafeInteger(report.template_revision?.files) && report.template_revision.files >= 8);
  assert.match(report.template_revision?.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(report.dependency_versions ?? {}).sort(), ['hq', 'runtime', 'soul-contracts']);
  assert.equal(report.dependency_versions['soul-contracts'].commit, CONTRACTS_PIN.commit);
  assert.equal(report.dependency_versions['soul-contracts'].digest, CONTRACTS_PIN.digest);
  for (const name of ['hq', 'runtime']) {
    assert.match(report.dependency_versions[name].commit ?? '', /^[a-f0-9]{40}$/);
    assert.match(report.dependency_versions[name].archive_sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(report.dependency_versions[name].commit, SUBJECTS_PIN.subjects[name].commit);
    assert.equal(report.dependency_versions[name].archive_sha256, ARCHIVES_PIN[name].sha256);
  }
  assert.equal(report.dependency_versions.runtime.entry, 'lib/entry-point.mjs');
  assert.equal(report.enforcement_profile.in_force, 'managed-cooperative');
  assert.match(report.enforcement_profile.note ?? '', /no protected-host containment claim/i);
  assert.deepEqual(report.adapter_versions, { 'fake-adapter': '0.1.0' });
  assert.deepEqual(report.simulator_versions, { 'conformance-broker': '1.0.0', 'hello-soul-workspace-wrapper': '1.0.0' });
  assert.equal(report.exercised_runtime?.module, 'lib/entry-point.mjs');
  assert.equal(report.exercised_runtime?.export, 'startSoul');
  for (const key of ['os', 'release', 'arch', 'node', 'ci']) assert.ok(report.host?.[key], `missing host.${key}`);
  assert.ok(Array.isArray(report.coverage_limitations) && report.coverage_limitations.length >= 4);
  assert.ok(report.evidence_references.some((url) => url.includes(`/blob/${report.platform_main}/docs/08-release/release-conformance-report.md`)));
  assert.ok(report.evidence_references.some((url) => url.includes(`/blob/${report.platform_main}/docs/10-program/roadmap.md`)));
}

export function quickstartMarkdown(report) {
  return `${[
    `## hello.soul quickstart: ${report.outcome.toUpperCase()}`, '',
    `Suite \`${report.suite_revision.commit}\`; runtime \`${report.dependency_versions.runtime.commit.slice(0, 7)}\`; HQ \`${report.dependency_versions.hq.commit.slice(0, 7)}\`; profile ${report.enforcement_profile.in_force}.`,
    '', '| Check | Result | Observed |', '|---|---|---|',
    ...report.checks.map((check) => `| ${check.id} ${check.title} | ${check.result} | ${JSON.stringify(check.observed).replace(/\|/g, '\\|')} |`),
  ].join('\n')}\n`;
}
