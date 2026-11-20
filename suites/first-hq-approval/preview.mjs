import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = join(process.env.FIRST_HQ_IDENTITY, 'machine-first-hq-review.mjs');
const { openFirstHQReview } = await import(pathToFileURL(source));
const { challenge, key, now } = JSON.parse(readFileSync(0, 'utf8'));
const home = mkdtempSync(join(tmpdir(), 'first-hq-daily-'));
const file = join(home, 'transfer.json');
let proof;
let reviewError;
let signed = false;

async function openBrowser(href) {
  try {
    const url = new URL(href);
    assert.equal(url.hostname, '127.0.0.1');
    async function post(action, token, body) {
      const response = await fetch(new URL(action, url), {
        method: 'POST', headers: {
          authorization: 'Bearer ' + token,
          origin: url.origin, 'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 200);
      return response.json();
    }
    const { session, review } = await post('claim', url.hash.slice(1), {});
    assert.equal(review.plan_id, challenge.plan_id);
    assert.equal(review.plan_digest, challenge.plan_digest);
    assert.deepEqual(review.plan.steps, JSON.parse(challenge.plan_canonical).steps);
    proof = await post('approve', session, { plan_digest: review.plan_digest });
  } catch (error) {
    reviewError = error;
    throw error;
  }
}

function signer(wire) {
  assert.equal(signed, false);
  signed = true;
  const bytes = Buffer.from(JSON.stringify(wire)).toString('base64');
  return execFileSync(process.env.FIRST_HQ_NATIVE, [], {
    input: JSON.stringify({ challenge: bytes, key, now }), encoding: 'utf8',
  });
}

try {
  writeFileSync(file, JSON.stringify(challenge), { mode: 0o600 });
  let browserDone;
  const state = await openFirstHQReview(file, { home, now: () => now, signer,
    openBrowser: (href) => (browserDone = openBrowser(href)),
  }).catch((error) => { throw reviewError ?? error; });
  await browserDone;
  assert.equal(state, 'approved');
  assert.equal(signed, true);
  process.stdout.write(JSON.stringify(proof));
} finally {
  rmSync(home, { recursive: true, force: true });
}
