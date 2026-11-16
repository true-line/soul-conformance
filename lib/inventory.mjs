// Independent inventory: an accidentally omitted runner loop cannot prove pass.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const fixtures = JSON.parse(readFileSync(new URL('../governance/t14-fixture-inventory.json', import.meta.url)));
export const CHECK_IDS = Object.freeze(['pins.runtime', 'pins.hq', 'pins.broker', 'coverage.fixtures', 'coverage.broker', 'fixtures.runtime', 'fixtures.broker', 'fixtures.hq', 'version.current', 'version.newer-peer', 'version.n-minus-1', 'version.unsupported-hq', 'version.unsupported-wire', 'version.unsupported-runtime', 'version.frame', 'capability.unknown', 'capability.control']);
function exact(actual, expected, label) {
  assert.equal(new Set(actual).size, actual.length, `${label}: duplicate cases`);
  assert.deepEqual([...actual].sort(), [...expected].sort(), `${label}: missing/unexpected cases`);
}
export function validateInventory(result) {
  exact(result.checks.map((c) => c.id), CHECK_IDS, 'checks');
  for (const check of result.checks) {
    if (check.id === 'version.n-minus-1') { assert.equal(check.gating, false); assert.equal(check.result, 'not-exercised'); }
    else { assert.equal(check.gating, true, `${check.id}: mandatory check ungated`); assert.ok(['pass', 'fail'].includes(check.result), `${check.id}: invalid outcome`); }
  }
  exact(result.fixtures.map((r) => `${r.subject}:${r.fixture}`), Object.entries(fixtures).flatMap(([subject, ids]) => ids.map((id) => `${subject}:${id}`)), 'fixtures');
  for (const row of result.fixtures) {
    const informational = row.subject === 'hq' && ['negative/hello.stale-epoch.json', 'negative/hello.unaccepted-definition.json', 'negative/hello.unsupported-profile.json'].includes(row.fixture) || row.subject === 'broker' && row.fixture === 'negative/wire-frame.stale-expiry.json';
    assert.equal(row.gating, !informational, `${row.subject}:${row.fixture}: incorrect gating`);
    assert.ok((row.fixture === 'negative/hello.stale-epoch.json' && row.subject === 'hq' ? ['not-run'] : ['pass', 'fail']).includes(row.result), 'invalid fixture outcome');
  }
  const passed = result.checks.filter((c) => c.gating).every((c) => c.result === 'pass') && result.fixtures.filter((r) => r.gating).every((r) => r.result === 'pass');
  assert.equal(result.outcome, passed ? 'pass' : 'fail', 'outcome contradicts mandatory cases');
}
export function tableDigest(tables) {
  // Expand row Maps; JSON.stringify(Map) would silently erase their contents.
  return createHash('sha256').update(JSON.stringify([...tables].map(([name, rows]) => [name, [...rows]]))).digest('hex');
}
