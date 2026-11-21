import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const prefix = '/opt/homebrew';
const socket = join(prefix, 'var/agent-machine/daemon.sock');
const noNetwork = async () => { throw new Error('the T02 proof check must stay local'); };

export function requireDedicatedMac({ platform, arch, account }) {
  if (platform !== 'darwin' || arch !== 'arm64' || account.username !== '_agent-bot-hq') {
    throw new Error('run as the existing dedicated HQ role on Apple Silicon macOS');
  }
}

export function assertScratchSignerAbsent(home) {
  const signer = join(home, 'signer');
  const current = lstatSync(signer, { throwIfNoEntry: false });
  if (current && (!current.isDirectory() || ['device-key.pem', 'pin.json']
    .some((name) => lstatSync(join(signer, name), { throwIfNoEntry: false })))) {
    throw new Error('known local signer entries are present or cannot be inspected safely in the observation scratch');
  }
}

export async function waitForStatus(readStatus, available, { timeoutMs = 180_000, intervalMs = 500 } = {}) {
  const deadline = performance.now() + timeoutMs;
  do {
    let status;
    try { status = await readStatus(); }
    catch (error) {
      if (!(error.syscall === 'connect' && ['ENOENT', 'ECONNREFUSED'].includes(error.code))) throw error;
      if (!available) return;
    }
    if (available && status) return status;
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await delay(Math.min(remaining, intervalMs));
  } while (performance.now() < deadline);
  throw new Error(available ? 'signed Machine status did not return' : 'no Machine socket outage was observed');
}

function socketOwner(roleUid) {
  const owner = lstatSync(prefix).uid;
  const endpoint = lstatSync(socket);
  if (owner < 1 || owner === roleUid || !endpoint.isSocket() || endpoint.uid !== owner) {
    throw new Error('the paired Machine socket does not belong to the Homebrew prefix owner');
  }
  return owner;
}

// These are cross-phase checks. The production HQ signer has already
// verified the Machine envelope, request nonce and ES256 JWS for each phase.
export function verifyContinuity(before, after) {
  for (const name of ['daemonPin', 'statusState', 'thumbprint', 'generation', 'epoch', 'socketUid']) {
    if (before[name] === undefined || before[name] !== after[name]) throw new Error(`${name} changed across restart`);
  }
  if (!before.jti || !after.jti || before.jti === after.jti || !before.requestNonce || !after.requestNonce
    || before.requestNonce === after.requestNonce) throw new Error('restart did not produce a fresh request and proof');
}

// Only the hardware model identifier is recorded; no machine identifier or
// serial number belongs in this observation.
export function observationMetadata(model, nodeVersion, archiveSha256) {
  if (typeof model !== 'string' || model.length > 64 || !/^[A-Za-z]+[0-9]+,[0-9]+$/.test(model)) throw new Error('invalid hardware model identifier');
  if (typeof nodeVersion !== 'string' || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(nodeVersion)) throw new Error('invalid Node version');
  if (typeof archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(archiveSha256)) throw new Error('invalid verified HQ archive digest');
  return { hardware_model: model, node_version: nodeVersion, hq_archive_sha256: archiveSha256 };
}

async function run(argv) {
  const account = userInfo();
  const uid = process.getuid?.();
  const euid = process.geteuid?.();
  requireDedicatedMac({ platform: process.platform, arch: process.arch, account });
  const checkpoints = argv[3] === '--checkpoints';
  if (argv.length !== (checkpoints ? 4 : 3) || argv[0] !== '--verified-cache' || argv[2] !== '--disposable') {
    throw new Error('usage: paired-proof.mjs --verified-cache PATH --disposable [--checkpoints]');
  }
  const archive = 't02-hq';
  const pin = JSON.parse(readFileSync(join(repo, 'governance/archives.json'), 'utf8')).archives[archive];
  const hq = execFileSync('python3', [join(repo, 'scripts/archive.py'), archive, resolve(argv[1]), '--verify'], {
    encoding: 'utf8', timeout: 60_000,
  }).trim();
  const fromHQ = (name) => import(pathToFileURL(join(hq, 'hq', name + '.mjs')).href);
  const { machineAccountLayout, machineRoleCommand, machineRoleDevice } = await fromHQ('machine-channel');
  const { createMachineSigner } = await fromHQ('machine-device');
  const { createEnrollment, DEFAULT_IDENTITY_SERVICE } = await fromHQ('enrollment');
  machineAccountLayout(account, process.platform, uid, euid, true);

  // The role's registered home is used only as the parent of this new private
  // directory. HQ's signing client still reads its existing paired role pin.
  const home = mkdtempSync(join(realpathSync(account.homedir), 't02-observation-'));
  try {
    await observePairedSigning({ home, uid, machineRoleCommand, machineRoleDevice, createMachineSigner, createEnrollment,
      audience: DEFAULT_IDENTITY_SERVICE + '/oauth/device_authorization', pin, checkpoints });
  } finally { rmSync(home, { recursive: true, force: true }); }
}

