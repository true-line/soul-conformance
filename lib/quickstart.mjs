import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './pins.mjs';

export const QUICKSTART_TEMPLATE = join(ROOT, 'templates', 'hello.soul');
export const QUICKSTART_CHECK_IDS = Object.freeze(['template', 'runtime-entry', 'workspace', 'proposal', 'finalization']);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function walk(directory, relative = '') {
  const entries = [];
  for (const name of readdirSync(join(directory, relative)).sort()) {
    const path = relative ? `${relative}/${name}` : name;
    const stat = lstatSync(join(directory, path));
    if (stat.isDirectory()) entries.push(...walk(directory, path));
    else if (stat.isFile()) entries.push({ path, mode: stat.mode & 0o111 ? '100755' : '100644', bytes: readFileSync(join(directory, path)) });
    else throw new Error(`hello.soul template contains non-regular path ${path}`);
  }
  return entries;
}

export function templateSnapshot(directory = QUICKSTART_TEMPLATE) {
  const entries = walk(directory);
  const manifest = entries.map(({ path, mode, bytes }) => [path, mode, sha256(bytes)]);
  return { files: entries.length, sha256: sha256(JSON.stringify(manifest)), paths: entries.map(({ path }) => path) };
}

function copyTemplate(source, destination) {
  for (const entry of walk(source)) {
    const target = join(destination, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(source, entry.path), target);
    chmodSync(target, entry.mode === '100755' ? 0o755 : 0o644);
  }
}

