#!/usr/bin/env node
// Run T14 against the pinned soul-contracts release and the pinned runtime,
// broker and HQ. Evidence mode exits 0 when implemented checks pass; --gate also requires accepted compatibility policy.
//
//   node suites/T14-version-mismatch/run.mjs [--out <file.json>]
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadFixtures, readJson } from '../../lib/fixtures.mjs';
import { CONTRACTS_PIN, prepareAll } from '../../lib/pins.mjs';
import { buildReport, markdown } from '../../lib/report.mjs';
import { openBroker, openHQ, openRuntime } from '../../lib/subjects.mjs';
import { platformContext } from '../../lib/platform.mjs';
import { runT14 } from '../../lib/t14.mjs';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

try {
  const platform = await platformContext();
  const { contracts, subjects } = prepareAll();
  const fixtures = loadFixtures(contracts);
  const hello = readJson(contracts, 'fixtures/positive/hello.first-start.json').input;
  // HQ accepts exactly the definitions the positive Hello fixtures name.
  const accepted = {};
  for (const f of fixtures.filter((x) => x.kind === 'positive' && x.schema === 'hq/v1/hello.schema.json')) {
    (accepted[f.input.soul_id] ??= []).includes(f.input.definition_digest) || accepted[f.input.soul_id].push(f.input.definition_digest);
  }
  const result = await runT14({
    contractsDir: contracts,
    pin: CONTRACTS_PIN,
    fixtures,
    runtime: await openRuntime(subjects.runtime, contracts),
    broker: await openBroker(subjects.broker),
    hq: await openHQ(subjects.hq, contracts, { accepted }),
  });
  const report = buildReport(result, { hello, platformContext: platform });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, json); }
  const md = markdown(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  process.stdout.write(md);
  if (!out) process.stdout.write(`\n${json}`);
  process.exitCode = report.implemented_checks !== 'pass' ? 1 : args.includes('--gate') && report.outcome !== 'pass' ? 2 : 0;
} catch (error) {
  console.error(`T14 could not run: ${error.stack ?? error.message}`);
  process.exitCode = 2;
}
