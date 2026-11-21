import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertScratchSignerAbsent, observationMetadata, requireDedicatedMac, verifyContinuity, waitForStatus } from '../suites/T02-key-boundary/paired-proof.mjs';

test('the report records only a model identifier, Node version and verified archive digest', () => {
  const digest = 'a'.repeat(64);
  assert.deepEqual(observationMetadata('VirtualMac2,1', 'v24.19.0', digest), {
    hardware_model: 'VirtualMac2,1', node_version: 'v24.19.0', hq_archive_sha256: digest,
  });
  for (const model of ['Mac14,10', 'MacBookPro18,3']) assert.equal(observationMetadata(model, 'v24.19.0', digest).hardware_model, model);
  assert.throws(() => observationMetadata('Mac model with spaces', 'v24.19.0', digest), /model/);
  assert.throws(() => observationMetadata('Mac16-13', 'v24.19.0', digest), /model/);
  assert.throws(() => observationMetadata('C02ABC12345', 'v24.19.0', digest), /model/);
  assert.throws(() => observationMetadata('Mac14,12', 'node 24', digest), /Node/);
  assert.throws(() => observationMetadata('Mac14,12', 'v24.19.0', 'a'.repeat(63)), /digest/);
});

test('the paired observation requires Apple Silicon macOS and the dedicated role', () => {
  const role = { platform: 'darwin', arch: 'arm64', account: { username: '_agent-bot-hq' } };
  assert.doesNotThrow(() => requireDedicatedMac(role));
  for (const changes of [{ arch: 'x64' }, { platform: 'linux' }, { account: { username: 'ordinary' } }]) {
    assert.throws(() => requireDedicatedMac({ ...role, ...changes }), /existing dedicated HQ role/);
  }
});

test('restart comparison requires an unchanged paired identity and fresh verifier outputs', () => {
  const before = { daemonPin: 'pin-a', statusState: 'reported', thumbprint: 'key-a', generation: 1, epoch: 'epoch-a', socketUid: 501,
    jti: 'first-proof', requestNonce: 'first-request' };
  const after = { ...before, jti: 'second-proof', requestNonce: 'second-request' };
  assert.doesNotThrow(() => verifyContinuity(before, after));
  for (const field of ['daemonPin', 'statusState', 'thumbprint', 'generation', 'epoch', 'socketUid']) {
    assert.throws(() => verifyContinuity(before, { ...after, [field]: 'changed' }), /changed across restart/);
  }
  assert.throws(() => verifyContinuity(before, { ...after, jti: before.jti }), /fresh request and proof/);
  assert.throws(() => verifyContinuity(before, { ...after, requestNonce: before.requestNonce }), /fresh request and proof/);
});

test('the scratch observation detects any entry at the two known local signer paths', (t) => {
  const home = mkdtempSync(join(tmpdir(), 't02-scratch-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  assert.doesNotThrow(() => assertScratchSignerAbsent(home));
  const signer = join(home, 'signer');
  mkdirSync(signer);
  assert.doesNotThrow(() => assertScratchSignerAbsent(home));
  const pin = join(signer, 'pin.json');
  symlinkSync(join(home, 'missing'), pin);
  assert.throws(() => assertScratchSignerAbsent(home), /known local signer entries/);
  rmSync(pin);
  writeFileSync(join(signer, 'device-key.pem'), 'fixture file');
  assert.throws(() => assertScratchSignerAbsent(home), /known local signer entries/);
  rmSync(signer, { recursive: true });
  symlinkSync(join(home, 'missing'), signer);
  assert.throws(() => assertScratchSignerAbsent(home), /known local signer entries/);
});

test('supervised transitions only accept real connection refusal as an outage', async () => {
  const offline = Object.assign(new Error('fixture socket refused'), { syscall: 'connect', code: 'ECONNREFUSED' });
  const signature = new Error('Machine status signature does not match the daemon pin');
  const status = { channel: 'signed', state: 'idle' };
  let responses = [status, offline];
  const next = async () => {
    const result = responses.shift();
    if (result instanceof Error) throw result;
    return result;
  };
  const opts = { intervalMs: 1, timeoutMs: 1_000 };
  await waitForStatus(next, false, opts);
  responses = [offline, status];
  assert.deepEqual(await waitForStatus(next, true, opts), status);
  responses = [signature];
  await assert.rejects(waitForStatus(next, false, opts), (error) => error === signature);
  await assert.rejects(waitForStatus(async () => status, false, { timeoutMs: 0 }), /no Machine socket outage/);
});
