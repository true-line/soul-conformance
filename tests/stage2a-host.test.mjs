import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostReport } from '../suites/stage2a/report.mjs';
import { validateStage2aGate, STAGE2A_PROFILES } from '../lib/stage2a-gate.mjs';

function fixture() {
  return { started:new Date().toISOString(), suite:{commit:'1'.repeat(40)}, platform:null,
    os:'darwin', environment:'macos-vm', arch:'arm64', release:'test', os_version:'test', archive_sha256:'a'.repeat(64),
    policy:'sha256:' + 'b'.repeat(64), meta:{hq_commit:'2'.repeat(40),contracts_commit:'3'.repeat(40),
      contracts_digest:'sha256:'+'c'.repeat(64),broker:{name:'agent-comms',version:'1.0.0',source_commit:'4'.repeat(40),sha256:'sha256:'+'d'.repeat(64)}},
    observations:[1,2].map(pass => ({pass, account_count:2, binds:4, directives:2, persisted_receipts:pass*4,
      task_offer_receipts:1, cooperative_task_receipts:2, task_receipts_replayed:2, task_state_retained:pass===1?null:true,
      profile:'managed-cooperative', soul_id:'fixture-soul', definition_digest:'sha256:'+'e'.repeat(64),
      account:'private-fixture-name',channel_binding:'private-fixture-value'})) };
}

test('records only observed positive aggregate counts from both processes; full gates remain open', () => {
  const r = hostReport(fixture());
  assert.equal(r.outcome, 'incomplete');
  assert.deepEqual(r.checks.map(x => x.result), ['pass', ...Array(4).fill('not-qualified')]);
  assert.deepEqual(r.checks[0].observed.map(o => o.own_account_binds), [4,4]);
  assert.deepEqual(r.checks[0].observed.map(o => o.persisted_cooperative_bind_receipts), [4,8]);
  assert.deepEqual(r.checks[0].observed.map(o => o.cooperative_member_task_receipts), [2,2]);
  assert.deepEqual(r.checks[0].observed.map(o => o.task_state_retained_after_restart), [null,true]);
  assert.equal(r.enforcement_profile.in_force, 'managed-cooperative');
  assert.deepEqual(r.execution_scope, {hq_started_soul:false, entrypoint:null,
    note:'This fixture measured HQ protocol and receipts directly; it did not start a Soul through agent-bot-souls run.'});
  assert.equal(r.platform_main, null);
  assert.doesNotMatch(JSON.stringify(r), /private-fixture/);
});

test('self-reported HQ launch fields cannot certify Stage 2a', () => {
  const run = (id) => ({id, result:'pass', profile:STAGE2A_PROFILES[id], execution:{
    started_by:'agent-bot-hq', entrypoint:'agent-bot-souls run', runner_commit:'a'.repeat(40),
    expected_argv_sha256:'b'.repeat(64),
    hq_launch_receipt:{kind:'hq.launch', launch_id:`launch-${id}`, soul_id:'fixture-soul',
      argv0:'agent-bot-souls', argv_sha256:'b'.repeat(64)},
  }, soul_id:'fixture-soul'});
  const report = {stage:'2a', outcome:'pass', checks:Object.keys(STAGE2A_PROFILES).map(run)};
  assert.throws(() => validateStage2aGate(report), /authenticated Stage 2a launch and host evidence verification is not implemented/);

  for (const change of [
    (check) => { delete check.execution; },
    (check) => { check.execution.started_by = 'vendor-cli'; },
    (check) => { check.execution.entrypoint = 'codex'; },
    (check) => { check.execution.hq_launch_receipt.kind = 'fixture'; },
    (check) => { check.execution.hq_launch_receipt.argv0 = '/usr/local/bin/codex'; },
    (check) => { check.execution.expected_argv_sha256 = 'c'.repeat(64); },
    (check) => { check.execution.hq_launch_receipt.soul_id = 'other-soul'; },
    (check) => { check.profile = 'unmanaged'; },
  ]) {
    const invalid = structuredClone(report);
    change(invalid.checks[0]);
    assert.throws(() => validateStage2aGate(invalid));
  }
  assert.throws(() => validateStage2aGate({stage:'2a', outcome:'pass', checks:[run('T01')]}), /T01, T02, T03 and T21/);
});