export function instantiateQuickstart({ runtimeDir, templateDir = QUICKSTART_TEMPLATE } = {}) {
  if (!runtimeDir) throw new TypeError('runtimeDir is required');
  const root = mkdtempSync(join(tmpdir(), 'hello-soul-'));
  copyTemplate(templateDir, root);
  const contents = join(root, 'Contents');
  const runtimeBin = join(runtimeDir, 'bin', 'agent-bot-souls.mjs');
  const wrapper = join(contents, 'opt', 'quickstart-adapter.mjs');
  const checker = join(contents, 'opt', 'quickstart-check.mjs');
  const workspace = realpathSync(join(contents, 'workspaces', 'scratch'));
  for (const path of [runtimeBin, wrapper, checker]) {
    if (!lstatSync(path).isFile()) throw new Error(`quickstart input is not a file: ${path}`);
  }
  const adapters = {
    'fake-adapter': {
      command: [process.execPath, wrapper, runtimeBin, workspace],
    },
  };
  mkdirSync(join(contents, 'host'), { recursive: true, mode: 0o700 });
  writeFileSync(join(contents, 'host', 'adapters.json'), `${JSON.stringify(adapters, null, 2)}\n`, { mode: 0o600 });
  const soul = JSON.parse(readFileSync(join(contents, 'SoulInfo.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(contents, 'SoulLock.json'), 'utf8'));
  const task = JSON.parse(readFileSync(join(contents, 'primitives', 'quickstart-task.json'), 'utf8'));
  return { root, contents, runtimeBin, checker, workspace, soul, lock, task, template: templateSnapshot(templateDir) };
}

const passes = (id, observed) => {
  if (id === 'template') return observed.member_roles.join(',') === 'lead,specialist' && observed.adapter_ids.join(',') === 'fake-adapter,fake-adapter' && observed.host_generated === true && observed.credentials === 0;
  if (id === 'runtime-entry') return observed.profile === 'managed-cooperative' && observed.admitted === true && observed.started_members.join(',') === 'm_lead,m_spec' && observed.routed_to_specialist === true && observed.prompt_completed === true;
  if (id === 'workspace') return observed.before === 'status=broken\n' && observed.after === 'status=fixed\n' && observed.check_passed === true;
  if (id === 'proposal') return observed.count === 1 && observed.member_id === 'm_spec' && observed.role === 'specialist' && observed.transition === 'completed';
  if (id === 'finalization') return observed.status === 'completed' && observed.revision === 3 && observed.lead_completion_receipts === 1 && observed.specialist_proposal_receipts === 1;
  return false;
};

export function validateQuickstartResult(result) {
  assert.ok(result && ['pass', 'fail'].includes(result.outcome));
  assert.equal(result.profile, 'managed-cooperative');
  assert.deepEqual(result.checks?.map(({ id }) => id), QUICKSTART_CHECK_IDS);
  for (const check of result.checks) {
    assert.equal(check.gating, true, `${check.id}: must gate`);
    assert.ok(['pass', 'fail'].includes(check.result), `${check.id}: invalid result`);
    assert.equal(check.result, passes(check.id, check.observed) ? 'pass' : 'fail', `${check.id}: result contradicts observation`);
  }
  assert.equal(result.outcome, result.checks.every(({ result: value }) => value === 'pass') ? 'pass' : 'fail');
}

export async function runQuickstart({ subject, contractsDir, runtimeDir, templateDir = QUICKSTART_TEMPLATE } = {}) {
  if (!subject || !contractsDir || !runtimeDir) throw new TypeError('subject, contractsDir and runtimeDir are required');
  const session = await subject.open();
  let instance;
  let runtime;
  try {
    instance = instantiateQuickstart({ runtimeDir, templateDir });
    const { checkAnswer, readWorkspaceText } = await import(pathToFileURL(instance.checker).href);
    const answer = join(instance.workspace, 'answer.txt');
    const before = readWorkspaceText(answer);
    const { startSoul } = await import(pathToFileURL(join(runtimeDir, 'lib', 'entry-point.mjs')).href);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^(AGENT_BOT_|QWTS_AGENT_)/.test(key)));
    runtime = await startSoul({
      root: instance.root,
      hqHome: session.hqHome,
      renewEveryMs: 0,
      delay: async () => {},
      env: { ...env, AGENT_BOT_SOUL_CONTRACTS: contractsDir },
    });
    const offered = await session.owner('tasks.offer', { ...instance.task, accountable_soul: instance.soul.soul_id });
    if (!offered.ok) throw new Error(`quickstart task offer refused: ${JSON.stringify(offered)}`);
    const taskId = offered.result.task_id;
    const turn = await runtime.prompt('Work the waiting hello.soul task.');
    const record = await session.task(taskId);
    const status = runtime.status();
    const events = runtime.events();
    const receipts = session.receipts().filter((receipt) => receipt.kind === 'task.commit' && receipt.task_id === taskId);
    const hostAdapters = JSON.parse(readFileSync(join(instance.contents, 'host', 'adapters.json'), 'utf8'));
    const credentialFields = Object.values(hostAdapters).flatMap(({ env: adapterEnv = {} }) => Object.keys(adapterEnv)).filter((key) => /credential|private|secret|token/i.test(key));
    const after = readWorkspaceText(answer);
    let checkPassed = false;
    try {
      checkAnswer(answer);
      checkPassed = true;
    } catch { checkPassed = false; }
    const proposals = record.proposals.filter((proposal) => proposal.role === 'specialist' && proposal.transition === 'completed');
    const checks = [
      { id: 'template', title: 'Package instantiated', gating: true, observed: {
        member_roles: instance.soul.members.map(({ role }) => role),
        adapter_ids: instance.soul.members.map(({ adapter_id: adapterId }) => adapterId),
        host_generated: lstatSync(join(instance.contents, 'host', 'adapters.json')).isFile(), credentials: credentialFields.length,
      } },
      { id: 'runtime-entry', title: 'Production entry point', gating: true, observed: {
        profile: status.profile,
        admitted: events.some(({ event }) => event === 'admitted'),
        started_members: events.filter(({ event }) => event === 'member-started').map(({ member_id: memberId }) => memberId).sort(),
        routed_to_specialist: events.some(({ event, to }) => event === 'routed' && to === 'm_spec'),
        prompt_completed: turn.stop_reason === 'end_turn' && turn.text.includes(`Completed ${taskId}`),
      } },
      { id: 'workspace', title: 'Seeded repair and approved check', gating: true, observed: { before, after, check_passed: checkPassed } },
      { id: 'proposal', title: 'Specialist proposal', gating: true, observed: {
        count: proposals.length, member_id: proposals[0]?.member_id ?? null, role: proposals[0]?.role ?? null, transition: proposals[0]?.transition ?? null,
      } },
      { id: 'finalization', title: 'Lead-only final commitment', gating: true, observed: {
        status: record.task.status, revision: record.task.revision,
        lead_completion_receipts: receipts.filter(({ outcome, status: receiptStatus, by }) => outcome === 'committed' && receiptStatus === 'completed' && by === 'm_lead').length,
        specialist_proposal_receipts: receipts.filter(({ outcome, by }) => outcome === 'proposal' && by === 'm_spec').length,
      } },
    ].map((check) => ({ ...check, result: passes(check.id, check.observed) ? 'pass' : 'fail' }));
    const result = {
      outcome: checks.every(({ result: value }) => value === 'pass') ? 'pass' : 'fail',
      profile: status.profile,
      task_id: taskId,
      template: instance.template,
      runtime_entry: { repository: 'true-line/agent-bot-souls', module: 'lib/entry-point.mjs', export: 'startSoul', archive: basename(runtimeDir) },
      checks,
    };
    validateQuickstartResult(result);
    return result;
  } finally {
    if (runtime) await runtime.stop().catch(() => {});
    await session.close().catch(() => {});
    if (instance) rmSync(instance.root, { recursive: true, force: true });
  }
}
