#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readJson } from '../../lib/fixtures.mjs';
import { prepareContracts, prepareSubject } from '../../lib/pins.mjs';
import { platformContext } from '../../lib/platform.mjs';
import { runQuickstart } from '../../lib/quickstart.mjs';
import { buildQuickstartReport, quickstartMarkdown } from '../../lib/quickstart-report.mjs';
import { suiteRevision } from '../../lib/report.mjs';
import { stage1Subject } from '../../lib/stage1-subject.mjs';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

try {
  const revision = suiteRevision();
  if (!revision.clean) throw new Error('hello.soul evidence requires a clean suite checkout');
  const platform = await platformContext();
  const contracts = prepareContracts();
  const hq = prepareSubject('hq');
  const runtime = prepareSubject('runtime');
  const hello = readJson(contracts, 'fixtures/positive/hello.first-start.json').input;
  const result = await runQuickstart({ subject: await stage1Subject(hq, contracts, hello), contractsDir: contracts, runtimeDir: runtime });
  const report = buildQuickstartReport(result, { platformContext: platform, suiteRevision: revision });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, json); }
  const markdown = quickstartMarkdown(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  process.stdout.write(markdown);
  if (!out) process.stdout.write(`\n${json}`);
  process.exitCode = report.outcome === 'pass' ? 0 : 1;
} catch (error) {
  console.error(`hello.soul quickstart could not run: ${error.stack ?? error.message}`);
  process.exitCode = 2;
}
