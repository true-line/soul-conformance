import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const mandatoryCaseIds = Object.freeze(JSON.parse(readFileSync(new URL('./case-inventory.json', import.meta.url))).mandatoryCaseIds);
assert.ok(mandatoryCaseIds.length > 0 && new Set(mandatoryCaseIds).size === mandatoryCaseIds.length);
export function requireRefusal(reply, expected, requestId) {
  assert.equal(reply?.ok, false, 'refusal must not report success');
  assert.equal(reply?.refusal?.error, expected, 'require the exact shared refusal, not a generic failure');
  assert.equal(reply?.host_refusal, undefined, 'host failure is not protocol refusal evidence');
  assert.equal(reply?.refusal?.request_id, requestId, 'refusal must correlate to the request');
}
export function requireHostRefusal(reply, expected) {
  assert.equal(reply?.ok, false);
  assert.equal(reply?.host_refusal?.code, expected);
  assert.equal(reply?.refusal, undefined);
}
export async function requireThrown(action, code) {
  let error;
  try { await action(); } catch (caught) { error = caught; }
  assert.ok(error, 'negative input must refuse');
  assert.equal(error.code, code, 'require the exact expected refusal');
}
export function verdict(cases) {
  const ids = cases.map((c) => c.id), required = new Set(mandatoryCaseIds);
  const inventoryErrors = [];
  if (new Set(ids).size !== ids.length) inventoryErrors.push('duplicate case IDs');
  for (const id of mandatoryCaseIds) if (!ids.includes(id)) inventoryErrors.push(`missing ${id}`);
  for (const c of cases) {
    if (!required.has(c.id)) inventoryErrors.push(`unexpected ${c.id}`);
    if (!['passed', 'failed'].includes(c.outcome)) inventoryErrors.push(`invalid outcome ${c.id}`);
  }
  return { implemented: inventoryErrors.length === 0 && cases.every((c) => c.outcome === 'passed') ? 'passed' : 'failed', overallT14: 'blocked', policyBlocked: true, inventoryErrors, blockers: ['No accepted controlled previous-supported-major inventory/bootstrap applicability decision exists for the v1-only implementations; see proposed platform Discussion 75.'] };
}

// Expand row Maps before hashing; JSON.stringify(Map) alone silently drops rows.
export function tableDigest(tables, include) {
  const rows = [...tables].filter(([name]) => include(name)).map(([name, records]) => [name, [...records]]);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
