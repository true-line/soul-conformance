import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHelloSoulReport, validateHelloSoulReport } from '../lib/hello-soul-report.mjs';
import { ROOT } from '../lib/pins.mjs';

const template = join(ROOT, 'templates/hello.soul');
const info = JSON.parse(readFileSync(join(template, 'Contents/SoulInfo.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(template, 'Contents/SoulLock.json'), 'utf8'));
const adapters = JSON.parse(readFileSync(join(template, 'Contents/host/adapters.json'), 'utf8'));
const observed = {
  profile: 'managed-cooperative', member_count: 2, task_status: 'completed', task_revision: 3,
  proposal_count: 1, proposal_role: 'specialist', final_commitments: 1, final_by: 'm_lead',
  prompt_member: 'm_lead', artifact_exists: true,
};
const sha = 'a'.repeat(40);
const platformContract = {
  revision: sha, path: 'registry/tests.yaml', registry_sha256: 'b'.repeat(64),
  strategy_path: 'docs/07-verification/test-strategy.md', strategy_sha256: 'c'.repeat(64), tests: [],
};

test('hello.soul is a concrete two-member credential-free template', () => {
  assert.equal(info.soul_id, 'agent_0b3f1e2a-7c4d-4e8f-9a1b-2c3d4e5f6a7b');
  assert.deepEqual(info.members.map((member) => [member.member_id, member.role, member.adapter_id, member.adapter_version]), [
    ['m_lead', 'lead', 'fake-adapter', '0.1.0'],
    ['m_spec', 'specialist', 'fake-adapter', '0.1.0'],
  ]);
  assert.equal(lock.definition_digest, `sha256:${'a1'.repeat(32)}`);
  assert.deepEqual(adapters, { 'fake-adapter': { command: ['agent-bot-souls', 'fake-adapter'] } });
  assert.equal(JSON.stringify([info, lock, adapters]).includes('credential'), false);
});

test('the hello.soul report is fail-closed and carries the quickstart evidence', () => {
  const report = buildHelloSoulReport({ outcome: 'pass', observed }, {
    hello: { soul_id: info.soul_id, definition_digest: lock.definition_digest },
    platformContext: { revision: sha },
    platformContract,
  });
  assert.doesNotThrow(() => validateHelloSoulReport(report));
  for (const mutate of [
    (value) => { value.checks[0].observed.profile = 'managed-protected'; },
    (value) => { value.checks[0].observed.final_commitments = 2; },
    (value) => { value.checks[0].observed.proposal_count = 0; },
    (value) => { value.checks[0].observed.artifact_exists = false; },
    (value) => { value.adapter_versions = {}; },
    (value) => { value.policy_digest.value = 'd'.repeat(64); },
    (value) => { value.evidence_references = []; },
  ]) {
    const changed = structuredClone(report);
    mutate(changed);
    assert.throws(() => validateHelloSoulReport(changed));
  }
});
