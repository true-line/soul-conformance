import { createHash, createPublicKey, verify } from 'node:crypto';

const DRIVER_SCHEMA = 'agent-bot-machine/qualification-owner-driver/v1';
const OUTAGE_PURPOSE = 'agent-bot-hq/t02-machine-outage/v1';
const CASES = new Map([
  ['paired-operation', ['live-start', 'live-restart']],
  ['machine-outage-refused', ['machine-outage']],
  ['pairing-revoked-refused', ['pairing-revoked']],
]);
const AUDIENCE = 'https://agents.true-line.ai/oauth/device_authorization';
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const digest = /^sha256:[a-f0-9]{64}$/;
const epoch = /^(?:legacy|[a-f0-9]{64})$/;
const requestKeys = ['verb', 'option', 'hq_epoch', 'timestamp', 'nonce', 'public_key', 'signature'];

function requireValid(ok, message) {
  if (!ok) throw new Error('T02 ' + message);
}

function exact(value, fields) {
  return value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
}

function decode(value, encoding, size) {
  requireValid(typeof value === 'string', 'invalid encoded value');
  const bytes = Buffer.from(value, encoding);
  requireValid((size === undefined || bytes.length === size) && bytes.toString(encoding) === value, 'invalid encoding');
  return bytes;
}

function compactObject(raw) {
  requireValid(typeof raw === 'string' && raw.length <= 8192, 'invalid wire size');
  const value = JSON.parse(raw);
  requireValid(value && Object.getPrototypeOf(value) === Object.prototype && JSON.stringify(value) === raw,
    'expected compact JSON without duplicate fields');
  return value;
}

function verifyEd25519(pinnedKey, value, signature) {
  requireValid(Buffer.isBuffer(pinnedKey) && pinnedKey.length === 32, 'missing Ed25519 pin');
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, pinnedKey]), type: 'spki', format: 'der' });
  requireValid(verify(null, Buffer.from(value), key, decode(signature, 'base64', 64)), 'invalid channel signature');
}

// Bind the existing Machine nonce to A's exact framed command payload. A
// supplies those bytes from its own transcript, without the length prefix.
function parsePairedCase(commandBytes) {
  requireValid(Buffer.isBuffer(commandBytes) && commandBytes.length <= 8192, 'invalid A command bytes');
  const command = compactObject(commandBytes.toString('ascii'));
  requireValid(commandBytes.equals(Buffer.from(JSON.stringify(command), 'ascii'))
    && exact(command, ['schema', 'kind', 'session_id', 'installation_id', 'start_id',
      'reservation_sha256', 'test_plan_sha256', 'challenge_base64url', 'sequence', 'profile', 'phase', 'gate', 'event'])
    && command.schema === DRIVER_SCHEMA && command.kind === 'capture'
    && /^[a-f0-9]{32}$/.test(command.session_id) && /^st_[a-f0-9]{24}$/.test(command.start_id)
    && typeof command.installation_id === 'string' && command.installation_id.length > 0
    && digest.test(command.reservation_sha256) && digest.test(command.test_plan_sha256)
    && Number.isInteger(command.sequence) && command.sequence > 0 && command.sequence <= 1024
    && command.profile === 'managed-protected' && command.gate === 'T02'
    && CASES.get(command.event)?.includes(command.phase),
  'invalid paired operation command');
  decode(command.challenge_base64url, 'base64url', 32);
  const nonce = createHash('sha256').update('soul-conformance/T02/paired-operation/v1\0')
    .update(commandBytes).digest().subarray(0, 16).toString('base64url');
  return { nonce, event: command.event };
}

export function pairedCaseNonce(commandBytes) {
  return parsePairedCase(commandBytes).nonce;
}

function verifyProof(body, timestamp, expectedEpoch) {
  requireValid(exact(body, ['hq_epoch', 'jwk', 'thumbprint', 'generation', 'key_storage', 'proof'])
    && body.hq_epoch === expectedEpoch && body.key_storage === 'hardware'
    && Number.isSafeInteger(body.generation) && body.generation > 0
    && exact(body.jwk, ['kty', 'crv', 'x', 'y']) && body.jwk.kty === 'EC' && body.jwk.crv === 'P-256'
    && typeof body.proof === 'string', 'unexpected device identity');
  const { x, y } = body.jwk;
  decode(x, 'base64url', 32);
  decode(y, 'base64url', 32);
  const thumbprint = createHash('sha256').update(JSON.stringify({ crv: 'P-256', kty: 'EC', x, y })).digest('base64url');
  requireValid(body.thumbprint === thumbprint, 'device thumbprint does not match');
  const parts = body.proof.split('.');
  requireValid(parts.length === 3, 'invalid enrollment proof');
  const header = compactObject(decode(parts[0], 'base64url').toString('utf8'));
  const claims = compactObject(decode(parts[1], 'base64url').toString('utf8'));
  requireValid(exact(header, ['alg', 'typ', 'jwk']) && header.alg === 'ES256' && header.typ === 'ab-enroll+jwt'
    && exact(header.jwk, ['kty', 'crv', 'x', 'y'])
    && Object.keys(body.jwk).every(key => header.jwk[key] === body.jwk[key])
    && exact(claims, ['aud', 'iat', 'jti']) && claims.aud === AUDIENCE
    && Number.isSafeInteger(claims.iat) && Math.abs(claims.iat - timestamp) <= 120
    && typeof claims.jti === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(claims.jti),
  'unexpected enrollment proof purpose or identity');
  const key = createPublicKey({ key: body.jwk, format: 'jwk' });
  requireValid(verify('sha256', Buffer.from(parts.slice(0, 2).join('.')), { key, dsaEncoding: 'ieee-p1363' },
    decode(parts[2], 'base64url', 64)), 'invalid device signature');
  return claims.jti;
}

