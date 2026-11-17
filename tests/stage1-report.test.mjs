import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from '../lib/fixtures.mjs';
import { prepareContracts, ROOT } from '../lib/pins.mjs';
import { suiteRevision } from '../lib/report.mjs';
import { buildStage1Report, validateStage1Report } from '../lib/stage1-report.mjs';
import { STAGE1_CONTRACT } from '../lib/stage1-platform.mjs';

const hello = readJson(prepareContracts(), 'fixtures/positive/hello.first-start.json').input;
const sha = 'a'.repeat(40);
const platformContract = {
  revision: sha, path: 'registry/tests.yaml', registry_sha256: 'b'.repeat(64),
  strategy_path: 'docs/07-verification/test-strategy.md', strategy_sha256: 'c'.repeat(64),
  tests: Object.entries(STAGE1_CONTRACT).map(([id, value]) => ({ id, ...value })),
};
const observations = {
  T04: { requester: 'peer:agent_99999999-8888-4777-8666-555555555555', task_status: 'offered', directives: 0, grant_rows: 0, authority_receipts: 0 },
  T05: { response_count: 4, stable_receipt: true, task_revision: 1, task_status: 'accepted', committed_receipts: 1 },
  T20: { specialist_outcome: 'proposal', status_after_specialist: 'running', specialist_proposals: 1, lead_outcome: 'committed', final_status: 'completed', final_revision: 3 },
};
const result = {
  outcome: 'pass', profile: 'managed-cooperative',
  checks: ['T04', 'T05', 'T20'].map((id) => ({ id, title: id, gating: true, result: 'pass', observed: observations[id] })),
};

test('the Stage 1 report carries every required evidence field', () => {
  const report = buildStage1Report(result, { hello, platformContext: { revision: sha }, platformContract });
  assert.doesNotThrow(() => validateStage1Report(report));
  for (const mutate of [
    (value) => { delete value.definition_revision; },
    (value) => { delete value.dependency_versions.hq; },
    (value) => { value.enforcement_profile.in_force = undefined; },
    (value) => { value.adapter_versions = { 'fixture-adapter': '0.0.0' }; },
    (value) => { delete value.simulator_versions; },
    (value) => { value.platform_contract.registry_sha256 = 'bad'; },
    (value) => { value.platform_contract.tests[0].title = 'Changed'; },
    (value) => { value.policy_digest.value = 'd'.repeat(64); },
    (value) => { value.checks[1].observed.committed_receipts = 2; },
    (value) => { value.evidence_references = []; },
  ]) {
    const changed = structuredClone(report); mutate(changed); assert.throws(() => validateStage1Report(changed));
  }
});

test('the repeat-run Stage 1 artifact does not dirty or rehash suite provenance', (t) => {
  const path = join(ROOT, 'reports/stage1-latest.json');
  t.after(() => rmSync(path, { force: true }));
  rmSync(path, { force: true });
  const before = suiteRevision();
  writeFileSync(path, '{}\n');
  const after = suiteRevision();
  assert.equal(after.clean, before.clean);
  assert.equal(after.source_sha256, before.source_sha256);
});
