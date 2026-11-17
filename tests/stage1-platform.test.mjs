import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStage1Registry, validateStage1Strategy } from '../lib/stage1-platform.mjs';

const registry = `tests:
- id: T04
  title: Source authority
  stage: '1'
  stimulus: Peer claims owner approval
  observation: Request remains peer data; no grant or directive is created.
  verifies:
  - R6
  implemented-in: soul-conformance
  implementation: not-started
- id: T05
  title: Duplicate message
  stage: '1'
  stimulus: Deliver an identical frame repeatedly
  observation: One committed task transition; stable prior receipt returned.
  verifies: []
  implemented-in: soul-conformance
  trace-gap: Draft 0.4 Appendix D maps no requirement to this test; WP1 to assign.
  implementation: not-started
- id: T20
  title: Proposal only
  stage: '1'
  stimulus: A specialist posts a final answer directly to a task
  observation: It is recorded as a proposal; only the lead's commitment finalizes.
  verifies:
  - R3
  implemented-in: soul-conformance
  implementation: not-started
`;
const strategy = `
Stage 1 acceptance requires T04, T05 and T20 to demonstrate their required semantic observations under \`managed-cooperative\`; a blocked, skipped or reported-as-unenforced observation is not a pass. That evidence qualifies task-source authority, deduplication and proposal/finalization semantics only and makes no protected-host containment claim. Stage 2a's protected-label gate remains separate: T01 to T03 pass under \`managed-protected\`, while T21 is the negative honesty check run under \`managed-cooperative\` and passes only when receipts name cooperative and every protected claim is refused with \`profile_insufficient\`. Together T01 to T03 and T21 gate a protected claim. A later release claiming \`managed-protected\` still follows the exact-cohort cumulative gate above; this Stage 1 cooperative result is not protected evidence.
`;

test('the exact controlled Stage 1 registry contract is accepted', () => {
  const contract = validateStage1Registry(registry);
  assert.deepEqual(contract.tests.map((row) => row.id), ['T04', 'T05', 'T20']);
  assert.match(contract.registry_sha256, /^[a-f0-9]{64}$/);
});

test('Stage 1 registry drift fails closed', () => {
  for (const changed of [
    registry.replace('- id: T04', '- id: T40'),
    `${registry}\n- id: T04\n  title: Duplicate source authority\n`,
    registry.replace('title: Source authority', 'title: Source authorization'),
    registry.replace("stage: '1'", "stage: '2a'"),
    registry.replace('Peer claims owner approval', 'Peer claims a grant'),
    registry.replace('One committed task transition; stable prior receipt returned.', 'At least one transition.'),
    registry.replace('  - R6', '  - R3'),
    registry.replace('  verifies: []', '  verifies:\n  - R7'),
    registry.replace('WP1 to assign.', 'resolved elsewhere.'),
    registry.replace('implemented-in: soul-conformance', 'implemented-in: agent-bot-hq'),
  ]) assert.throws(() => validateStage1Registry(changed));
});

test('the controlled Stage 1 profile rule is accepted and policy drift fails closed', () => {
  assert.match(validateStage1Strategy(strategy).strategy_sha256, /^[a-f0-9]{64}$/);
  for (const changed of [
    strategy.replace('managed-cooperative', 'managed-protected'),
    strategy.replace('a blocked, skipped or reported-as-unenforced observation is not a pass', 'unenforced may pass'),
    strategy.replace('makes no protected-host containment claim', 'qualifies protected containment'),
    strategy.replace("T21 is the negative honesty check run under `managed-cooperative`", "T21 runs under `managed-protected`"),
    strategy.replace('this Stage 1 cooperative result is not protected evidence.', ''),
  ]) assert.throws(() => validateStage1Strategy(changed));
});
