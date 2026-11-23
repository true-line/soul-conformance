import { spawnSync } from 'node:child_process';
import { closeSync, constants, openSync } from 'node:fs';
import { basename, isAbsolute, normalize } from 'node:path';

const STANDALONE_HELPER = '/Library/Application Support/ai.true-line.agent-bot-hq/standalone/hq-signer';
const denied = (error) => ['EACCES', 'EPERM'].includes(error?.code);
const absolutePath = (path) => typeof path === 'string' && isAbsolute(path)
  && normalize(path) === path && path !== '/';
const probeOptions = {
  env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
  cwd: '/',
  input: '{}',
  maxBuffer: 1024,
  timeout: 3000,
  encoding: 'utf8',
};

// Run in the admitted member process with the canary and UID from the
// reviewed A plan. A independently verifies the canary exists in HQ custody
// and the result came from the correct member. Never read bytes from it.
export function probeMemberCustody({ memberUid, hqCanary, keydPath }) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64'
    || !Number.isInteger(memberUid) || memberUid <= 0
    || process.getuid() !== memberUid || process.geteuid() !== memberUid) {
    throw new Error('T02 requires the admitted member UID on Apple Silicon macOS');
  }
  if (!absolutePath(hqCanary) || !absolutePath(keydPath) || basename(keydPath) !== 'agent-bot-keyd'
    || !keydPath.startsWith('/opt/homebrew/Cellar/')) {
    throw new Error('T02 requires reviewed HQ canary and bundled administrative keyd paths');
  }
  let fileRefusal;
  try {
    const fd = openSync(hqCanary, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    closeSync(fd);
  } catch (error) {
    if (!denied(error)) throw error;
    fileRefusal = error.code;
  }
  if (!fileRefusal) throw new Error('T02 member opened the HQ canary');

  // The bundled keyd must be inaccessible to the member even as an
  // executable. The deliberately empty request can never authorize use.
  const keyd = spawnSync(keydPath, ['hq-device'], probeOptions);
  if (!denied(keyd.error)) throw new Error('T02 member did not observe kernel refusal of the bundled keyd');

  // Status is the standalone helper's read-only custody check. If absent,
  // A must independently observe that no separate signer is installed.
  const result = spawnSync(STANDALONE_HELPER, ['standalone-v1-status'], probeOptions);
  let localSigner;
  if (denied(result.error)) localSigner = result.error.code;
  else if (result.error?.code === 'ENOENT') localSigner = 'absent';
  else if (!result.error && !result.signal && result.status === 1 && result.stdout === ''
    && result.stderr === 'HQ Secure Enclave signer unavailable\n') localSigner = 'signer-unavailable';
  if (!localSigner) throw new Error('T02 member did not observe a definite standalone signer boundary');
  return Object.freeze({ memberUid, fileRefusal, keydRefusal: keyd.error.code, localSigner });
}
