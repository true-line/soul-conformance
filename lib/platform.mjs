// PDR-0020: resolve platform main for each run, never a cached operational pin.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const safePath = (value) => typeof value === 'string' && value.length && /^[A-Za-z0-9._/-]+$/.test(value) && !value.startsWith('/') && value.split('/').every((p) => p && p !== '.' && p !== '..');
export async function platformContext(fetcher = fetch) {
  const get = async (url, optional = false) => {
    const headers = { 'User-Agent': 'soul-conformance-T14', 'Cache-Control': 'no-cache' };
    if (new URL(url).hostname === 'api.github.com' && process.env.SOUL_CONFORMANCE_GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.SOUL_CONFORMANCE_GITHUB_TOKEN}`;
      headers['X-GitHub-Api-Version'] = '2022-11-28';
    }
    const response = await fetcher(url, { headers, signal: AbortSignal.timeout(30000) });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`platform/source unavailable: HTTP ${response.status}`);
    return response.text();
  };
  const metadata = JSON.parse(await get('https://api.github.com/repos/true-line/agent-bot-platform/commits/main'));
  assert.match(metadata.sha ?? '', /^[0-9a-f]{40}$/);
  const raw = `https://raw.githubusercontent.com/true-line/agent-bot-platform/${metadata.sha}/`;
  const paths = ['AGENTS.md', 'registry/tests.yaml', 'registry/requirements.yaml', 'docs/04-decisions/PDR-0020-components-read-the-platform-at-main.md', 'docs/00-governance/authority-and-ownership.md', 'docs/08-release/release-conformance-report.md'];
  const files = Object.fromEntries(await Promise.all(paths.map(async (p) => [p, await get(raw + p)])));
  assert.match(files['registry/tests.yaml'], /^- id: T14$/m);
  assert.match(files['registry/requirements.yaml'], /^- id: R7$/m);
  assert.match(files[paths[3]], /^Status: Accepted$/m);
  for (const [p, body] of Object.entries(files)) assert.ok(body.trim(), `empty platform path ${p}`);
  const context = { revision: metadata.sha, fetched_at: new Date().toISOString(), source: 'main (fresh, uncached)', files: Object.fromEntries(Object.entries(files).map(([p, body]) => [p, hash(body)])) };
  const inventoryPath = 'registry/protocol-compatibility.json';
  const text = await get(raw + inventoryPath, true);
  if (text === null) return { ...context, compatibility: { status: 'blocked', reason: 'Controlled protocol compatibility inventory is absent at fetched platform main.' } };
  context.files[inventoryPath] = hash(text);
  const inventory = JSON.parse(text);
  assert.equal(inventory.schema_version, 1, 'unsupported compatibility inventory schema');
  assert.ok(['Proposed', 'Accepted'].includes(inventory.status), 'invalid inventory status');
  assert.equal(inventory.decision, 'PDR-0075');
  if (inventory.status !== 'Accepted') return { ...context, compatibility: { status: 'blocked', reason: 'Compatibility decision/inventory is not Accepted.', inventory_sha256: hash(text) } };
  assert.ok(safePath(inventory.decision_path), 'invalid compatibility decision path');
  const decision = await get(raw + inventory.decision_path);
  assert.match(decision, /^Status: Accepted$/m);
  assert.match(decision, /PDR-0075/);
  context.files[inventory.decision_path] = hash(decision);
  assert.deepEqual(Object.keys(inventory.protocols ?? {}).sort(), ['hq', 'wire'], 'hq/wire are the controlled protocols; task is a record schema');
  const evidence = [];
  for (const [name, protocol] of Object.entries(inventory.protocols)) {
    assert.ok(Number.isSafeInteger(protocol.current_major) && protocol.current_major >= 1, `${name}: invalid current major`);
    assert.ok(Number.isSafeInteger(protocol.first_supported_major) && protocol.first_supported_major >= 1 && protocol.first_supported_major <= protocol.current_major, `${name}: invalid first supported major`);
    assert.ok(protocol.previous_supported_major === null || (Number.isSafeInteger(protocol.previous_supported_major) && protocol.previous_supported_major >= 1 && protocol.previous_supported_major < protocol.current_major), `${name}: invalid previous supported major`);
    assert.ok(Array.isArray(protocol.evidence) && protocol.evidence.length > 0, `${name}: missing immutable evidence`);
    for (const source of protocol.evidence) {
      assert.match(source.repository ?? '', /^true-line\/[a-z0-9-]+$/);
      assert.match(source.commit ?? '', /^[a-f0-9]{40}$/);
      assert.ok(safePath(source.path), 'invalid evidence path');
      assert.match(source.sha256 ?? '', /^[a-f0-9]{64}$/);
      const url = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${source.path}`;
      assert.equal(hash(await get(url)), source.sha256, `${name}: source evidence digest mismatch`);
      evidence.push({ protocol: name, ...source, url });
    }
  }
  return { ...context, compatibility: { status: 'accepted', decision: inventory.decision, inventory_path: inventoryPath, inventory_sha256: hash(text), protocols: inventory.protocols, evidence } };
}

export function policyVerdict(context, current = { hq: 1, wire: 1 }) {
  const policy = context.compatibility;
  if (policy?.status !== 'accepted') return { status: 'blocked', n_minus_1: 'not-exercised', reason: policy?.reason ?? 'No verified compatibility policy.' };
  for (const name of ['hq', 'wire']) {
    const protocol = policy.protocols[name];
    assert.equal(protocol.current_major, current[name], `${name}: controlled current major contradicts tested cohort`);
    // Only the explicitly approved first-major rule is implemented here. A
    // future supported-major pair requires an independently reviewed cohort.
    if (protocol.current_major !== 1 || protocol.first_supported_major !== 1 || protocol.previous_supported_major !== null) {
      return { status: 'blocked', n_minus_1: 'not-exercised', reason: `${name}: this suite lacks the controlled previous-major interoperability cohort.` };
    }
  }
  return { status: 'satisfied', n_minus_1: 'not-applicable', reason: 'Accepted PDR-0075 inventory explicitly records current/first major 1 and no previous supported major for hq and wire; no N-1 execution is claimed.' };
}
