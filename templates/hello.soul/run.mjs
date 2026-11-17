#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

let host;
let soul;
let work;
const previousContracts = process.env.AGENT_BOT_SOUL_CONTRACTS;
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
  work = mkdtempSync(join(tmpdir(), 'hello-soul-'));
  const root = join(work, 'hello.soul');
  cpSync(template, root, { recursive: true });
  const adaptersPath = join(root, 'Contents/host/adapters.json');
  const adapters = json(adaptersPath);
  for (const adapter of Object.values(adapters)) {
    assert.deepEqual(adapter.command, ['agent-bot-souls', 'fake-adapter'], 'template adapter command drift');
    adapter.command = [process.execPath, join(runtime, 'bin/agent-bot-souls.mjs'), 'fake-adapter'];
  }
  writeFileSync(adaptersPath, `${JSON.stringify(adapters, null, 2)}\n`);

  process.env.AGENT_BOT_SOUL_CONTRACTS = contracts;
  const { startSoul } = await import(pathToFileURL(join(runtime, 'lib/entry-point.mjs')).href);
  soul = await startSoul({ root, hqHome: host.hqHome, requestedProfile: 'managed-cooperative', renewEveryMs: 0 });
  const status = soul.status();
  const taskInput = json(join(root, 'task.json'));
  const offered = await host.owner('tasks.offer', { ...taskInput, accountable_soul: info.soul_id });
  if (!offered.ok) throw new Error(`hello.soul task offer refused: ${JSON.stringify(offered)}`);
  const taskId = offered.result.task_id;
  const prompt = await soul.prompt('Complete the waiting hello.soul task.');
  const record = await host.task(taskId);
  const commits = host.receipts().filter((receipt) => receipt.kind === 'task.commit' && receipt.task_id === taskId);
  const finals = commits.filter((receipt) => receipt.outcome === 'committed' && receipt.status === 'completed');
  const artifact = record.task.evidence?.find((item) => /^artifact_[0-9a-f]+$/.test(item));
  const observed = {
    profile: status.profile,
    member_count: status.members.length,
    task_status: record.task.status,
    task_revision: record.task.revision,
    proposal_count: record.proposals.length,
    proposal_role: record.proposals[0]?.role ?? null,
    final_commitments: finals.length,
    final_by: finals[0]?.by ?? null,
    prompt_member: prompt.member_id,
    artifact_exists: Boolean(artifact && existsSync(join(root, 'Contents/home/m_spec', `${artifact}.txt`))),
  };
  const passes = observed.profile === 'managed-cooperative'
    && observed.member_count === 2
    && observed.task_status === 'completed'
    && observed.task_revision === 3
    && observed.proposal_count === 1
    && observed.proposal_role === 'specialist'
    && observed.final_commitments === 1
    && observed.final_by === 'm_lead'
    && observed.prompt_member === 'm_lead'
    && observed.artifact_exists;
  const report = buildHelloSoulReport({ outcome: passes ? 'pass' : 'fail', observed }, {
    hello, platformContext: platform, platformContract,
  });
  const reportJson = `${JSON.stringify(report, null, 2)}\n`;
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, reportJson); }
  const markdown = helloSoulMarkdown(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  process.stdout.write(markdown);
  if (!out) process.stdout.write(`\n${reportJson}`);
  process.exitCode = report.outcome === 'pass' ? 0 : 1;
} catch (error) {
  console.error(`hello.soul quickstart could not run: ${error.stack ?? error.message}`);
  process.exitCode = 2;
} finally {
  await soul?.stop().catch(() => {});
  await host?.close().catch(() => {});
  if (work) rmSync(work, { recursive: true, force: true });
  if (previousContracts === undefined) delete process.env.AGENT_BOT_SOUL_CONTRACTS;
  else process.env.AGENT_BOT_SOUL_CONTRACTS = previousContracts;
}
