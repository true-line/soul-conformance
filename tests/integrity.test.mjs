import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, CACHE, ARCHIVES_PIN, prepareAll } from '../lib/pins.mjs';
import { CHECK_IDS, tableDigest, validateInventory } from '../lib/inventory.mjs';
import { platformContext, policyVerdict } from '../lib/platform.mjs';
import { suiteRevision } from '../lib/report.mjs';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const fixtures = JSON.parse(readFileSync(join(ROOT, 'governance/t14-fixture-inventory.json')));
function complete() {
  return { outcome: 'pass', checks: CHECK_IDS.map((id) => ({ id, gating: id !== 'version.n-minus-1', result: id === 'version.n-minus-1' ? 'not-exercised' : 'pass' })), fixtures: Object.entries(fixtures).flatMap(([subject, ids]) => ids.map((fixture) => ({ subject, fixture, gating: !(subject === 'hq' && ['negative/hello.stale-epoch.json', 'negative/hello.unaccepted-definition.json', 'negative/hello.unsupported-profile.json'].includes(fixture) || subject === 'broker' && fixture === 'negative/wire-frame.stale-expiry.json'), result: subject === 'hq' && fixture === 'negative/hello.stale-epoch.json' ? 'not-run' : 'pass' }))) };
}
test('mandatory inventory refuses omitted, duplicate, unexpected, ungated or unknown-outcome cases', () => {
  assert.doesNotThrow(() => validateInventory(complete()));
  for (const mutate of [(r) => r.checks.pop(), (r) => r.fixtures.pop(), (r) => r.checks.push(r.checks[0]), (r) => r.fixtures.push(r.fixtures[0]), (r) => { r.checks[0].id = 'invented'; }, (r) => { r.checks[0].result = 'maybe'; }, (r) => { r.checks[0].gating = false; }, (r) => { r.fixtures[0].result = 'not-run'; }, (r) => { r.fixtures[0].result = 'fail'; }]) {
    const result = complete(); mutate(result); assert.throws(() => validateInventory(result));
  }
});
test('state digest detects mutation inside an existing row without exposing it', () => {
  const row = { binding: 'fixture-secret', generation: 1 }, tables = new Map([['runtimes', new Map([['x', row]])]]);
  const before = tableDigest(tables); row.generation++;
  assert.notEqual(tableDigest(tables), before); assert.match(before, /^[a-f0-9]{64}$/);
});
function mocked(inventory, change = {}) {
  const source = 'immutable source fixture';
  const evidence = { repository: 'true-line/agent-bot-hq', commit: 'b'.repeat(40), path: 'hq/admission.mjs', sha256: sha(source) };
  const policy = inventory === undefined ? { schema_version: 1, status: 'Accepted', decision: 'PDR-0075', decision_path: 'docs/04-decisions/PDR-0075-first-major.md', protocols: Object.fromEntries(['hq', 'wire'].map((name) => [name, { current_major: 1, first_supported_major: 1, previous_supported_major: null, evidence: [evidence] }])) } : inventory;
  const files = { 'AGENTS.md': 'instructions', 'registry/tests.yaml': '- id: T14\n', 'registry/requirements.yaml': '- id: R7\n', 'docs/04-decisions/PDR-0020-components-read-the-platform-at-main.md': 'Status: Accepted\n', 'docs/00-governance/authority-and-ownership.md': 'authority', 'docs/08-release/release-conformance-report.md': 'report', 'registry/protocol-compatibility.json': policy === null ? null : JSON.stringify(policy), 'docs/04-decisions/PDR-0075-first-major.md': '# PDR-0075\nStatus: Accepted\n', ...change };
  return { policy, fetcher: async (url) => {
    const body = url.includes('/commits/main') ? JSON.stringify({ sha: 'a'.repeat(40) }) : url.includes('/agent-bot-platform/') ? files[url.split('/' + 'a'.repeat(40) + '/')[1]] : source;
    return { ok: body !== null && body !== undefined, status: body === null || body === undefined ? 404 : 200, text: async () => body };
  } };
}
test('fresh platform fetch fails closed for network, invalid IDs, missing paths and malformed evidence', async () => {
  await assert.rejects(platformContext(async () => { throw new Error('offline'); }), /offline/);
  for (const change of [{ 'registry/tests.yaml': '- id: T99' }, { 'registry/requirements.yaml': '- id: R99' }, { 'docs/08-release/release-conformance-report.md': null }]) await assert.rejects(platformContext(mocked(undefined, change).fetcher));
  for (const mutate of [(p) => { p.protocols.hq.evidence[0].sha256 = '0'.repeat(64); }, (p) => { p.protocols.hq.evidence = []; }, (p) => { p.protocols.hq.previous_supported_major = 0; }, (p) => { p.decision_path = 'docs/PDR%2f0075.md'; }, (p) => { p.protocols.hq.evidence[0].path = 'hq/admission.mjs?x'; }]) {
    const { policy } = mocked(); mutate(policy); await assert.rejects(platformContext(mocked(policy).fetcher));
  }
});
test('only accepted verified first-major inventory enables explicit N-1 N/A, never an executed case', async () => {
  assert.equal(policyVerdict(await platformContext(mocked(null).fetcher)).status, 'blocked');
  const { policy } = mocked(); policy.status = 'Proposed';
  assert.equal(policyVerdict(await platformContext(mocked(policy).fetcher)).status, 'blocked');
  const context = await platformContext(mocked().fetcher);
  assert.deepEqual(policyVerdict(context).status, 'satisfied'); assert.equal(policyVerdict(context).n_minus_1, 'not-applicable');
  assert.throws(() => policyVerdict(context, { hq: 2, wire: 1 }), /contradicts/);
  context.compatibility.protocols.hq.previous_supported_major = 1; context.compatibility.protocols.hq.current_major = 2;
  assert.equal(policyVerdict(context, { hq: 2, wire: 1 }).status, 'blocked');
});
test('archive and cached extraction reject modified, extra, missing, mode-changed and symlinked files', (t) => {
  const { subjects } = prepareAll(); const pin = ARCHIVES_PIN.runtime;
  const work = mkdtempSync(join(CACHE, 'integrity-')); t.after(() => rmSync(work, { recursive: true, force: true }));
  const archive = join(work, 'archives', `runtime-${pin.commit}.tar.gz`), destination = join(work, 'verified', `runtime-${pin.commit}`);
  mkdirSync(join(work, 'archives')); mkdirSync(join(work, 'verified'));
  cpSync(join(CACHE, 'archives', `runtime-${pin.commit}.tar.gz`), archive);
  const check = () => execFileSync('python3', [join(ROOT, 'scripts/archive.py'), 'runtime', work, '--verify'], { stdio: 'pipe' });
  const entry = join(destination, 'lib/contracts.mjs');
  for (const mutate of [() => writeFileSync(entry, '// tampered'), () => writeFileSync(join(destination, 'extra'), 'x'), () => rmSync(entry), () => chmodSync(entry, 0o755), () => { rmSync(entry); symlinkSync('/nonexistent', entry); }]) {
    rmSync(destination, { recursive: true, force: true }); cpSync(subjects.runtime, destination, { recursive: true }); assert.doesNotThrow(check); mutate(); assert.throws(check);
  }
  writeFileSync(archive, 'tampered'); assert.throws(check);
});
test('suite provenance rejects a false CI SHA and hashes untracked source', (t) => {
  const old = process.env.GITHUB_SHA; t.after(() => { if (old === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = old; });
  process.env.GITHUB_SHA = '0'.repeat(40); assert.throws(suiteRevision, /CI SHA/); delete process.env.GITHUB_SHA;
  const before = suiteRevision(); const extra = join(ROOT, 'temporary-integrity-source.txt');
  t.after(() => rmSync(extra, { force: true })); writeFileSync(extra, 'fixture source');
  assert.equal(suiteRevision().clean, false); assert.notEqual(suiteRevision().source_sha256, before.source_sha256);
});
