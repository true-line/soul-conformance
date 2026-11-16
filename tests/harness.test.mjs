// Self-tests for the harness. A conformance run that cannot fail proves
// nothing, so each test feeds the T14 suite a subject that breaks one rule
// and checks the run catches it. Needs the pinned inputs (npm run prepare:pins).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFixtures, readJson } from '../lib/fixtures.mjs';
import { CACHE, CONTRACTS_PIN, canonicalManifest, prepareAll, verifyContracts } from '../lib/pins.mjs';
import { openBroker, openHQ, openRuntime } from '../lib/subjects.mjs';
import { runT14 } from '../lib/t14.mjs';

const { contracts, subjects } = prepareAll();
const fixtures = loadFixtures(contracts);
const hello = readJson(contracts, 'fixtures/positive/hello.first-start.json').input;
const accepted = { [hello.soul_id]: [hello.definition_digest] };
const real = async () => ({
  runtime: await openRuntime(subjects.runtime, contracts),
  broker: await openBroker(subjects.broker),
  hq: await openHQ(subjects.hq, contracts, { accepted }),
});
const run = (parts) => runT14({ contractsDir: contracts, pin: CONTRACTS_PIN, fixtures, ...parts });
const failed = (result) => result.checks.filter((c) => c.gating && c.result === 'fail').map((c) => c.id);

test('manifest canonical form sorts keys and refuses non-manifest values', () => {
  assert.equal(canonicalManifest({ b: { size: 1 }, a: 'x' }), '{"a":"x","b":{"size":1}}');
  assert.throws(() => canonicalManifest({ a: 1.5 }), TypeError);
  assert.throws(() => canonicalManifest([1]), TypeError);
});

test('a changed, extra or missing contract file is refused', (t) => {
  const work = mkdtempSync(join(CACHE, 'sc-pin-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  assert.doesNotThrow(() => verifyContracts(contracts));
  const changed = join(work, 'changed');
  cpSync(contracts, changed, { recursive: true });
  writeFileSync(join(changed, 'schemas/hq/v1/hello.schema.json'), '{}\n');
  assert.throws(() => verifyContracts(changed), /does not match v0\.4\.1/);
  const extra = join(work, 'extra');
  cpSync(contracts, extra, { recursive: true });
  writeFileSync(join(extra, 'fixtures/positive/planted.json'), '{}\n');
  assert.throws(() => verifyContracts(extra), /does not match/);
});

test('a negative whose base positive changed is refused by the loader', (t) => {
  const work = mkdtempSync(join(CACHE, 'sc-fx-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  cpSync(contracts, work, { recursive: true });
  const path = join(work, 'fixtures/positive/hello.first-start.json');
  const fx = readJson(work, 'fixtures/positive/hello.first-start.json');
  writeFileSync(path, `${JSON.stringify({ ...fx, note: 'edited' }, null, 2)}\n`);
  assert.throws(() => loadFixtures(work), /bytes changed/);
});

test('the real subjects pass the implemented current-major checks', async () => {
  const result = await run(await real());
  assert.deepEqual(failed(result), []);
  assert.equal(result.outcome, 'pass');
  assert.equal(result.totals.fixture_verdicts_failed, 0);
});

test('a runtime that accepts everything fails the fixture and capability checks', async () => {
  const parts = await real();
  const lax = { ...parts.runtime, receive: (fx) => ({ outcome: 'accepted', value: fx.input }), frame: (value) => ({ outcome: 'accepted', value }) };
  const result = await run({ ...parts, runtime: lax });
  assert.equal(result.outcome, 'fail');
  assert.ok(failed(result).includes('fixtures.runtime'));
  assert.ok(failed(result).includes('capability.unknown'));
  assert.ok(failed(result).includes('version.frame'));
});

test('a broker that refuses an unknown capability with the wrong code fails', async () => {
  const parts = await real();
  const wrong = { ...parts.broker, frame: (value, negotiated) => (value.required_capabilities.every((c) => negotiated.includes(c)) && value.wire_version === 1 ? { outcome: 'accepted', value } : { outcome: 'refused', code: 'bad-request' }) };
  const result = await run({ ...parts, broker: wrong });
  assert.deepEqual(failed(result), ['capability.unknown']);
});

test('an HQ that admits any version fails the unsupported-version checks', async () => {
  const parts = await real();
  const result0 = readJson(contracts, 'fixtures/positive/admission-result.ok.json').input;
  const permissive = { ...parts.hq, exchange: (fn) => fn({
    hello: async (p) => ({ ok: true, result: { ...result0, request_id: p.request_id } }),
    admit: async () => ({ ok: true, result: result0 }),
  }) };
  const result = await run({ ...parts, hq: permissive });
  const ids = failed(result);
  for (const id of ['version.unsupported-hq', 'version.unsupported-wire', 'fixtures.hq']) assert.ok(ids.includes(id), `${id} in ${ids}`);
});

test('a subject pinned to another contracts release fails the pin check', async () => {
  const parts = await real();
  const result = await run({ ...parts, runtime: { ...parts.runtime, pin: { ...parts.runtime.pin, digest: `sha256:${'0'.repeat(64)}` } } });
  assert.deepEqual(failed(result), ['pins.runtime']);
});

test('HQ refusal checks reject wrong correlation and unrelated post-refusal errors', async () => {
  for (const change of ['correlation', 'after']) {
    const parts = await real();
    const wrong = { ...parts.hq, exchange: (fn) => parts.hq.exchange((s) => fn({ ...s,
      hello: async (payload) => {
        const response = await s.hello(payload);
        if (change === 'correlation' && response.refusal) return { ...response, refusal: { ...response.refusal, request_id: 'unrelated' } };
        return response;
      },
      admit: async (id) => change === 'after' ? { ok: false, host_refusal: { code: 'host.invalid_request', explanation: 'unrelated validation failure' } } : s.admit(id),
    })) };
    const result = await run({ ...parts, hq: wrong });
    for (const id of ['version.unsupported-hq', 'version.unsupported-wire']) assert.ok(failed(result).includes(id));
  }
});
