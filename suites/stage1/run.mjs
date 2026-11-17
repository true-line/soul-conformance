#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readJson } from '../../lib/fixtures.mjs';
import { prepareContracts, prepareSubject } from '../../lib/pins.mjs';
import { platformContext } from '../../lib/platform.mjs';
import { runStage1 } from '../../lib/stage1.mjs';
import { buildStage1Report, stage1Markdown } from '../../lib/stage1-report.mjs';
import { stage1PlatformContract } from '../../lib/stage1-platform.mjs';
import { stage1Subject } from '../../lib/stage1-subject.mjs';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

try {
  const platform = await platformContext();
  const platformContract = await stage1PlatformContract(platform);
  const contracts = prepareContracts();
  const hq = prepareSubject('hq');
  const hello = readJson(contracts, 'fixtures/positive/hello.first-start.json').input;
  const result = await runStage1({ subject: await stage1Subject(hq, contracts, hello), hello });
  const report = buildStage1Report(result, { hello, platformContext: platform, platformContract });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, json); }
  const markdown = stage1Markdown(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  process.stdout.write(markdown);
  if (!out) process.stdout.write(`\n${json}`);
  process.exitCode = report.outcome === 'pass' ? 0 : 1;
} catch (error) {
  console.error(`Stage 1 conformance could not run: ${error.stack ?? error.message}`);
  process.exitCode = 2;
}