// Verify the released hq-device enrollment-proof wire signatures. The caller
// supplies independently pinned HQ and Machine keys, pairing epoch and A's
// observation clock. Hardware, executing UID and offline status still need
// independent OS evidence from A.
export function verifyPairedExchange({ commandBytes, requestRaw, responseRaw, outageSignature, hqKey, machineKey, expectedEpoch, observedAt }) {
  const { nonce, event } = parsePairedCase(commandBytes);
  const request = compactObject(requestRaw);
  const timestamp = (t) => Number.isSafeInteger(t) && Math.abs(t - observedAt) <= 120;
  requireValid(Number.isSafeInteger(observedAt) && typeof expectedEpoch === 'string' && epoch.test(expectedEpoch)
    && Buffer.isBuffer(hqKey) && Buffer.isBuffer(machineKey) && !hqKey.equals(machineKey),
  'invalid independent pairing pins or observation time');
  requireValid(exact(request, requestKeys) && request.verb === 'hq-device' && request.option === 'enrollment-proof'
    && request.hq_epoch === expectedEpoch && request.nonce === nonce && timestamp(request.timestamp)
    && decode(request.public_key, 'base64', 32).equals(hqKey), 'unexpected HQ request');
  verifyEd25519(hqKey, ['hq-device', '', 'enrollment-proof', '', '', '', '', '', request.timestamp,
    nonce, 'hq_epoch', expectedEpoch].join('\n'), request.signature);

  if (event === 'machine-outage-refused') {
    requireValid(responseRaw === undefined, 'unexpected response during Machine outage');
    const requestHash = createHash('sha256').update(requestRaw).digest('hex');
    verifyEd25519(hqKey, [OUTAGE_PURPOSE, requestHash, 'machine-unreachable'].join('\n'), outageSignature);
    return Object.freeze({ requestNonce: nonce, refusal: 'machine-unreachable' });
  }

  requireValid(outageSignature === undefined, 'outage evidence does not belong to this case');
  const response = compactObject(responseRaw);
  const replyFields = ['ok', 'timestamp', 'nonce', 'request_nonce', 'signature'];
  requireValid(response.request_nonce === nonce && timestamp(response.timestamp)
    && response.timestamp >= request.timestamp && typeof response.nonce === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(response.nonce), 'unexpected signed Machine response');
  if (event === 'pairing-revoked-refused') {
    requireValid(exact(response, [...replyFields, 'diagnostic', 'message']) && response.ok === false
      && ['MM_DAEMON_PEER_REFUSED', 'MM_DAEMON_UNKNOWN_KEY'].includes(response.diagnostic)
      && typeof response.message === 'string' && !/[\r\n]/.test(response.message), 'unexpected pairing refusal');
    verifyEd25519(machineKey, [false, response.diagnostic, response.message, '', '', response.timestamp,
      response.nonce, nonce].join('\n'), response.signature);
    // The diagnostic proves a refused paired request. A separately observes
    // revocation of the exact pairing and the absence of signing side effects.
    return Object.freeze({ requestNonce: nonce, refusal: response.diagnostic });
  }

  // Go authenticates the exact raw JSON body. The compact-object check
  // guarantees the reconstructed body has the same bytes as the wire.
  requireValid(exact(response, [...replyFields, 'state', 'body'])
    && response.ok === true && response.state === 'proved', 'unexpected signed Machine response');
  verifyEd25519(machineKey, [true, '', '', 'proved', JSON.stringify(response.body), response.timestamp,
    response.nonce, nonce].join('\n'), response.signature);
  const jti = verifyProof(response.body, response.timestamp, expectedEpoch);
  return Object.freeze({ epoch: expectedEpoch, thumbprint: response.body.thumbprint,
    generation: response.body.generation, requestNonce: nonce, jti });
}
