// The T14 result record, with the report fields the suite README requires,
// and a short Markdown rendering for a CI step summary.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { policyVerdict } from './platform.mjs';
import { validateInventory } from './inventory.mjs';
import { arch, platform, release } from 'node:os';
import { ROOT, CONTRACTS_PIN, SUBJECTS_PIN, ARCHIVES_PIN } from './pins.mjs';

export function suiteRevision() {
  const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit) throw new Error('CI SHA does not match checked-out HEAD');
  const status = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim();
  const excluded = new Set(['.git', '.cache', 'node_modules', 'reports', '__pycache__']);
  const entries = [];
  const walk = (rel = '') => {
    for (const name of readdirSync(join(ROOT, rel)).sort()) {
      if (excluded.has(name)) continue;
      const path = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(ROOT, path));
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) entries.push([path, Boolean(st.mode & 0o111), createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex')]);
      else throw new Error(`non-regular suite source: ${path}`);
    }
  };
  walk();
  return { commit, clean: status === '', source_sha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex'), source_hash_excludes: [...excluded] };
}

export function buildReport(result, { hello, platformContext }) {
  validateInventory(result);
  const policy = policyVerdict(platformContext, result.protocol_current);
  const overall = result.outcome === 'fail' ? 'fail' : policy.status === 'satisfied' ? 'pass' : 'blocked';
  const run = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  return {
    report: 'soul-conformance/t14',
    report_version: 2,
    test: 'T14',
    title: 'Version mismatch',
    stage: '0',
    verifies: ['R7'],
    outcome: overall,
    implemented_checks: result.outcome,
    protocol_current: result.protocol_current,
    compatibility_policy: policy,
    coverage_limitations: ['Original v0.4.1 cohort; not the newer HQ13 live-pilot candidate.', 'Broker checks exercise production codecs, not live wire/v1 transport framing.', 'HQ runs real admission sockets with fixture enrollment, fixed clock and accepted definitions; no production service or member launch.', 'No protected-profile enforcement claim.'],
    generated_at: new Date().toISOString(),
    suite_revision: suiteRevision(),
    platform_main: platformContext.revision,
    platform_context: platformContext,
    definition_revision: { soul_id: hello.soul_id, definition_digest: hello.definition_digest, source: 'soul-contracts fixtures/positive/hello.first-start.json' },
    policy_digest: { value: platformContext.compatibility.inventory_sha256 ?? null, source: 'fresh platform protocol compatibility inventory; no owner runtime policy is in scope' },
    dependency_versions: {
      'soul-contracts': { tag: CONTRACTS_PIN.tag, commit: CONTRACTS_PIN.commit, digest: CONTRACTS_PIN.digest, files: CONTRACTS_PIN.files },
      ...Object.fromEntries(Object.entries(SUBJECTS_PIN.subjects).map(([name, s]) => [name, { repository: s.repository, commit: s.commit, archive_sha256: ARCHIVES_PIN[name].sha256, archive_bytes: ARCHIVES_PIN[name].archiveBytes }])),
    },
    enforcement_profile: {
      in_force: result.profile ?? null,
      note: 'Observed profile from this fixture HQ admission only. Protected enforcement was not exercised; cooperative scope does not waive semantic refusal requirements.',
    },
    host: { os: platform(), release: release(), arch: arch(), node: process.version, ci: process.env.GITHUB_ACTIONS === 'true' ? `github-actions ${process.env.RUNNER_NAME ?? ''}`.trim() : 'local' },
    adapter_versions: Object.fromEntries(hello.requested_roles.map((r) => [r.adapter_id, r.adapter_version])),
    totals: result.totals,
    checks: result.checks,
    fixtures: result.fixtures,
    evidence_references: [
      ...(run ? [run] : []),
      `https://github.com/true-line/agent-bot-platform/blob/${platformContext.revision}/registry/tests.yaml`,
      `https://github.com/true-line/agent-bot-platform/blob/${platformContext.revision}/docs/08-release/release-conformance-report.md`,
    ],
  };
}

export function markdown(report) {
  const lines = [
    `## T14 Version mismatch: ${report.outcome.toUpperCase()}`,
    '',
    `soul-contracts ${report.dependency_versions['soul-contracts'].tag} \`${report.dependency_versions['soul-contracts'].digest}\`; suite \`${report.suite_revision.commit ?? 'uncommitted'}\`${report.suite_revision.clean ? '' : ' (dirty)'}.`,
    `Subjects: ${['runtime', 'broker', 'hq'].map((n) => `${n} \`${report.dependency_versions[n].commit.slice(0, 7)}\``).join(', ')}. Profile in force: ${report.enforcement_profile.in_force}.`,
    `Implemented checks: ${report.implemented_checks}; N-1: ${report.compatibility_policy.n_minus_1}. ${report.compatibility_policy.reason}`,
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
