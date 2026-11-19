// The production terminal review function has one fixture seam for owner presence.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { reviewHQServiceRecovery } = await import(pathToFileURL(join(process.env.RECOVERY_SUBJECTS, 'identity/machine-service-recovery.mjs')));
const [challengeFile, fingerprint, keyFile] = process.argv.slice(2);
const proof = await reviewHQServiceRecovery(challengeFile, fingerprint, {
  sign: (challenge) => execFileSync(process.env.RECOVERY_OWNER, [keyFile], {
    encoding: 'utf8', input: JSON.stringify(challenge), timeout: 5000,
  }),
});
if (proof) process.stdout.write(JSON.stringify(proof));