async function observePairedSigning({ home, uid, machineRoleCommand, machineRoleDevice, createMachineSigner, createEnrollment, audience, pin, checkpoints }) {
  const scratch = lstatSync(home);
  if (scratch.uid !== uid || (scratch.mode & 0o7777) !== 0o700) throw new Error('could not create private observation scratch');
  assertScratchSignerAbsent(home);
  let signedProof;
  let boundIdentity;
  const signer = createMachineSigner({
    home,
    enrollment: (device) => createEnrollment({ home, signer: device, fetchImpl: noNetwork }),
    async request(operation, fields) {
      const result = await machineRoleDevice(operation, fields);
      if (operation === 'identity') boundIdentity = Object.hasOwn(result.body, 'device_id');
      if (operation === 'enrollment-proof') signedProof = result;
      return result;
    },
  });
  async function readStatus() {
    const status = await machineRoleCommand(['status', '--socket', socket]);
    // A hosted native fixture has no status reporter and signs `idle`.
    if (status.channel !== 'signed' || !['reported', 'idle'].includes(status.state)) throw new Error('signed paired status was unavailable');
    return status;
  }
  async function observe(status) {
    const socketUid = socketOwner(uid);
    if (await signer.deviceStatus() !== 'unenrolled' || boundIdentity !== false) {
      throw new Error('the proof check requires an initialized but unenrolled disposable Machine device');
    }
    signedProof = undefined;
    const proof = await signer.enrollmentProof(audience);
    const report = signer.report();
    if (!signedProof || report.backend !== 'machine' || report.key_storage !== 'hardware') {
      throw new Error('HQ did not verify the paired device with reported hardware custody');
    }
    assertScratchSignerAbsent(home);
    return {
      socketUid, daemonPin: status.daemon_fingerprint, statusState: status.state, thumbprint: report.thumbprint, generation: report.generation,
      epoch: signedProof.body.hq_epoch, requestNonce: signedProof.request_nonce,
      jti: JSON.parse(Buffer.from(proof.split('.')[1], 'base64url')).jti,
    };
  }

  const before = await observe(await readStatus());
  console.error(checkpoints ? 'T02:before' : 'Verified the first proof. Waiting for the disposable Machine socket to become unavailable.');
  await waitForStatus(readStatus, false);
  let refusal;
  try { await signer.enrollmentProof(audience); } catch (error) { refusal = error; }
  if (refusal?.code !== 'credential_unavailable' || !/HQ could not connect to the paired Machine/.test(refusal.message)) {
    throw new Error('the permitted signature did not return the expected Machine outage refusal');
  }
  assertScratchSignerAbsent(home);
  console.error(checkpoints ? 'T02:offline' : 'Verified the outage refusal. Waiting for the disposable Machine service to return.');
  const after = await observe(await waitForStatus(readStatus, true));
  verifyContinuity(before, after);
  const os = (option) => execFileSync('/usr/bin/sw_vers', [option], { encoding: 'utf8', timeout: 5000 }).trim();
  const model = execFileSync('/usr/sbin/sysctl', ['-n', 'hw.model'], { encoding: 'utf8', timeout: 5000 }).trim();
  // archive.py --verify has checked the pinned archive bytes and extraction.
  const metadata = observationMetadata(model, process.version, pin.sha256);
  console.log(JSON.stringify({ scope: 'T02 paired positive signing observation', outcome: 'observed', host_qualification: 'not_assessed',
    hq_commit: pin.commit, ...metadata, platform: process.platform, arch: process.arch, macos: os('-productVersion'), build: os('-buildVersion'),
    hq_uid: uid, machine_socket_uid: after.socketUid, signed_status_state: after.statusState, verified_es256: true, offline_refusal: refusal.code,
    same_pairing_and_generation: true, fresh_proof: true, scratch_signer_paths_absent: ['signer/device-key.pem', 'signer/pin.json'] }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
