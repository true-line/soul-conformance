import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { readJson } from '../lib/fixtures.mjs';
import { ARCHIVES_PIN, CACHE, SUBJECTS_PIN, prepareContracts, prepareSubject, verifyContracts } from '../lib/pins.mjs';
import { stage1Subject } from '../lib/stage1-subject.mjs';
import { instantiateQuickstart } from '../lib/quickstart.mjs';

const runCLI = promisify(execFile);

test('Cooperative admission, owner offer and brokered member receipts agree with the recorded profile', async (t) => {
  const hq = prepareSubject('hq', ARCHIVES_PIN['hq-t21'], 'hq-t21');
  const contracts = prepareContracts(readJson(hq, 'governance/soul-contracts.json'), 'contracts-t21');
  await checkReceipts(t, hq, contracts);
});

test('the pinned ordinary Souls CLI refuses protected on cooperative HQ before launch and accepts cooperative', { timeout: 120_000 }, async (t) => {
  const hq = prepareSubject('hq', ARCHIVES_PIN['hq-t21'], 'hq-t21');
  const contracts = prepareContracts(readJson(hq, 'governance/soul-contracts.json'), 'contracts-t21');
  const runtimeArchive = ARCHIVES_PIN['runtime-profile-t21'];
  const runtimePin = { ...SUBJECTS_PIN.subjects.runtime, commit: runtimeArchive.commit, entry: 'bin/agent-bot-souls.mjs' };
  const runtime = prepareSubject('runtime', runtimePin, 'runtime-profile-t21');
  t.diagnostic(`Ordinary CLI archive: true-line/agent-bot-souls ${runtimeArchive.commit} (${runtimeArchive.sha256}); HQ fixture: ${ARCHIVES_PIN['hq-t21'].commit}.`);
  await assertCliProfileBoundary(t, hq, contracts, runtime, { bundledBroker: false });
});

const { SOUL_T21_HQ_TAR: archive, SOUL_T21_HQ_SHA256: sha256, SOUL_T21_HQ_COMMIT: commit } = process.env;
test('Darwin archive serves cooperative T21 receipts through its release-pinned broker host',
  { skip: ![archive, sha256, commit].some(Boolean) }, async (t) => {
    assert.equal(process.platform, 'darwin', 'run the Darwin archive on macOS');
    assert.ok(archive && /^[a-f0-9]{64}$/.test(sha256) && /^[a-f0-9]{40}$/.test(commit), 'provide the approved archive, digest and source commit');
    mkdirSync(CACHE, { recursive: true });
    const tmp = mkdtempSync(join(CACHE, 'archive-'));
    t.after(() => rmSync(tmp, { recursive: true, force: true }));
    const hq = join(tmp, 'hq');
    execFileSync('python3', [fileURLToPath(new URL('../scripts/archive.py', import.meta.url)), '--darwin-hq-tar', archive, sha256, hq]);
    const metadata = readJson(hq, 'governance/interim-release.json');
    assert.equal(metadata.hq_commit, commit);
    assert.equal(metadata.target_platform, 'darwin');
    const contracts = join(hq, 'vendor/soul-contracts');
    verifyContracts(contracts, readJson(hq, 'governance/soul-contracts.json'));
    await checkReceipts(t, hq, contracts, true);
    const runtimeArchive = ARCHIVES_PIN['runtime-profile-t21'];
    const runtimePin = { ...SUBJECTS_PIN.subjects.runtime, commit: runtimeArchive.commit, entry: 'bin/agent-bot-souls.mjs' };
    await assertCliProfileBoundary(t, hq, contracts, prepareSubject('runtime', runtimePin, 'runtime-profile-t21'), { bundledBroker: true });
  });

