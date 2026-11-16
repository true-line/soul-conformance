// PDR-0020: resolve main fresh each run; SHA is evidence, never an operational pin.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export async function platformContext(fetcher = fetch) {
  const get = async (url) => {
    const r = await fetcher(url, { headers: { 'User-Agent': 'soul-conformance-T14', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`platform unavailable: HTTP ${r.status}`);
    return r.text();
  };
  const metadata = JSON.parse(await get('https://api.github.com/repos/true-line/agent-bot-platform/commits/main'));
  assert.match(metadata.sha ?? '', /^[0-9a-f]{40}$/);
  const paths = ['AGENTS.md', 'registry/tests.yaml', 'registry/requirements.yaml', 'docs/04-decisions/PDR-0020-components-read-the-platform-at-main.md', 'docs/00-governance/authority-and-ownership.md', 'docs/08-release/release-conformance-report.md'];
  const files = Object.fromEntries(await Promise.all(paths.map(async (p) => [p, await get(`https://raw.githubusercontent.com/true-line/agent-bot-platform/${metadata.sha}/${p}`)])));
  assert.match(files['registry/tests.yaml'], /^- id: T14$/m);
  assert.match(files['registry/requirements.yaml'], /^- id: R7$/m);
  assert.match(files[paths[3]], /^Status: Accepted$/m);
  for (const [p, body] of Object.entries(files)) assert.ok(body.trim(), `empty platform path ${p}`);
  return { revision: metadata.sha, fetchedAt: new Date().toISOString(), source: 'main (fresh, uncached)', files: Object.fromEntries(Object.entries(files).map(([p, body]) => [p, createHash('sha256').update(body).digest('hex')])) };
}
