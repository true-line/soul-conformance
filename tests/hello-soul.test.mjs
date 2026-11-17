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
const seed = JSON.parse(readFileSync(join(template, 'task.json'), 'utf8'));
const proposal = {
  proposal_id: 'prop_1', task_id: 'task_1', member_id: 'm_spec', role: 'specialist',
  transition: 'completed', task_status: 'running', evidence: ['artifact_abc123'],
};
const observed = {
  profile: 'managed-cooperative',
  members: [{ member_id: 'm_lead', role: 'lead' }, { member_id: 'm_spec', role: 'specialist' }],
  task: {
    task_id: 'task_1', requester: 'owner', objective: seed.objective, done_criteria: seed.done_criteria,
    write_scope: seed.write_scope, status: 'completed', revision: 3, evidence: ['artifact_abc123', 'prop_1'],
  },
  proposals: [proposal],
  commits: [{ kind: 'task.commit', task_id: 'task_1', by: 'm_lead', outcome: 'committed', status: 'completed' }],
  chat: { exit_code: 0 },
  artifact: { id: 'artifact_abc123', exists: true },
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
  assert.equal(JSON.stringify([info, lock, adapters, seed]).includes('credential'), false);
});

test('the hello.soul report recomputes evidence and fails closed', () => {
  const report = buildHelloSoulReport({ outcome: 'pass', seed, observed }, {
    hello: { soul_id: info.soul_id, definition_digest: lock.definition_digest },
    platformContext: { revision: sha },
    platformContract,
  });
  assert.doesNotThrow(() => validateHelloSoulReport(report));
  for (const mutate of [
    (value) => { value.observations.profile = 'managed-protected'; },
    (value) => { value.observations.members.push({ member_id: 'm_extra', role: 'specialist' }); },
    (value) => { value.observations.proposals[0].role = 'lead'; },
    (value) => { value.observations.proposals[0].task_id = 'task_other'; },
    (value) => { value.observations.commits[0].by = 'm_spec'; },
    (value) => { value.observations.commits[0].task_id = 'task_other'; },
    (value) => { value.observations.task.status = 'running'; },
    (value) => { value.observations.chat.exit_code = 1; },
    (value) => { value.observations.artifact.exists = false; },
    (value) => { value.adapter_versions = {}; },
    (value) => { value.suite_revision.clean = false; },
    (value) => { value.dependency_versions.hq.commit = 'd'.repeat(40); },
    (value) => { value.dependency_versions.runtime.archive_sha256 = 'd'.repeat(64); },
    (value) => { value.dependency_versions['soul-contracts'].digest = `sha256:${'d'.repeat(64)}`; },
    (value) => { value.policy_digest.value = 'd'.repeat(64); },
    (value) => { value.evidence_references = []; },
  ]) {
    const changed = structuredClone(report);
    mutate(changed);
    assert.throws(() => validateHelloSoulReport(changed));
  }
});
