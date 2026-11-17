import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const hash = (text) => createHash('sha256').update(text).digest('hex');
const unquote = (value) => value?.trim().replace(/^['"]|['"]$/g, '');
export const STAGE1_CONTRACT = Object.freeze({
  T04: { title: 'Source authority', stage: '1', stimulus: 'Peer claims owner approval', observation: 'Request remains peer data; no grant or directive is created.', verifies: ['R6'], trace_gap: null, implemented_in: 'soul-conformance' },
  T05: { title: 'Duplicate message', stage: '1', stimulus: 'Deliver an identical frame repeatedly', observation: 'One committed task transition; stable prior receipt returned.', verifies: [], trace_gap: 'Draft 0.4 Appendix D maps no requirement to this test; WP1 to assign.', implemented_in: 'soul-conformance' },
  T20: { title: 'Proposal only', stage: '1', stimulus: 'A specialist posts a final answer directly to a task', observation: "It is recorded as a proposal; only the lead's commitment finalizes.", verifies: ['R3'], trace_gap: null, implemented_in: 'soul-conformance' },
});
const STAGE1_PROFILE_RULE = "Stage 1 acceptance requires T04, T05 and T20 to demonstrate their required semantic observations under `managed-cooperative`; a blocked, skipped or reported-as-unenforced observation is not a pass. That evidence qualifies task-source authority, deduplication and proposal/finalization semantics only and makes no protected-host containment claim.";
const STAGE2A_PROFILE_RULE = "Stage 2a's protected-label gate remains separate: T01 to T03 pass under `managed-protected`, while T21 is the negative honesty check run under `managed-cooperative` and passes only when receipts name cooperative and every protected claim is refused with `profile_insufficient`.";

function parseBlock(text, id) {
  const match = text.match(new RegExp(`(?:^|\\n)- id: ${id}\\n([\\s\\S]*?)(?=\\n- id: |$)`));
  assert.ok(match, `${id}: missing from platform registry`);
  const body = match[1];
  const scalar = (key) => unquote(body.match(new RegExp(`^  ${key}: (.*)$`, 'm'))?.[1]);
  const verifiesLine = body.match(/^  verifies: *(.*)$/m);
  assert.ok(verifiesLine, `${id}: missing verifies`);
  const verifies = verifiesLine[1].trim() === '[]'
    ? []
    : [...body.matchAll(/^  - (R[0-9]+)$/gm)].map((row) => row[1]);
  return {
    id, title: scalar('title'), stage: scalar('stage'), stimulus: scalar('stimulus'), observation: scalar('observation'),
    verifies, trace_gap: scalar('trace-gap') ?? null, implemented_in: scalar('implemented-in'),
  };
}

export function validateStage1Registry(text) {
  assert.equal(typeof text, 'string');
  for (const id of Object.keys(STAGE1_CONTRACT)) {
    assert.equal([...text.matchAll(new RegExp(`^- id: ${id}$`, 'gm'))].length, 1, `${id}: expected exactly one registry row`);
  }
  const tests = Object.keys(STAGE1_CONTRACT).map((id) => parseBlock(text, id));
  for (const test of tests) {
    const expected = STAGE1_CONTRACT[test.id];
    assert.equal(test.title, expected.title, `${test.id}: title drift`);
    assert.equal(test.stage, expected.stage, `${test.id}: stage drift`);
    assert.equal(test.stimulus, expected.stimulus, `${test.id}: stimulus drift`);
    assert.equal(test.observation, expected.observation, `${test.id}: observation drift`);
    assert.deepEqual(test.verifies, expected.verifies, `${test.id}: requirement mapping drift`);
    assert.equal(test.trace_gap, expected.trace_gap, `${test.id}: trace-gap drift`);
    assert.equal(test.implemented_in, expected.implemented_in, `${test.id}: implementation owner drift`);
  }
  return { registry_sha256: hash(text), tests };
}

export function validateStage1Strategy(text) {
  assert.equal(typeof text, 'string');
  assert.ok(text.includes(STAGE1_PROFILE_RULE), 'platform strategy lacks the controlled Stage 1 cooperative-profile rule');
  assert.ok(text.includes(STAGE2A_PROFILE_RULE), 'platform strategy lacks the controlled Stage 2a profile boundary');
  assert.match(text, /this Stage 1 cooperative result is not protected evidence\./, 'platform strategy lacks the protected-evidence refusal');
  return { strategy_sha256: hash(text) };
}

export async function stage1PlatformContract(context, fetcher = fetch) {
  assert.match(context?.revision ?? '', /^[0-9a-f]{40}$/);
  const path = 'registry/tests.yaml';
  const strategyPath = 'docs/07-verification/test-strategy.md';
  const get = async (sourcePath) => {
    const response = await fetcher(`https://raw.githubusercontent.com/true-line/agent-bot-platform/${context.revision}/${sourcePath}`, {
      headers: { 'User-Agent': 'soul-conformance-stage1', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`platform Stage 1 source unavailable (${sourcePath}): HTTP ${response.status}`);
    return response.text();
  };
  const [registry, strategy] = await Promise.all([get(path), get(strategyPath)]);
  const contract = validateStage1Registry(registry);
  const profilePolicy = validateStage1Strategy(strategy);
  assert.equal(contract.registry_sha256, context.files?.[path], 'platform registry changed between context reads');
  return { revision: context.revision, path, strategy_path: strategyPath, ...contract, ...profilePolicy };
}
