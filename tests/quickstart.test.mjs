import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from '../lib/fixtures.mjs';
import { prepareContracts, prepareSubject } from '../lib/pins.mjs';
import { QUICKSTART_CHECK_IDS, QUICKSTART_TEMPLATE, instantiateQuickstart, runQuickstart, templateSnapshot, validateQuickstartResult } from '../lib/quickstart.mjs';
import { buildQuickstartReport, validateQuickstartReport } from '../lib/quickstart-report.mjs';
import { stage1Subject } from '../lib/stage1-subject.mjs';

test('checked-in hello.soul is a credential-free two-member package with a seeded task', () => {
  const snapshot = templateSnapshot();
  assert.ok(snapshot.files >= 8);
  for (const required of ['Contents/SoulInfo.json', 'Contents/SoulLock.json', 'Contents/opt/quickstart-adapter.mjs', 'Contents/primitives/quickstart-task.json', 'Contents/workspaces/scratch/check.mjs']) assert.ok(snapshot.paths.includes(required));
  assert.ok(!snapshot.paths.some((path) => path.startsWith('Contents/host/')), 'host state is instantiated, not shipped');
  const info = JSON.parse(readFileSync(join(QUICKSTART_TEMPLATE, 'Contents', 'SoulInfo.json')));
  assert.deepEqual(info.members.map(({ member_id: id, role }) => [id, role]), [['m_lead', 'lead'], ['m_spec', 'specialist']]);
  const source = snapshot.paths.map((path) => readFileSync(join(QUICKSTART_TEMPLATE, path), 'utf8')).join('\n');
  assert.doesNotMatch(source, /private[_ -]?key|access[_ -]?token|client[_ -]?secret/i);
});

test('quickstart keeps its Unix socket path short when the checkout path is long', () => {
  const instance = instantiateQuickstart({ runtimeDir: prepareSubject('runtime') });
  try {
    assert.ok(join(instance.contents, 'host', 'members.sock').length <= 107);
    assert.ok(!instance.root.startsWith(join(QUICKSTART_TEMPLATE, '..', '..')), 'ephemeral host state must not inherit the checkout path length');
  } finally {
    rmSync(instance.root, { recursive: true, force: true });
  }
});

test('hello.soul quickstart exercises the pinned production runtime entry point', { timeout: 120_000 }, async () => {
  const contracts = prepareContracts();
  const hq = prepareSubject('hq');
  const runtime = prepareSubject('runtime');
  const hello = readJson(contracts, 'fixtures/positive/hello.first-start.json').input;
  const result = await runQuickstart({ subject: await stage1Subject(hq, contracts, hello), contractsDir: contracts, runtimeDir: runtime });
  assert.equal(result.outcome, 'pass');
  assert.deepEqual(result.checks.map(({ id, result: value }) => [id, value]), QUICKSTART_CHECK_IDS.map((id) => [id, 'pass']));
  assert.doesNotThrow(() => validateQuickstartResult(result));
});

function completeResult() {
  const observed = {
    template: { member_roles: ['lead', 'specialist'], adapter_ids: ['fake-adapter', 'fake-adapter'], host_generated: true, credentials: 0 },
    'runtime-entry': { profile: 'managed-cooperative', admitted: true, started_members: ['m_lead', 'm_spec'], routed_to_specialist: true, prompt_completed: true },
    workspace: { before: 'status=broken\n', after: 'status=fixed\n', check_passed: true },
    proposal: { count: 1, member_id: 'm_spec', role: 'specialist', transition: 'completed' },
    finalization: { status: 'completed', revision: 3, lead_completion_receipts: 1, specialist_proposal_receipts: 1 },
  };
  return { outcome: 'pass', profile: 'managed-cooperative', task_id: 'task_1', template: { files: 8, sha256: 'a'.repeat(64), paths: [] }, runtime_entry: { repository: 'true-line/agent-bot-souls', module: 'lib/entry-point.mjs', export: 'startSoul', archive: 'runtime' }, checks: QUICKSTART_CHECK_IDS.map((id) => ({ id, title: id, gating: true, result: 'pass', observed: observed[id] })) };
}

test('quickstart evidence rejects dirty source, wrong profile and contradictory observations', () => {
  const platformContext = { revision: 'b'.repeat(40) };
  const suiteRevision = { commit: 'c'.repeat(40), clean: true, source_sha256: 'd'.repeat(64) };
  const report = buildQuickstartReport(completeResult(), { platformContext, suiteRevision });
  assert.doesNotThrow(() => validateQuickstartReport(report));
  assert.throws(() => buildQuickstartReport(completeResult(), { platformContext, suiteRevision: { ...suiteRevision, clean: false } }), /clean suite/);
  for (const mutate of [
    (value) => { value.profile = 'managed-protected'; },
    (value) => { value.checks[2].observed.after = 'status=broken\n'; },
    (value) => { value.checks.pop(); },
  ]) {
    const value = structuredClone(completeResult()); mutate(value); assert.throws(() => validateQuickstartResult(value));
  }
  const bad = structuredClone(report); bad.dependency_versions.runtime.entry = 'lib/fake.mjs';
  assert.throws(() => validateQuickstartReport(bad));
});