for (const [reason, change] of [
  ['missing restart', x => x.observations.pop()],
  ['only one UID', x => x.observations[1].account_count--],
  ['missing second UID bind', x => x.observations[1].binds--],
  ['missing first read', x => x.observations[0].directives--],
  ['lost first receipt after restart', x => x.observations[1].persisted_receipts--],
  ['missing cooperative task receipt', x => x.observations[1].cooperative_task_receipts--],
  ['task receipt did not replay after restart', x => x.observations[1].task_receipts_replayed--],
  ['task state missing after restart', x => x.observations[1].task_state_retained = null],
  ['differing definition', x => x.observations[1].definition_digest = 'sha256:'+'9'.repeat(64)],
  ['wrong profile', x => x.observations[0].profile = 'managed-protected'],
]) {
  test('withholds report for ' + reason, () => { const f = fixture(); change(f); assert.throws(() => hostReport(f)); });
}

const {requireDarwinClone} = await import('../suites/stage2a/eligibility.mjs');
function isolatedClone(overrides = {}) {
  const responses = {
    '/usr/sbin/sysctl':{status:0,stdout:'VirtualMac2,1\n'},
    '/bin/launchctl':{status:113,stderr:'Bad request.\nCould not find service "ai.true-line.agent-bot-hq" in domain for system\n'},
    '/usr/bin/pgrep':{status:1,stdout:'',stderr:''},
    ...overrides,
  };
  return file => responses[file];
}
const missingPlist = () => { throw Object.assign(new Error(),{code:'ENOENT'}); };
test('requires an explicitly reserved VM with absent installed supervisor, loaded job and HQ processes', () => {
  assert.doesNotThrow(() => requireDarwinClone(true,310,isolatedClone(),missingPlist));
  for (const [attested, probe, inspect] of [
    [false, isolatedClone(), missingPlist],
    [true, isolatedClone({'/usr/sbin/sysctl':{status:0,stdout:'Mac15,3\n'}}), missingPlist],
    [true, isolatedClone(), () => ({})],
    [true, isolatedClone(), () => {throw Object.assign(new Error(),{code:'EACCES'});}],
    [true, isolatedClone({'/bin/launchctl':{status:0,stderr:''}}), missingPlist],
    [true, isolatedClone({'/bin/launchctl':{status:113,stderr:'unrelated error'}}), missingPlist],
    [true, isolatedClone({'/usr/bin/pgrep':{status:0,stdout:'99\n',stderr:''}}), missingPlist],
  ]) assert.throws(() => requireDarwinClone(attested,310,probe,inspect));
});

test('Linux reserves only a fresh root-provisioned namespace and preserves existing claims', async () => {
  const {claimLinuxEndpoints} = await import('../suites/stage2a/eligibility.mjs');
  const dir = '/run/soul-conformance.A1b2C3d4';
  const directory = (uid, mode) => ({uid, gid:0, mode, isDirectory:() => true});
  const inspect = p => p.endsWith('/claim') ? directory(4001,0o700) : directory(0,0o755);
  const claims = new Set();
  const reserve = p => { assert.equal(p, dir+'/claim/used'); assert.ok(!claims.has(p)); claims.add(p); };
  assert.equal(claimLinuxEndpoints(dir,4001,inspect,reserve),dir);
  assert.throws(() => claimLinuxEndpoints(dir,4001,inspect,reserve));
  assert.throws(() => claimLinuxEndpoints('/run/agent-bot-hq/members',4001,inspect,reserve));
  assert.throws(() => claimLinuxEndpoints(dir,4001,() => directory(4001,0o755),reserve));
});
