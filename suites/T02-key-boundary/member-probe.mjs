import { spawnSync } from 'node:child_process';
import { closeSync, constants, openSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';

const STANDALONE_HELPER = '/Library/Application Support/ai.true-line.agent-bot-hq/standalone/hq-signer';
const denied = (error) => ['EACCES', 'EPERM'].includes(error?.code);

// Run in the admitted member process with the canary and UID from the
// reviewed A plan. A independently verifies the canary exists in HQ custody
// and the result came from the correct member. Never read bytes from it.
export function probeMemberCustody({ memberUid, hqCanary }) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64'
    || !Number.isInteger(memberUid) || memberUid <= 0
    || process.getuid() !== memberUid || process.geteuid() !== memberUid) {
    throw new Error('T02 requires the admitted member UID on Apple Silicon macOS');
  }
  if (typeof hqCanary !== 'string' || !isAbsolute(hqCanary) || normalize(hqCanary) !== hqCanary || hqCanary === '/') {
    throw new Error('T02 requires an absolute reviewed HQ canary path');
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

  // Status is the helper's read-only custody check. A missing tool, timeout,
  // arbitrary exit code or receipt containing output does not prove refusal.
  const result = spawnSync(STANDALONE_HELPER, ['standalone-v1-status'], {
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    cwd: '/',
    input: '{}',
    maxBuffer: 1024,
    timeout: 3000,
    encoding: 'utf8',
  });
  let signerRefusal;
  if (denied(result.error)) signerRefusal = result.error.code;
  else if (!result.error && !result.signal && result.status === 1 && result.stdout === ''
    && result.stderr === 'HQ Secure Enclave signer unavailable\n') signerRefusal = 'signer-unavailable';
  if (!signerRefusal) throw new Error('T02 member did not observe a definite standalone signer refusal');
  return Object.freeze({ memberUid, fileRefusal, signerRefusal });
}