async function assertCliProfileBoundary(t, hq, contracts, runtimeDir, { bundledBroker }) {
  const fixture = readJson(contracts, 'fixtures/negative/hello.unsupported-profile.json').input;
  const runCase = async (profile) => {
    const instance = instantiateQuickstart({ runtimeDir });
    const marker = join(instance.root, 'member-launches.log');
    const exits = join(instance.root, 'member-exits.log');
    const adapter = join(instance.contents, 'opt', 't21-marked-adapter.mjs');
    let session;
    try {
      writeFileSync(adapter, `import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
appendFileSync(process.env.T21_MEMBER_LAUNCH_MARKER, process.env.AGENT_BOT_SOULS_ROLE + '\\n', { mode: 0o600 });
let exitRecorded = false;
const recordExit = () => { if (!exitRecorded) { exitRecorded = true; appendFileSync(process.env.T21_MEMBER_EXIT_MARKER, process.env.AGENT_BOT_SOULS_ROLE + '\\n', { mode: 0o600 }); } };
process.on('exit', recordExit);
process.on('SIGTERM', () => { recordExit(); process.exit(0); });
const runtimeBin = process.env.T21_RUNTIME_BIN;
process.argv = [process.execPath, runtimeBin, 'fake-adapter'];
await import(pathToFileURL(runtimeBin).href);
`, { mode: 0o600 });
      writeFileSync(join(instance.contents, 'host', 'adapters.json'), `${JSON.stringify({ 'fake-adapter': {
        command: [process.execPath, adapter],
        env: { T21_MEMBER_LAUNCH_MARKER: marker, T21_MEMBER_EXIT_MARKER: exits, T21_RUNTIME_BIN: instance.runtimeBin },
      } }, null, 2)}\n`, { mode: 0o600 });

      const subject = await stage1Subject(hq, contracts, fixture, { notices: true, bundledBroker });
      session = await subject.open();
      const privateHome = join(instance.root, '.t21-home');
      const privateTmp = join(instance.root, '.t21-tmp');
      mkdirSync(privateHome, { mode: 0o700 });
      mkdirSync(privateTmp, { mode: 0o700 });
      const child = runCLI(process.execPath, [instance.runtimeBin, 'chat', '--soul', instance.root, '--hq-home', session.hqHome, '--profile', profile], {
        env: { HOME: privateHome, TMPDIR: privateTmp, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', AGENT_BOT_SOUL_CONTRACTS: contracts },
        timeout: 30_000, maxBuffer: 1 << 20,
      });
      child.child.stdin.end('Check the cooperative task list.\n/quit\n');
      let result;
      let failure;
      try { result = await child; } catch (error) { failure = error; }
      const stdout = result?.stdout ?? failure?.stdout ?? '';
      const stderr = result?.stderr ?? failure?.stderr ?? '';
      const events = stderr.split('\n').flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
      const { receipts } = readJson(session.hqHome, 'store.json');
      const admissions = receipts.filter((row) => row.kind === 'hq.admission');
      assert.equal(admissions.length, 1);
      assert.equal(admissions[0].profile, 'managed-cooperative');
      assert.equal(admissions[0].profile_in_force, 'managed-cooperative');
      const store = readJson(session.hqHome, 'store.json');
      const helloRows = store.tables.find(([name]) => name === 'hq-admission\0hellos')?.[1] ?? [];
      assert.ok(helloRows.some(([requestId, row]) => requestId === admissions[0].request_id && row.result.decision_id === admissions[0].decision_id),
        'the receipt must identify the actual Hello decision sent by this CLI');

      if (profile === 'managed-protected') {
        assert.equal(failure?.code, 1, stderr || 'protected CLI unexpectedly succeeded');
        assert.match(stderr, /profile_insufficient/);
        const refused = events.filter((event) => event.event === 'profile-refused');
        assert.equal(refused.length, 1);
        assert.equal(refused[0].code, 'profile_insufficient');
        assert.equal(refused[0].source, 'local');
        assert.equal(refused[0].requested_profile, 'managed-protected');
        assert.equal(refused[0].granted_profile, 'managed-cooperative');
        assert.equal(existsSync(marker), false, 'no adapter process may start after required protected admission is refused');
        assert.equal(events.some((event) => event.event === 'member-started'), false);
        assert.equal(receipts.filter((row) => ['hq.equip', 'hq.ready'].includes(row.kind)).length, 0);
      } else {
        assert.equal(failure, undefined, stderr || 'cooperative CLI failed');
        assert.ok(events.some((event) => event.event === 'admitted' && event.profile === 'managed-cooperative'));
        assert.ok(existsSync(marker), `cooperative control started no marked adapter: ${JSON.stringify({ eventKinds: events.map((event) => event.event), receiptKinds: receipts.map((row) => row.kind) })}`);
        assert.match(stdout, /No waiting directives and no open tasks\./);
        assert.deepEqual(readFileSync(marker, 'utf8').trim().split('\n'), ['lead']);
        assert.deepEqual(readFileSync(exits, 'utf8').trim().split('\n'), ['lead'], 'CLI shutdown must close its launched adapter');
        assert.equal(events.filter((event) => event.event === 'member-started').length, 1);
        const equipped = receipts.filter((row) => row.kind === 'hq.equip');
        const ready = receipts.filter((row) => row.kind === 'hq.ready');
        assert.equal(equipped.length, 2);
        assert.equal(ready.length, 1);
        for (const row of [...equipped, ...ready]) assert.equal(row.profile, 'managed-cooperative');
        const runtime = helloRows.flatMap(([, row]) => row.result.admitted_runtimes).find((item) => item.role === 'lead');
        const cliBinds = receipts.filter((row) => row.kind === 'hq.bind' && row.runtime_id === runtime.runtime_id);
        assert.ok(cliBinds.length >= 1, 'the CLI-launched lead should make a normal production broker bind');
        for (const row of cliBinds) {
          assert.equal(row.soul_id, fixture.soul_id);
          assert.equal(row.member_id, runtime.member_id);
          assert.equal(row.profile, 'managed-cooperative');
          assert.equal(row.proof, 'hmac-sha256');
        }
        t.diagnostic('The cooperative CLI started its lead, completed a prompted turn, and made its own broker bind.');
      }
    } finally {
      try { await session?.close(); }
      finally { rmSync(instance.root, { recursive: true, force: true }); }
    }
  };

  await runCase('managed-protected');
  await runCase('managed-cooperative');
}

async function checkReceipts(t, hq, contracts, bundledBroker = false) {
  const fixture = readJson(contracts, 'fixtures/positive/hello.first-start.json').input;
  const profile = 'managed-cooperative';
  const protectedRequest = readJson(contracts, 'fixtures/negative/hello.unsupported-profile.json');
  // Run the published preference fixture unchanged, with its own accepted definition.
  const preferenceSubject = await stage1Subject(hq, contracts, protectedRequest.input, { notices: true, bundledBroker });
  const preferenceHome = mkdtempSync(join(CACHE, 'preference-'));
  t.after(() => rmSync(preferenceHome, { recursive: true, force: true }));
  const preference = await preferenceSubject.open({ stateHome: preferenceHome });
  let firstDecision;
  try { firstDecision = await assertProtectedPreference(preference, protectedRequest); }
  finally { await preference.close(); }
  const preferenceRestart = await preferenceSubject.open({ stateHome: preferenceHome });
  try {
    // A new connection must use a new request; admission decisions are bound
    // to the original connection. Carry the prior epoch if HQ admitted it.
    const restartedRequest = { ...protectedRequest, input: { ...protectedRequest.input,
      request_id: 'req_t21_preference_restart',
      ...(firstDecision.reply.ok ? { prior_installation_epoch: firstDecision.reply.result.installation_epoch } : {}),
    } };
    const repeatedDecision = await assertProtectedPreference(preferenceRestart, restartedRequest);
    t.diagnostic(`${repeatedDecision.description} A new request after HQ restart retained the cooperative profile.`);
  } finally { await preferenceRestart.close(); }
  const preferenceReceipts = readJson(preferenceHome, 'store.json').receipts.filter(row =>
    [protectedRequest.input.request_id, 'req_t21_preference_restart'].includes(row.request_id) &&
    ['hq.admission', 'hq.hello.refused'].includes(row.kind));
  assert.deepEqual(preferenceReceipts.map(row => row.request_id).sort(),
    [protectedRequest.input.request_id, 'req_t21_preference_restart'].sort(), 'each preference decision must persist once');
  assert.ok(preferenceReceipts.every(row => row.profile === profile), 'both decisions must name the cooperative profile');

  // The two fixture harnesses share this cooperative host account. No adapter is launched.
  const hello = { ...fixture, request_id: 'req_t21_coop', requested_profile: profile,
    definition_digest: `sha256:${'b2'.repeat(32)}`,
    requested_roles: fixture.requested_roles.map(role => ({ ...role, adapter_id: `fixture-${role.role}` })),
  };
  const subject = await stage1Subject(hq, contracts, hello, { notices: true, bundledBroker });
  const stateHome = mkdtempSync(join(CACHE, 'equip-'));
  t.after(() => rmSync(stateHome, { recursive: true, force: true }));
  const handles = new Set();
  const bindings = new Set();
  const first = await subject.open({ stateHome });
  const launchRuntimeIds = [];
  let admission, originalTask;
  try {
    const reply = await first.hello(hello);
    assert.equal(reply.ok, true);
    admission = reply.result;
    assert.equal(admission.profile, profile);
    await assertEquipment(first, admission, handles, bindings);
    await assertReadiness(first, admission, hello);
    await assertDedicatedLaunchUnavailable(hq, first, admission);
    launchRuntimeIds.push(...admission.admitted_runtimes.map(runtime => runtime.runtime_id));
    originalTask = await assertTaskReceipts(first, hello, admission);
    assertBinds(first, admission, hello.soul_id, bundledBroker, 2);
  } finally { await first.close(); }

  const restarted = await subject.open({ stateHome });
  try {
    assert.equal(restarted.profile, profile);
    const reply = await restarted.hello({ ...hello, request_id: 'req_t21_restart',
      prior_installation_epoch: admission.installation_epoch });
    assert.equal(reply.ok, true);
    assert.equal(reply.result.profile, profile);
    assert.equal(reply.result.installation_epoch, admission.installation_epoch);
    assert.equal(reply.result.lease_generation, admission.lease_generation + 1);
    await assertEquipment(restarted, reply.result, handles, bindings);
    await assertReadiness(restarted, reply.result, hello);
    await assertDedicatedLaunchUnavailable(hq, restarted, reply.result);
    launchRuntimeIds.push(...reply.result.admitted_runtimes.map(runtime => runtime.runtime_id));
    t.diagnostic('With two distinct fixture harnesses ready, owner status reported cooperative and the missing per-harness OS accounts before and after restart.');
    await finishRenewedTask(restarted, reply.result, hello.soul_id, originalTask);
    assertBinds(restarted, reply.result, hello.soul_id, bundledBroker, 1);
    t.diagnostic('The owner saw both members ready in both generations. Each runtime renewed its lease and had one cooperative readiness receipt.');
    t.diagnostic('The renewed lead completed the original task using the specialist’s persisted proposal. Redelivery returned one cooperative completion receipt, and the renewed specialist observed the final revision.');
    t.diagnostic('Both members received distinct, runtime-bound handles before and after HQ restarted. Every Equip receipt recorded the cooperative profile.');
  } finally { await restarted.close(); }

  const { receipts } = readJson(stateHome, 'store.json');
  assert.equal(receipts.filter(row => row.kind === 'hq.stopped').length, 2);
  assert.equal(new Set(launchRuntimeIds).size, 4, 'each admission must name two distinct new runtimes');
  const refusals = receipts.filter(row => row.kind === 'hq.launch.refused');
  assert.deepEqual(refusals.map(row => row.runtime_id).sort(), launchRuntimeIds.sort(),
    'each launch request must retain exactly one refusal across restart and shutdown');
  for (const row of refusals) {
    assert.deepEqual([row.op, row.code, row.profile], ['launch', 'host.launch_unavailable', profile]);
  }
  assert.equal(receipts.filter(row => row.kind === 'hq.launch').length, 0);
  t.diagnostic('In each generation the admitting entry point requested a dedicated launch for each of its two runtimes. No launch was reserved. All four cooperative refusal receipts persisted through shutdown.');
  for (const row of receipts) {
    assert.equal(row.profile, profile, `HQ audit receipt ${row.seq} (${row.kind})`);
  }
  const audit = JSON.stringify(receipts);
  for (const opaque of [...handles, ...bindings]) {
    assert.ok(!audit.includes(opaque), 'public audit receipts must omit grant handles and channel bindings');
  }
}

// A successor lease can finish an already accepted task without recreating it.
async function finishRenewedTask(session, admission, soulId, { taskId, proposalId }) {
  const clients = new Map();
  for (const runtime of admission.admitted_runtimes) {
    const client = await session.member(runtime);
    const view = await client.request('task.get', { task_id: taskId });
    assert.equal(view.ok, true);
    const { task, proposals } = view.result;
    assert.equal(task.task_id, taskId);
    assert.equal(task.accountable_soul, soulId);
    assert.equal(task.status, 'accepted');
    assert.deepEqual(proposals.map(p => [p.proposal_id, p.role, p.transition, p.evidence]),
      [[proposalId, 'specialist', 'completed', ['artifact_t21']]], 'both renewed members must receive the original specialist proposal');
    clients.set(runtime.role, { client, runtime, revision: task.revision, evidence: proposals[0].evidence[0] });
  }

  const lead = clients.get('lead');
  const receiptIds = new Set();
  let revision = lead.revision;
  for (const [from, transition] of [['accepted', 'running'], ['running', 'completed']]) {
    const request = {
      contract: 'task/v1', request_id: `req_t21_resume_${transition}`, operation_id: `op_t21_resume_${transition}`,
      installation_epoch: admission.installation_epoch, lease_generation: admission.lease_generation,
      runtime_id: lead.runtime.runtime_id, task_id: taskId, expected_revision: revision, transition,
      ...(transition === 'completed' ? { result_ref: lead.evidence } : {}),
    };
    const reply = await lead.client.request('task.commit', request);
    assert.equal(reply.ok, true);
    const receipt = reply.result;
    assert.ok(receipt.receipt_id);
    assert.equal(receipt.task_id, request.task_id);
    assert.equal(receipt.operation_id, request.operation_id);
    assert.equal(receipt.from, from);
    assert.ok(!receiptIds.has(receipt.receipt_id), 'distinct transitions require distinct receipts');
    receiptIds.add(receipt.receipt_id);
    assert.deepEqual([receipt.profile, receipt.by, receipt.outcome, receipt.status, receipt.revision],
      [session.profile, lead.runtime.member_id, 'committed', transition, revision + 1]);
    const repeated = await lead.client.request('task.commit', request);
    assert.equal(repeated.ok, true);
    assert.deepEqual(repeated.result, receipt);
    const { receipts } = readJson(session.hqHome, 'store.json');
    const rows = receipts.filter(row => row.kind === 'task.commit' && row.operation_id === request.operation_id);
    assert.deepEqual(rows.map(row => [row.receipt_id, row.profile, row.runtime_id]),
      [[receipt.receipt_id, session.profile, lead.runtime.runtime_id]]);
    revision = receipt.revision;
  }
  const result = await clients.get('specialist').client.request('task.get', { task_id: taskId });
  assert.equal(result.ok, true);
  const { task } = result.result;
  assert.deepEqual([task.task_id, task.status, task.revision, task.evidence], [taskId, 'completed', revision, [lead.evidence]]);
}

function assertBinds(session, admission, soulId, bundledBroker, count) {
  const { receipts } = readJson(session.hqHome, 'store.json');
  const proof = bundledBroker ? 'hmac-sha256' : 'channel-binding';
  for (const runtime of admission.admitted_runtimes) {
    const rows = receipts.filter(row => row.kind === 'hq.bind' && row.runtime_id === runtime.runtime_id);
    assert.equal(rows.length, count, 'each successful connection must have one audited bind');
    for (const row of rows) {
      assert.equal(row.soul_id, soulId);
      assert.equal(row.member_id, runtime.member_id);
      assert.equal(row.profile, session.profile);
      assert.equal(row.proof, proof);
    }
  }
}

async function assertEquipment(session, admission, handles, bindings) {
  const runtimes = admission.admitted_runtimes;
  assert.deepEqual(runtimes.map(runtime => runtime.role).sort(), ['lead', 'specialist']);
  for (const runtime of runtimes) {
    const reply = await session.equip(runtime.runtime_id);
    assert.equal(reply.ok, true);
    const equipment = reply.result;
    assert.equal(equipment.runtime_id, runtime.runtime_id);
    assert.deepEqual(equipment.credential_references, []);
    assert.deepEqual(equipment.approved_destinations, []);
    assert.equal(equipment.grant_handles.length, 1);
    const [grant] = equipment.grant_handles;
    assert.equal(grant.member_id, runtime.member_id);
    assert.ok(typeof runtime.channel_binding === 'string' && runtime.channel_binding.length > 0);
    assert.ok(grant.channel_binding === runtime.channel_binding, 'wrong member channel');
    assert.ok(!bindings.has(runtime.channel_binding), 'each admitted runtime needs its own channel binding');
    bindings.add(runtime.channel_binding);
    assert.ok(typeof grant.handle === 'string' && grant.handle.length >= 16);
    assert.ok(!handles.has(grant.handle), 'each admitted runtime needs its own opaque handle');
    handles.add(grant.handle);
    const repeat = await session.equip(runtime.runtime_id);
    assert.equal(repeat.ok, true);
    assert.ok(repeat.result.grant_handles[0]?.handle === grant.handle, 'repeated Equip must retain the runtime handle');
  }
  const { receipts } = readJson(session.hqHome, 'store.json');
  for (const runtime of runtimes) {
    const rows = receipts.filter(row => row.kind === 'hq.equip' && row.runtime_id === runtime.runtime_id);
    assert.deepEqual(rows.map(row => [row.credential_references, row.profile]),
      [[0, session.profile], [0, session.profile]]);
  }
}

async function assertDedicatedLaunchUnavailable(hq, session, admission) {
  // A normal request on the same entry connection that admitted these runtimes.
  for (const runtime of admission.admitted_runtimes) {
    const result = await session.launch({ runtime_id: runtime.runtime_id, command: [process.execPath, '--version'], env: {} });
    assert.equal(result.ok, false);
    assert.equal(result.host_refusal?.code ?? result.refusal?.error, 'host.launch_unavailable');
  }
  const { stdout } = await runCLI(process.execPath, [join(hq, 'hq/main.mjs'), 'status', '--home', session.hqHome, '--json'], { timeout: 10000 });
  const status = JSON.parse(stdout);
  assert.deepEqual(status.hq.launch.launches, [], 'neither request must leave a launch reservation');
  assert.equal(status.profile, 'managed-cooperative');
  assert.ok(status.hq.profileReasons.some(reason => reason.includes('(D7)') && /share one account|no OS account per harness/i.test(reason)),
    'owner status must disclose the missing per-harness account boundary');
}

async function assertReadiness(session, admission, hello) {
  for (const runtime of admission.admitted_runtimes) {
    const request = {
      contract: 'hq/v1', runtime_id: runtime.runtime_id, installation_epoch: admission.installation_epoch,
      lease_generation: admission.lease_generation, renewal_sequence: 1, readiness_state: 'cold',
      auth_state: 'unauthenticated', adapter_versions: {}, observed_health: 'healthy',
    };
    const ready = await session.ready(request);
    assert.equal(ready.ok, true);
    const lease = await session.lease({ ...request, renewal_sequence: 2 });
    assert.equal(lease.ok, true);
    for (const reply of [ready, lease]) {
      assert.equal(reply.result.runtime_id, runtime.runtime_id);
      assert.equal(reply.result.installation_epoch, admission.installation_epoch);
      assert.equal(reply.result.lease_generation, admission.lease_generation);
    }
  }

  const owner = await session.owner('souls.list', {});
  assert.equal(owner.ok, true);
  const soul = owner.result.find(row => row.soul_id === hello.soul_id);
  assert.equal(soul?.lease_generation, admission.lease_generation);
  // The owner view reports readiness; the adapter assignment is in HQ's persisted admission row.
  const { receipts, tables } = readJson(session.hqHome, 'store.json');
  const storedRuntimes = new Map(new Map(tables).get('hq-admission\0runtimes'));
  const readyAdapters = new Set();
  for (const runtime of admission.admitted_runtimes) {
    const expected = hello.requested_roles.find(role => role.member_id === runtime.member_id);
    assert.ok(expected, 'HQ admitted an unexpected member');
    const visible = soul.runtimes.find(row => row.member_id === runtime.member_id);
    assert.equal(visible?.role, expected.role);
    assert.equal(visible.ready, true);
    const stored = storedRuntimes.get(runtime.runtime_id);
    assert.ok(stored, 'the admitted runtime must have a persisted assignment');
    assert.equal(stored.soul_id, hello.soul_id);
    assert.equal(stored.member_id, runtime.member_id);
    assert.equal(stored.role, expected.role);
    assert.equal(runtime.role, expected.role);
    assert.equal(stored.lease_generation, admission.lease_generation);
    assert.equal(stored.superseded, false);
    assert.equal(stored.ready, true);
    assert.equal(stored.adapter_id, expected.adapter_id, 'the ready member must retain its own fixture adapter');
    readyAdapters.add(stored.adapter_id);
    const rows = receipts.filter(row => row.kind === 'hq.ready' && row.runtime_id === runtime.runtime_id);
    assert.deepEqual(rows.map(row => [row.readiness_state, row.profile]), [['cold', 'managed-cooperative']],
      'each ready runtime needs its own cooperative readiness receipt');
  }
  assert.equal(readyAdapters.size, 2, 'the two ready members must use distinct fixture adapters');
}

// A Hello expresses a preference. The contract permits a typed refusal or a
// visibly weaker admission. A required protected credential has a stricter rule.
async function assertProtectedPreference(session, fixture) {
  const request = fixture.input;
  assert.equal(session.profile, 'managed-cooperative');
  assert.equal(request.requested_profile, 'managed-protected');
  const reply = await session.hello(request);
  if (reply.ok) {
    assert.equal(reply.result.profile, session.profile);
    assert.equal(reply.result.request_id, request.request_id);
    const disclosed = reply.result.warnings?.some(warning =>
      warning.includes(request.requested_profile) && warning.includes(session.profile));
    assert.ok(disclosed, 'HQ must disclose the requested profile and the weaker profile in force');
    const repeated = await session.hello(request);
    assert.equal(repeated.ok, true);
    assert.deepEqual(repeated.result, reply.result);
  } else {
    assert.equal(reply.refusal?.error, fixture.expect.error);
    assert.equal(reply.refusal.request_id, request.request_id);
  }

  const { receipts } = readJson(session.hqHome, 'store.json');
  const decisions = receipts.filter(row => row.request_id === request.request_id &&
    ['hq.admission', 'hq.hello.refused'].includes(row.kind));
  assert.equal(decisions.length, 1);
  const [record] = decisions;
  assert.equal(record.profile, session.profile);
  if (reply.ok) {
    assert.equal(record.kind, 'hq.admission');
    assert.equal(record.decision_id, reply.result.decision_id);
    assert.equal(record.profile_in_force, session.profile);
    return { reply, description: 'Protected preference produced an explicit cooperative admission and one cooperative receipt.' };
  }
  assert.equal(record.kind, 'hq.hello.refused');
  assert.equal(record.code, fixture.expect.error);
  return { reply, description: 'Protected preference was refused with profile_insufficient and recorded under the cooperative profile.' };
}

async function assertTaskReceipts(session, hello, admission) {
  const profile = hello.requested_profile;
  const offerInput = {
    operation_id: 'op_t21_offer',
    objective: 'Check the profile recorded for an owner task offer.',
    done_criteria: 'HQ records the offer.',
    accountable_soul: hello.soul_id,
  };
  const offer = await session.owner('tasks.offer', offerInput);
  assert.equal(offer.ok, true);
  assert.ok(offer.result.receipt_id);
  assert.equal(offer.result.operation_id, offerInput.operation_id);
  assert.equal(offer.result.profile, profile);
  const replay = await session.owner('tasks.offer', offerInput);
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.result, offer.result);

  // Both member roles get a task receipt over their own bound broker connection.
  // Redelivery after a fresh bind must return the original cooperative receipt.
  let revision = offer.result.revision;
  const memberReceipts = [];
  for (const [role, transition, outcome] of [
    ['lead', 'accepted', 'committed'], ['specialist', 'completed', 'proposal'],
  ]) {
    const runtime = admission.admitted_runtimes.find((r) => r.role === role);
    assert.ok(runtime, `missing admitted ${role}`);
    const request = {
      contract: 'task/v1', request_id: `req_t21_${role}`, operation_id: `op_t21_${role}`,
      installation_epoch: admission.installation_epoch, lease_generation: admission.lease_generation,
      task_id: offer.result.task_id, runtime_id: runtime.runtime_id, expected_revision: revision, transition,
      ...(role === 'specialist' ? { result_ref: 'artifact_t21' } : {}),
    };
    const member = await session.member(runtime);
    const reply = await member.request('task.commit', request);
    assert.equal(reply.ok, true);
    const receipt = reply.result;
    assert.ok(receipt.receipt_id);
    assert.equal(receipt.profile, profile);
    assert.equal(receipt.task_id, request.task_id);
    assert.equal(receipt.operation_id, request.operation_id);
    assert.equal(receipt.by, runtime.member_id);
    assert.equal(receipt.outcome, outcome);
    if (outcome === 'proposal') assert.ok(receipt.proposal_id);
    const secondConnection = await session.member(runtime);
    const repeated = await secondConnection.request('task.commit', request);
    assert.equal(repeated.ok, true);
    assert.deepEqual(repeated.result, receipt);
    memberReceipts.push(receipt);
    revision = receipt.revision;
  }

  const { receipts } = readJson(session.hqHome, 'store.json');
  const admitted = receipts.find((r) => r.kind === 'hq.admission' && r.request_id === hello.request_id);
  assert.equal(admitted?.profile_in_force, profile);
  const offers = receipts.filter((r) => r.kind === 'task.offer' && r.operation_id === offerInput.operation_id);
  assert.deepEqual(offers.map((r) => [r.receipt_id, r.profile]), [[offer.result.receipt_id, profile]]);
  for (const member of memberReceipts) {
    const rows = receipts.filter((r) => r.kind === 'task.commit' && r.operation_id === member.operation_id);
    assert.deepEqual(rows.map((r) => [r.receipt_id, r.profile, r.by, r.outcome]),
      [[member.receipt_id, profile, member.by, member.outcome]]);
  }
  return { taskId: offer.result.task_id, proposalId: memberReceipts.find(r => r.outcome === 'proposal').proposal_id };
}
