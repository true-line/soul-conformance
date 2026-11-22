import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { linkSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from '../lib/fixtures.mjs';
import { prepareContracts, prepareSubject } from '../lib/pins.mjs';
import { QUICKSTART_CHECK_IDS, QUICKSTART_TEMPLATE, instantiateQuickstart, runQuickstart, templateSnapshot, validateQuickstartResult } from '../lib/quickstart.mjs';
import { buildQuickstartReport, validateQuickstartReport } from '../lib/quickstart-report.mjs';
import { stage1Subject } from '../lib/stage1-subject.mjs';
import { checkAnswer } from '../templates/hello.soul/Contents/opt/quickstart-check.mjs';

test('checked-in hello.soul is a credential-free two-member package with a seeded task', () => {
  const snapshot = templateSnapshot();
  assert.ok(snapshot.files >= 8);
  for (const required of ['Contents/SoulInfo.json', 'Contents/SoulLock.json', 'Contents/opt/quickstart-adapter.mjs', 'Contents/opt/quickstart-check.mjs', 'Contents/primitives/quickstart-task.json']) assert.ok(snapshot.paths.includes(required));
  assert.deepEqual(snapshot.paths.filter((path) => path.startsWith('Contents/workspaces/')), [
    'Contents/workspaces/scratch/answer.txt', 'Contents/workspaces/scratch/issue.md',
  ]);
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

test('the checker and adapter refuse linked workspace inputs', async (t) => {
  const instance = instantiateQuickstart({ runtimeDir: prepareSubject('runtime') });
  t.after(() => rmSync(instance.root, { recursive: true, force: true }));
  const answer = join(instance.workspace, 'answer.txt');
  const outside = join(instance.contents, 'outside.txt');
  writeFileSync(outside, 'status=fixed\n');
  assert.throws(() => checkAnswer(answer), { code: 'ERR_ASSERTION' });

  const adapter = join(instance.contents, 'opt', 'quickstart-adapter.mjs');
  const runAdapter = () => promisify(execFile)(process.execPath, [adapter, instance.runtimeBin, instance.workspace], {
    env: { AGENT_BOT_SOULS_ROLE: 'specialist' },
    timeout: 5_000,
  });
  rmSync(answer);
  symlinkSync(outside, answer);
  assert.throws(() => checkAnswer(answer), { code: 'ELOOP' });
  writeFileSync(outside, 'status=broken\n');
  await assert.rejects(runAdapter(), /ELOOP/);
  assert.equal(readFileSync(outside, 'utf8'), 'status=broken\n');
  rmSync(answer);
  linkSync(outside, answer);
  assert.throws(() => checkAnswer(answer), /regular file with one link/);
  await assert.rejects(runAdapter(), /regular file with one link/);
  assert.equal(readFileSync(outside, 'utf8'), 'status=broken\n');
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

test('chat CLI completes the seeded task with the specialist artifact as evidence', { timeout: 120_000 }, async (t) => {
  const contracts = prepareContracts();
  const hello = readJson(contracts, 'fixtures/positive/hello.first-start.json').input;
  const instance = instantiateQuickstart({ runtimeDir: prepareSubject('runtime') });
  t.after(() => rmSync(instance.root, { recursive: true, force: true }));
  const subject = await stage1Subject(prepareSubject('hq'), contracts, hello);
  const session = await subject.open();
  t.after(() => session.close());

  const offer = await session.owner('tasks.offer', { ...instance.task, accountable_soul: instance.soul.soul_id });
  assert.equal(offer.ok, true, JSON.stringify(offer));
  const taskId = offer.result.task_id;
  const answer = join(instance.workspace, 'answer.txt');
  assert.equal(readFileSync(answer, 'utf8'), 'status=broken\n');
  writeFileSync(join(instance.workspace, 'check.mjs'), 'throw new Error("scratch code must never execute");\n');
  const chat = promisify(execFile)(process.execPath, [instance.runtimeBin, 'chat', '--soul', instance.root, '--hq-home', session.hqHome], {
    env: { HOME: instance.root, PATH: process.env.PATH, AGENT_BOT_SOUL_CONTRACTS: contracts },
    timeout: 30_000,
  });
  chat.child.stdin.end('Work the waiting hello.soul task.\n/quit\n');
  const { stdout } = await chat;

  const { task, proposals } = await session.task(taskId);
  assert.equal(proposals.length, 1);
  const [proposal] = proposals;
  assert.equal(proposal.member_id, 'm_spec');
  assert.equal(proposal.role, 'specialist');
  assert.equal(proposal.task_id, taskId);
  assert.equal(proposal.transition, 'completed');
  assert.equal(proposal.evidence.length, 1);
  const [artifactId] = proposal.evidence;
  assert.match(artifactId, /^artifact_[0-9a-f]+$/);
  const artifact = join(instance.contents, 'home', 'm_spec', `${artifactId}.txt`);
  const proposalBody = readFileSync(artifact, 'utf8');
  assert.ok(proposalBody.includes(taskId) && proposalBody.includes(instance.task.objective), proposalBody);

  assert.ok(stdout.includes(taskId) && stdout.includes(proposal.proposal_id), stdout);
  assert.equal(readFileSync(answer, 'utf8'), 'status=fixed\n');
  assert.equal(task.status, 'completed');
  assert.ok(task.evidence.includes(artifactId));
  assert.ok(task.evidence.includes(proposal.proposal_id));
  const final = session.receipts().filter((row) =>
    row.kind === 'task.commit' && row.task_id === taskId && row.outcome === 'committed' && row.status === 'completed');
  assert.deepEqual(final.map((row) => row.by), ['m_lead']);
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
