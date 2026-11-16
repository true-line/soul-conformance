import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { platform, arch, release } from 'node:os';
import { platformContext } from '../../scripts/platform.mjs';
import { requireRefusal, requireHostRefusal, requireThrown, verdict, tableDigest } from './oracles.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEPS = join(ROOT, '.cache/dependencies');
const load = (dep, p) => import(pathToFileURL(join(DEPS, dep, p)).href);
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pins = json(join(ROOT, 'dependencies.json'));
const results = [];
const check = async (id, layer, action) => {
  let timer;
  try { await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('case exceeded 10-second bound')), 10000); })]); results.push({ id, layer, outcome: 'passed' }); }
  catch (e) { results.push({ id, layer, outcome: 'failed', error: String(e.message).slice(0, 500) }); }
  finally { clearTimeout(timer); }
};
const report = {
  schema: 'soul-conformance-T14/1', startedAt: new Date().toISOString(),
  suite: 'T14', suiteWorktreeDirty: execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0, suiteRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
  dependencies: pins.dependencies, enforcementProfile: 'managed-cooperative',
  host: { platform: platform(), arch: arch(), release: release(), node: process.version },
  adapters: [{ name: 'independent raw protocol driver', version: '1', nativeHarness: false }],
  observedProtocolMajors: { hq: [1], wire: [1] }, recordSchemaVersions: { task: 1 },
  previousSupportedMajor: { status: 'blocked', value: null, reason: 'Missing accepted compatibility inventory/bootstrap decision; package releases v0.4.1 and v0.5.0 are not protocol majors.', proposal: 'https://github.com/true-line/agent-bot-platform/discussions/75' },
  boundaries: ['Local test enrollment fixture; no live device, remote service or production configuration.', 'Production HQ, sockets, store, comms broker and default notice consumer are exercised.', 'Production Soul runtime decoder/client and comms wire codec are exercised separately; no live wire/v1 framing claim.', 'Hello version negotiation does not prove capability intersection negotiation.', 'Cooperative does not waive any failed protocol refusal. Protected enforcement is not certified.'],
  tests: results,
};
let hq, workspace, oldCwd; const clients = [];
try {
  execFileSync('python3', ['scripts/dependencies.py', '--verify'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  report.platform = await platformContext();
  const { validate } = await load('hq', 'sdk/wire/schema.mjs');
  const { parseStrict } = await load('hq', 'sdk/wire/strict-json.mjs');
  const { canonicalDigest } = await load('hq', 'sdk/wire/canonical-json.mjs');
  const { manifestDigest, readPin } = await load('hq', 'scripts/soul-contracts.mjs');
  const { loadContracts } = await load('souls', 'lib/contracts.mjs');
  const runtime = loadContracts({ directory: join(DEPS, 'runtimeContracts') });
  const contractRoot = join(DEPS, 'contracts');
  const contractPin = readPin();
  const entries = [];
  const walk = (base, rel) => {
    const p = join(base, rel), st = lstatSync(p);
    if (st.isDirectory()) for (const n of readdirSync(p).sort()) walk(base, `${rel}/${n}`);
    else { assert.ok(st.isFile()); entries.push({ path: rel, mode: st.mode & 0o111 ? '100755' : '100644', bytes: readFileSync(p) }); }
  };
  for (const p of contractPin.paths) walk(contractRoot, p);
  const verified = manifestDigest(entries);
  assert.equal(verified.digest, contractPin.digest); assert.equal(verified.files, contractPin.files);
  report.contractRelease = { ...contractPin, verified: true };
  for (const [name, root, decoder] of [['hq-v0.5.0', contractRoot, (f) => { const v = parseStrict(f.input_raw ?? JSON.stringify(f.input)); const errors = validate(json(join(contractRoot, 'schemas', f.schema)), v); if (errors.length) throw Object.assign(new Error('schema rejected'), { code: 'schema' }); return v; }], ['souls-v0.4.1', join(DEPS, 'runtimeContracts'), (f) => runtime.decode(f.schema, f.input_raw ?? JSON.stringify(f.input))]]) {
    for (const kind of ['positive', 'negative']) for (const file of readdirSync(join(root, 'fixtures', kind)).filter((n) => n.endsWith('.json')).sort()) {
      const f = json(join(root, 'fixtures', kind, file));
      await check(`${name}.${kind}.${file}`, 'shared-fixture-schema-or-parse-only', () => {
        if (f.base) assert.equal(`sha256:${hash(readFileSync(join(root, 'fixtures', f.base.fixture)))}`, f.base.sha256);
        if (f.expect.parse === 'invalid' || f.expect.schema === 'invalid') {
          const code = f.expect.parse === 'invalid' ? 'host.invalid_json' : name.startsWith('hq-') ? 'schema' : 'souls.invalid_contract';
          assert.throws(() => decoder(f), (error) => error.code === code);
        }
        else { assert.equal(f.expect.schema, 'valid'); assert.deepEqual(decoder(f), f.input); }
        if (f.canonical_sha256) assert.equal(canonicalDigest(f.input), f.canonical_sha256);
      });
    }
  }
  const fixture = (p) => json(join(contractRoot, 'fixtures', p));
  const goodFrame = fixture('positive/wire-frame.sealed-task-wake.json').input;
  const unknown = fixture('negative/wire-frame.unknown-required-capability.json');
  const { admitFrame } = await load('comms', 'lib/contracts/wire-v1.mjs');
  const commsSource = json(join(DEPS, 'comms/lib/vendor/soul-contracts/source.json'));
  await check('comms-vendored-contract-provenance', 'dependency', () => {
    assert.equal(commsSource.commit, pins.dependencies.runtimeContracts.commit);
    for (const [p, sha] of Object.entries(commsSource.files)) {
      assert.equal(hash(readFileSync(join(DEPS, 'comms/lib/vendor/soul-contracts', p))), sha);
      assert.equal(hash(readFileSync(join(DEPS, 'runtimeContracts', p))), sha);
    }
  });
  report.commsContractSource = commsSource;
  const { admitDirectiveOrQuery } = await load('comms', 'lib/contracts/wire-v1.mjs');
  const { mirrorTaskRecord, mirrorTaskCommitment, mirrorActionRecord } = await load('comms', 'lib/contracts/task-v1.mjs');
  const mirror = { 'task/v1/task-record.schema.json': mirrorTaskRecord, 'task/v1/task-commitment.schema.json': mirrorTaskCommitment, 'task/v1/action-record.schema.json': mirrorActionRecord, 'wire/v1/directive-or-query.schema.json': admitDirectiveOrQuery };
  for (const kind of ['positive', 'negative']) for (const file of readdirSync(join(DEPS, 'runtimeContracts/fixtures', kind)).filter((n) => n.endsWith('.json')).sort()) {
    const f = json(join(DEPS, 'runtimeContracts/fixtures', kind, file));
    if (!Object.hasOwn(commsSource.files, `schemas/${f.schema}`)) continue;
    await check(`comms-v0.4.1.${kind}.${file}`, 'shared-fixture-production-comms-codec', async () => {
      const decode = () => f.schema === 'wire/v1/wire-frame.schema.json'
        ? admitFrame(f.input_raw ?? f.input, { now: Date.parse(f.context?.now ?? '2026-11-07T00:00:00Z'), negotiatedCapabilities: f.context?.negotiated_capabilities ?? ['sealed-inner-v1'] })
        : mirror[f.schema](f.input_raw ?? f.input);
      if (f.expect.parse === 'invalid' || f.expect.schema === 'invalid' || f.expect.error) await requireThrown(decode, f.expect.error ?? 'bad-request');
      else { const value = decode(); assert.deepEqual(value, f.input); assert.ok(Object.isFrozen(value)); }
    });
  }

  await check('souls-wire-v1-supported', 'production-codec', () => assert.deepEqual(runtime.frame(goodFrame, ['sealed-inner-v1']), goodFrame));
  await check('comms-wire-v1-supported', 'production-codec', () => assert.deepEqual(admitFrame(goodFrame, { now: Date.parse('2026-11-08T17:00:00Z'), negotiatedCapabilities: ['sealed-inner-v1'] }), goodFrame));
  await check('souls-unknown-required-capability', 'production-codec', () => requireThrown(() => runtime.frame(unknown.input, unknown.context.negotiated_capabilities), 'required_capability_missing'));
  await check('comms-unknown-required-capability', 'production-codec', () => requireThrown(() => admitFrame(unknown.input, { now: Date.parse('2026-11-08T17:00:00Z'), negotiatedCapabilities: unknown.context.negotiated_capabilities }), 'required_capability_missing'));
  await check('comms-wire-unsupported-major-shape-refused', 'production-codec', () => requireThrown(() => admitFrame({ ...goodFrame, wire_version: 99 }, { now: Date.parse('2026-11-08T17:00:00Z'), negotiatedCapabilities: ['sealed-inner-v1'] }), 'bad-request'));
  // wire_version is schema const 1: codec refusal is bad-request, not fabricated unsupported_version.
  const { createHQ } = await load('hq', 'hq/hq.mjs');
  const { SCHEMA_NAMES, bindProof } = await load('hq', 'hq/admission.mjs');
  const { TASK_SCHEMA_NAMES, TASK_WIRE_SCHEMA_NAMES } = await load('hq', 'hq/tasks.mjs');
  const { NOTICE_SCHEMA_NAMES } = await load('hq', 'hq/notices.mjs');
  const { brokerPlugin } = await load('comms', 'lib/hq-plugin/broker.mjs');
  const { connectSocket } = await load('hq', 'hq/socket.mjs');
  const { connectHq } = await load('souls', 'lib/hq-client.mjs');
  const schemas = Object.fromEntries([['hq/v1', [...SCHEMA_NAMES, ...NOTICE_SCHEMA_NAMES]], ['task/v1', TASK_SCHEMA_NAMES], ['wire/v1', TASK_WIRE_SCHEMA_NAMES]].flatMap(([kind, names]) => names.map((n) => [n, json(join(contractRoot, 'schemas', kind, `${n}.schema.json`))])));
  const hello = fixture('positive/hello.first-start.json').input;
  report.definitionRevision = hello.definition_digest;
  const harness = 'conformance-fixture';
  const config = { acceptedDefinitions: { [hello.soul_id]: [hello.definition_digest] }, notices: { harnesses: [harness], scopes: [{ soul_id: hello.soul_id, definition_digest: hello.definition_digest, ...Object.fromEntries(['member_id', 'adapter_id', 'role'].map((k) => [k, hello.requested_roles[0][k]])), harness, repo: 'example/project' }] } };
  report.policyDigest = canonicalDigest(config);
  mkdirSync(join(ROOT, '.cache/runs'), { recursive: true });
  workspace = mkdtempSync(join(ROOT, '.cache/runs/t14-'));
  oldCwd = process.cwd(); process.chdir(workspace); // Short relative Unix-socket paths; all state remains in this worktree.
  let upstreamCalls = 0;
  hq = createHQ({ home: 'hq', schemas, config, enrollment: { source: 'independent local enrollment fixture', deviceStatus: async () => 'enrolled', allowsHarness: (h) => h === harness }, legacy: { tick: async () => {}, report: () => ({ state: 'not-probed', supervise: false }) }, identity: { call: async () => { upstreamCalls++; return { status: 200, body: { harness, notices: [] } }; } }, plugins: [brokerPlugin({ noticeTimers: { setTimer: () => ({ unref() {} }), clearTimer() {} } })], launch: { spawn: () => { throw new Error('conformance must not launch an OS account'); } } });
  const status = await hq.start(); await hq.settled();
  assert.equal(status.profile, 'managed-cooperative'); report.observedProfile = status.profile;
  const entry = await connectSocket(hq.paths.admission); clients.push(entry);
  const snapshot = () => tableDigest(hq.core.tables, (name) => name.endsWith('\0runtimes') || name.endsWith('\0souls'));
  await check('hq-hello-unsupported-offered-versions', 'real-HQ-socket', async () => {
    const input = fixture('negative/hello.unsupported-version.json').input, before = snapshot();
    requireRefusal(await entry.request('Hello', input), 'unsupported_version', input.request_id);
    assert.equal(snapshot(), before, 'refused Hello must not admit a runtime');
  });
  await check('hq-hello-malformed-contract', 'real-HQ-socket', async () => {
    const input = { ...hello, contract: 'hq/v99' }, before = snapshot();
    requireHostRefusal(await entry.request('Hello', input), 'host.invalid_request');
    assert.equal(snapshot(), before);
  });
  const soulClient = await connectHq(hq.paths.admission, { contracts: runtime }); clients.push(soulClient);
  let admission;
  await check('souls-to-HQ-supported-v1-handshake', 'real-cross-component-socket', async () => {
    admission = await soulClient.request('Hello', hello);
    assert.deepEqual(admission.negotiated_versions, { hq: 1, wire: 1 });
    assert.equal(admission.request_id, hello.request_id);
    assert.ok(admission.admitted_runtimes.length > 0);
  });
  await check('souls-to-HQ-unsupported-versions-refusal', 'real-cross-component-socket', () => requireThrown(() => soulClient.request('Hello', { ...fixture('negative/hello.unsupported-version.json').input, request_id: 'req_t14_unsupported_runtime' }), 'unsupported_version'));
  assert.ok(admission, 'broker checks require successful real admission');
  const member = await connectSocket(hq.paths.broker); clients.push(member);
  const rt = admission.admitted_runtimes[0];
  const challenge = await member.request('bind.challenge', { runtime_id: rt.runtime_id }); assert.equal(challenge.ok, true);
  assert.equal((await member.request('bind', { runtime_id: rt.runtime_id, proof: bindProof(rt.channel_binding, challenge.result.nonce, rt.runtime_id) })).ok, true);
  const query = { contract: 'hq/v1', request_id: 't14_notice', operation: 'peek', required_capabilities: ['notices-v1'], installation_epoch: admission.installation_epoch, lease_generation: admission.lease_generation };
  await check('real-broker-supported-notice-capability', 'real-HQ-comms-broker', async () => {
    const r = await member.request('notices.peek', query); assert.equal(r.ok, true); assert.equal(r.result.request_id, query.request_id); assert.deepEqual(r.result.notices, []);
  });
  for (const [name, patch, code] of [['unknown-capability', { required_capabilities: ['notices-v1', 'time-travel-v9'] }, 'required_capability_missing'], ['unsupported-contract', { contract: 'hq/v99' }, 'unsupported_version']]) {
    await check(`real-broker-${name}`, 'real-HQ-comms-broker', async () => {
      const before = tableDigest(hq.core.tables, (n) => n.startsWith('agent-comms\0')), calls = upstreamCalls;
      requireRefusal(await member.request('notices.peek', { ...query, ...patch }), code, query.request_id);
      assert.equal(upstreamCalls, calls); assert.equal(tableDigest(hq.core.tables, (n) => n.startsWith('agent-comms\0')), before);
    });
  }
} catch (e) {
  results.push({ id: 'infrastructure', layer: 'runner', outcome: 'failed', error: String(e.message).slice(0, 500) });
} finally {
  for (const client of clients) await client.close().catch(() => {});
  await hq?.stop().catch((e) => results.push({ id: 'cleanup', layer: 'runner', outcome: 'failed', error: e.message }));
  if (oldCwd) process.chdir(oldCwd);
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  report.outcome = verdict(results); report.finishedAt = new Date().toISOString();
  const summarize = (select) => Object.fromEntries([...new Set(results.map(select))].map((group) => [group, { passed: results.filter((r) => select(r) === group && r.outcome === 'passed').length, failed: results.filter((r) => select(r) === group && r.outcome === 'failed').length }]));
  report.summaryByLayer = summarize((r) => r.layer);
  report.summaryByCorpus = summarize((r) => ['hq-v0.5.0', 'souls-v0.4.1', 'comms-v0.4.1'].find((name) => r.id.startsWith(name + '.')) ?? 'independent-boundaries-and-provenance');

  report.evidenceReferences = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter((p) => !p.startsWith('reports/'));
  report.evidenceReferences = [...new Set(report.evidenceReferences)].sort();
  report.suiteContentSha256 = hash(Buffer.concat(report.evidenceReferences.map((p) => Buffer.concat([Buffer.from(p + '\0'), readFileSync(join(ROOT, p))]))));
  mkdirSync(join(ROOT, 'reports'), { recursive: true });
  writeFileSync(join(ROOT, 'reports/T14-latest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ implemented: report.outcome.implemented, overallT14: report.outcome.overallT14, passed: results.filter((r) => r.outcome === 'passed').length, failed: results.filter((r) => r.outcome === 'failed').length, report: 'reports/T14-latest.json' }));
  process.exitCode = report.outcome.implemented === 'failed' ? 1 : process.argv.includes('--gate') ? 2 : 0;
}
