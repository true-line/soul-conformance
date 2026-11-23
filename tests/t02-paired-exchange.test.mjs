import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { pairedCaseNonce, verifyPairedExchange } from '../suites/T02-key-boundary/paired-exchange.mjs';

const hq = generateKeyPairSync('ed25519');
const machine = generateKeyPairSync('ed25519');
const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const rawPublicKey = pair => pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
const expectedEpoch = '1'.repeat(64);
const observedAt = 1_795_440_000;
const jsonSegment = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function exchange({ command: changes, audience, storage, corruptDevice, corruptRequest, corruptResponse } = {}) {
  const commandBytes = Buffer.from(JSON.stringify({
    schema: 'agent-bot-machine/qualification-owner-driver/v1', kind: 'capture',
    session_id: 'a'.repeat(32), installation_id: 'i_1', start_id: 'st_' + 'b'.repeat(24),
    reservation_sha256: 'sha256:' + 'c'.repeat(64), test_plan_sha256: 'sha256:' + 'd'.repeat(64),
    challenge_base64url: Buffer.alloc(32, 7).toString('base64url'),
    sequence: 3, profile: 'managed-protected', phase: 'live-start', gate: 'T02', event: 'paired-operation',
    ...changes,
  }));
  const nonce = pairedCaseNonce(commandBytes);
  const requestValue = ['hq-device', '', 'enrollment-proof', '', '', '', '', '', observedAt,
    nonce, 'hq_epoch', expectedEpoch].join('\n');
  const request = {
    verb: 'hq-device', option: 'enrollment-proof', hq_epoch: expectedEpoch, timestamp: observedAt,
    nonce, public_key: rawPublicKey(hq).toString('base64'),
    signature: sign(null, Buffer.from(requestValue), (corruptRequest ? machine : hq).privateKey).toString('base64'),
  };
  const { x, y } = device.publicKey.export({ format: 'jwk' });
  const jwk = { kty: 'EC', crv: 'P-256', x, y };
  const thumbprint = createHash('sha256').update(JSON.stringify({ crv: 'P-256', kty: 'EC', x, y })).digest('base64url');
  const header = { alg: 'ES256', typ: 'ab-enroll+jwt', jwk };
  const jti = 'a-fresh-proof-identifier';
  const claims = { aud: audience ?? 'https://agents.true-line.ai/oauth/device_authorization', iat: observedAt, jti };
  const proofPayload = jsonSegment(header) + '.' + jsonSegment(claims);
  const signature = sign('sha256', Buffer.from(proofPayload), { key: device.privateKey, dsaEncoding: 'ieee-p1363' });
  if (corruptDevice) signature[0] ^= 1;
  const body = { hq_epoch: expectedEpoch, jwk, thumbprint, generation: 1,
    key_storage: storage ?? 'hardware', proof: proofPayload + '.' + signature.toString('base64url') };
  const responseNonce = 'machine-response-nonce';
  const responseValue = [true, '', '', 'proved', JSON.stringify(body), observedAt, responseNonce, nonce].join('\n');
  const response = {
    ok: true, state: 'proved', body, timestamp: observedAt, nonce: responseNonce, request_nonce: nonce,
    signature: sign(null, Buffer.from(responseValue), (corruptResponse ? hq : machine).privateKey).toString('base64'),
  };
  return {
    input: { commandBytes, requestRaw: JSON.stringify(request), responseRaw: JSON.stringify(response),
      hqKey: rawPublicKey(hq), machineKey: rawPublicKey(machine), expectedEpoch, observedAt },
    expected: { epoch: expectedEpoch, thumbprint, generation: 1, requestNonce: nonce, jti },
  };
}

test('T02 verifies the fixed-purpose device proof and both paired channel signatures', () => {
  const { input, expected } = exchange();
  assert.deepEqual(verifyPairedExchange(input), expected);
  assert.throws(() => verifyPairedExchange({ ...input, observedAt: observedAt + 121 }), /unexpected HQ request/);
  assert.throws(() => verifyPairedExchange({ ...input, requestRaw: input.requestRaw.replace('{"verb":', '{"verb":"ignored","verb":') }),
    /duplicate fields/);
});

test('T02 rejects replay across distinct A start, restart, reservation, challenge, or sequence', () => {
  const { input } = exchange();
  for (const command of [
    { start_id: 'st_' + 'e'.repeat(24) },
    { session_id: '0'.repeat(32), phase: 'live-restart' },
    { reservation_sha256: 'sha256:' + 'f'.repeat(64) },
    { challenge_base64url: Buffer.alloc(32, 6).toString('base64url') },
    { sequence: 4 },
  ]) {
    assert.throws(() => verifyPairedExchange({ ...input, commandBytes: exchange({ command }).input.commandBytes }),
      /unexpected HQ request/);
  }
});

test('T02 refuses bad channel signatures, a bad ES256 signature, wrong purpose and software custody', () => {
  for (const bad of [{ corruptRequest: true }, { corruptResponse: true }]) {
    assert.throws(() => verifyPairedExchange(exchange(bad).input), /invalid channel signature/);
  }
  assert.throws(() => verifyPairedExchange(exchange({ corruptDevice: true }).input), /invalid device signature/);
  assert.throws(() => verifyPairedExchange(exchange({ audience: 'https://example.com' }).input), /unexpected enrollment proof purpose/);
  assert.throws(() => verifyPairedExchange(exchange({ storage: 'software' }).input), /unexpected device identity/);
});
