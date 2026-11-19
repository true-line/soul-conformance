import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, writeFileSync } from 'node:fs';

const suite = process.env.RECOVERY_SUITE;
const { machineCommandInHome } = await import(pathToFileURL(join(process.env.RECOVERY_SUBJECTS, 'hq/hq/machine-channel.mjs')));
const [work, hqHome, socket, machineKey, planID, planDigest, approvalPath] = process.argv.slice(2);
const run = (...args) => machineCommandInHome(args, hqHome, process.getuid());
const fingerprint = createHash('sha256').update(Buffer.from(machineKey, 'hex')).digest('hex');
const status = await run('status', '--socket', socket, '--daemon-key', machineKey);
assert.equal(status.daemon_fingerprint, fingerprint);

const transfer = join(work, 'challenge.json');
const proof = join(work, 'proof.json');
async function exportChallenge() {
  const line = await run('hq-service-recovery', 'export', planID, '--socket', socket);
  assert.equal(JSON.parse(line).body.plan_digest, planDigest);
  writeFileSync(transfer, line, { mode: 0o600 });
}
const review = (decision) => execFileSync('python3', [
  join(suite, 'terminal.py'), process.execPath, join(suite, 'review.mjs'),
  transfer, fingerprint, join(work, 'fixture-owner.key'), decision,
], { timeout: 25_000 });
const submit = () => run('hq-service-recovery', 'approve', '--challenge-file', transfer, '--proof-file', proof, '--socket', socket);

await exportChallenge();
assert.equal(review('discard').length, 0);
assert.equal(existsSync(approvalPath), false);
assert.equal((await run('hq-service-recovery', 'cancel', '--challenge-file', transfer, '--socket', socket)).state, 'cancelled');
assert.equal(existsSync(approvalPath), false);

await exportChallenge();
writeFileSync(proof, review('approve'), { mode: 0o600 });
const approved = await submit();
assert.equal(approved.state, 'approved');
assert.equal(approved.plan_id, planID);
assert.equal(approved.plan_digest, planDigest);
await assert.rejects(submit(), /Machine refused/);
