#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readJson } from '../../lib/fixtures.mjs';
import { buildHelloSoulReport, helloSoulMarkdown } from '../../lib/hello-soul-report.mjs';
import { prepareContracts, prepareSubject, ROOT } from '../../lib/pins.mjs';
import { platformContext } from '../../lib/platform.mjs';
import { stage1PlatformContract } from '../../lib/stage1-platform.mjs';
import { stage1Subject } from '../../lib/stage1-subject.mjs';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const template = join(ROOT, 'templates/hello.soul');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await delay(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

let host;
let child;
let childExited = false;
let work;
try {
  const platform = await platformContext();
  const platformContract = await stage1PlatformContract(platform);
  const contracts = prepareContracts();
  const hq = prepareSubject('hq');
  const runtime = prepareSubject('runtime');
  const hello = readJson(contracts, 'fixtures/positive/hello.first-start.json').input;
  const info = json(join(template, 'Contents/SoulInfo.json'));
  const lock = json(join(template, 'Contents/SoulLock.json'));
  assert.equal(info.soul_id, hello.soul_id, 'hello.soul identity must match its accepted fixture definition');
  assert.equal(lock.definition_digest, hello.definition_digest, 'hello.soul digest must match its accepted fixture definition');

  host = await (await stage1Subject(hq, contracts, hello)).open();
  work = mkdtempSync(join(tmpdir(), 'hs-'));
  const root = join(work, 's');
  cpSync(template, root, { recursive: true });
  const adaptersPath = join(root, 'Contents/host/adapters.json');
  const adapters = json(adaptersPath);
  for (const adapter of Object.values(adapters)) {
    assert.deepEqual(adapter.command, ['agent-bot-souls', 'fake-adapter'], 'template adapter command drift');
    adapter.command = [process.execPath, join(runtime, 'bin/agent-bot-souls.mjs'), 'fake-adapter'];
  }
  writeFileSync(adaptersPath, `${JSON.stringify(adapters, null, 2)}\n`);

  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(AGENT_BOT|QWTS_AGENT)_/.test(key)));
  env.AGENT_BOT_SOUL_CONTRACTS = contracts;
  let stdout = '';
  let stderr = '';
  child = spawn(process.execPath, [join(runtime, 'bin/agent-bot-souls.mjs'), 'chat', '--soul', root, '--hq-home', host.hqHome], {
    env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => { childExited = true; resolve({ code, signal }); });
  });

  await waitFor(() => host.receipts().find((receipt) => receipt.kind === 'hq.admission' && receipt.soul_id === info.soul_id), 10_000, 'hello.soul admission');
  const seed = json(join(root, 'task.json'));
  const offered = await host.owner('tasks.offer', seed);
  if (!offered.ok) throw new Error(`hello.soul task offer refused: ${JSON.stringify(offered)}`);
  const taskId = offered.result.task_id;
  child.stdin.end('Please work the waiting task.\n/status\n/quit\n');
  const timed = Promise.race([
    exited,
    delay(30_000).then(() => { throw new Error('hello.soul chat timed out'); }),
  ]);
  const exit = await timed;
  if (exit.code !== 0) throw new Error(`hello.soul chat exited ${exit.code ?? exit.signal}: ${stderr.trim()}`);

  const record = await host.task(taskId);
  const commits = host.receipts().filter((receipt) => receipt.kind === 'task.commit' && receipt.task_id === taskId);
  const statusStart = stdout.indexOf('{');
  const statusEnd = stdout.lastIndexOf('}');
  if (statusStart === -1 || statusEnd < statusStart) throw new Error(`hello.soul chat emitted no status JSON: ${stdout}`);
  const status = JSON.parse(stdout.slice(statusStart, statusEnd + 1));
  const artifactId = record.proposals[0]?.evidence?.find((item) => /^artifact_[0-9a-f]+$/.test(item)) ?? null;
  const observed = {
    profile: status.profile,
    members: status.members.map(({ member_id, role }) => ({ member_id, role })).sort((a, b) => a.member_id.localeCompare(b.member_id)),
    task: record.task,
    proposals: record.proposals,
    commits,
    chat: { exit_code: exit.code },
    artifact: { id: artifactId, exists: Boolean(artifactId && existsSync(join(root, 'Contents/home/m_spec', `${artifactId}.txt`))) },
  };
  const result = { outcome: 'pass', seed, observed };
  const report = buildHelloSoulReport(result, { hello, platformContext: platform, platformContract });
  const reportJson = `${JSON.stringify(report, null, 2)}\n`;
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, reportJson); }
  const markdown = helloSoulMarkdown(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  process.stdout.write(markdown);
  if (!out) process.stdout.write(`\n${reportJson}`);
  process.exitCode = 0;
} catch (error) {
  console.error(`hello.soul quickstart could not run: ${error.stack ?? error.message}`);
  process.exitCode = 2;
} finally {
  if (child && !childExited) {
    child.kill('SIGKILL');
    await delay(25);
  }
  await host?.close().catch(() => {});
  if (work) rmSync(work, { recursive: true, force: true });
}
