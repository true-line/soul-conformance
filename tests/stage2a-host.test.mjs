import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostReport } from '../suites/stage2a/report.mjs';

function fixture() {
  return { started:new Date().toISOString(), suite:{commit:'1'.repeat(40)}, platform:null,
    os:'darwin', environment:'macos-vm', arch:'arm64', release:'test', os_version:'test', archive_sha256:'a'.repeat(64),
    policy:'sha256:' + 'b'.repeat(64), meta:{hq_commit:'2'.repeat(40),contracts_commit:'3'.repeat(40),
      contracts_digest:'sha256:'+'c'.repeat(64),broker:{name:'agent-comms',version:'1.0.0',source_commit:'4'.repeat(40),sha256:'sha256:'+'d'.repeat(64)}},
    observations:[1,2].map(pass => ({pass, account_count:2, binds:2, directives:2, persisted_receipts:pass*2,
      profile:'managed-cooperative', soul_id:'fixture-soul', definition_digest:'sha256:'+'e'.repeat(64),
      account:'private-fixture-name',channel_binding:'private-fixture-value'})) };
}

test('records only observed positive aggregate counts from both processes; full gates remain open', () => {
  const r = hostReport(fixture());
  assert.equal(r.outcome, 'incomplete');
  assert.deepEqual(r.checks.map(x => x.result), ['pass', ...Array(4).fill('not-qualified')]);
  assert.deepEqual(r.checks[0].observed.map(o => o.persisted_cooperative_receipts), [2,4]);
  assert.equal(r.enforcement_profile.in_force, 'managed-cooperative');
  assert.equal(r.platform_main, null);
  assert.doesNotMatch(JSON.stringify(r), /private-fixture/);
});

for (const [reason, change] of [
  ['missing restart', x => x.observations.pop()],
  ['only one UID', x => x.observations[1].account_count--],
  ['missing second UID bind', x => x.observations[1].binds--],
  ['missing first read', x => x.observations[0].directives--],
  ['lost first receipt after restart', x => x.observations[1].persisted_receipts--],
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
