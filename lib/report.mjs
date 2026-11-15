// The T14 result record, with the report fields the suite README requires,
// and a short Markdown rendering for a CI step summary.
import { execFileSync } from 'node:child_process';
import { arch, platform, release } from 'node:os';
import { ROOT, CONTRACTS_PIN, SUBJECTS_PIN } from './pins.mjs';

function suiteRevision() {
  if (process.env.GITHUB_SHA) return { commit: process.env.GITHUB_SHA, clean: true };
  try {
    const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const clean = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() === '';
    return { commit, clean };
  } catch { return { commit: null, clean: false }; }
}

function platformMain() {
  try {
    return execFileSync('git', ['ls-remote', 'https://github.com/true-line/agent-bot-platform.git', 'refs/heads/main'],
      { encoding: 'utf8', timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).split('\t')[0] || null;
  } catch { return null; }
}

export function buildReport(result, { hello }) {
  const run = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  return {
    report: 'soul-conformance/t14',
    report_version: 1,
    test: 'T14',
    title: 'Version mismatch',
    stage: '0',
    verifies: ['R7'],
    outcome: result.outcome,
    generated_at: new Date().toISOString(),
    suite_revision: suiteRevision(),
    platform_main: platformMain(),
    definition_revision: { soul_id: hello.soul_id, definition_digest: hello.definition_digest, source: 'soul-contracts fixtures/positive/hello.first-start.json' },
    policy_digest: { value: null, reason: 'T14 checks contract codecs and admission negotiation; no owner policy is in scope' },
    dependency_versions: {
      'soul-contracts': { tag: CONTRACTS_PIN.tag, commit: CONTRACTS_PIN.commit, digest: CONTRACTS_PIN.digest, files: CONTRACTS_PIN.files },
      ...Object.fromEntries(Object.entries(SUBJECTS_PIN.subjects).map(([name, s]) => [name, { repository: s.repository, commit: s.commit }])),
    },
    enforcement_profile: {
      in_force: result.profile ?? null,
      note: 'Contract-level check: refusals come from the codecs and the admission socket, which behave the same under both profiles. No protected-only claim is made.',
    },
    host: { os: platform(), release: release(), arch: arch(), node: process.version, ci: process.env.GITHUB_ACTIONS === 'true' ? `github-actions ${process.env.RUNNER_NAME ?? ''}`.trim() : 'local' },
    adapter_versions: Object.fromEntries(hello.requested_roles.map((r) => [r.adapter_id, r.adapter_version])),
    totals: result.totals,
    checks: result.checks,
    fixtures: result.fixtures,
    evidence_references: [
      ...(run ? [run] : []),
      'https://github.com/true-line/agent-bot-platform/blob/main/registry/tests.yaml',
      'https://github.com/true-line/agent-bot-platform/blob/main/docs/07-verification/conformance-catalog.md',
    ],
  };
}

export function markdown(report) {
  const lines = [
    `## T14 Version mismatch: ${report.outcome.toUpperCase()}`,
    '',
    `soul-contracts ${report.dependency_versions['soul-contracts'].tag} \`${report.dependency_versions['soul-contracts'].digest}\`; suite \`${report.suite_revision.commit ?? 'uncommitted'}\`${report.suite_revision.clean ? '' : ' (dirty)'}.`,
    `Subjects: ${['runtime', 'broker', 'hq'].map((n) => `${n} \`${report.dependency_versions[n].commit.slice(0, 7)}\``).join(', ')}. Profile in force: ${report.enforcement_profile.in_force}.`,
    `Fixture verdicts: ${report.totals.fixture_verdicts - report.totals.fixture_verdicts_failed}/${report.totals.fixture_verdicts} gating pass; ${report.totals.informational} informational.`,
    '',
    '| Check | Result | Observed |',
    '|---|---|---|',
    ...report.checks.map((c) => `| ${c.id}${c.gating ? '' : ' (informational)'} | ${c.result} | ${JSON.stringify(c.observed).replace(/\|/g, '\\|').slice(0, 200)} |`),
  ];
  const failed = report.fixtures.filter((r) => r.result === 'fail' || !r.gating);
  if (failed.length) {
    lines.push('', '| Subject | Fixture | Expected | Observed | Result |', '|---|---|---|---|---|');
    for (const r of failed) lines.push(`| ${r.subject} | ${r.fixture} | ${r.expected} | ${r.observed} | ${r.gating ? r.result : `${r.result} (informational)`} |`);
  }
  return `${lines.join('\n')}\n`;
}
