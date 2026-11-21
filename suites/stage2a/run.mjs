import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, copyFileSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { arch, release } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT, verifyContracts } from '../../lib/pins.mjs';
import { platformContext } from '../../lib/platform.mjs';
import { suiteRevision } from '../../lib/report.mjs';
import { claimLinuxEndpoints, requireDarwinClone } from './eligibility.mjs';
import { hostReport } from './report.mjs';

const {values} = parseArgs({ options: {
  archive:{type:'string'}, sha256:{type:'string'}, commit:{type:'string'}, accounts:{type:'string'},
  'linux-fixture-dir':{type:'string'}, 'exclusive-disposable-clone':{type:'boolean'}, 'offline-platform':{type:'boolean'}, out:{type:'string'},
} });
const darwin = process.platform === 'darwin';
const role = darwin ? '_agent-bot-hq' : 'agent-bot-hq';
const accounts = (values.accounts ?? '').split(',');
const darwinDir = '/Library/Application Support/ai.true-line.agent-bot-hq/ipc';
const io = {encoding:'utf8', stdio:['ignore','pipe','ignore'], timeout:15_000};
const sudo = (account, ...args) => ['-n','-H','-u',account,'--','/usr/bin/env','-i','PATH=/usr/bin:/bin','HQ_INTERIM_OFFLINE=1',...args];
const hash = data => 'sha256:' + createHash('sha256').update(data).digest('hex');
let phase = 'preflight', stage, home;
const roleDirectories = [];
const active = new Set();
let interrupted = false;
function cancel() {
  interrupted = true;
  for (const child of active) child.stdin.end();
}
process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);

function roleDirectory(tmp, prefix, uid) {
  const path = execFileSync('/usr/bin/sudo', sudo(role,'/usr/bin/mktemp','-d',join(tmp,prefix + 'XXXXXXXX')), io).trim();
  assert.equal(dirname(path), tmp);
  assert.ok(basename(path).startsWith(prefix) && /^[A-Za-z0-9]{8}$/.test(basename(path).slice(prefix.length)));
  phase = 'HQ private state ownership and mode';
  const st = lstatSync(path);
  assert.ok(st.isDirectory() && st.uid === uid && (st.mode & 0o7777) === 0o700);
  roleDirectories.push({path,st});
  return path;
}

function removeRoleDirectory({path,st}) {
  const current = lstatSync(path);
  assert.ok(current.isDirectory() && current.dev === st.dev && current.ino === st.ino && current.uid === st.uid);
  execFileSync('/usr/bin/sudo', sudo(role,'/bin/rm','-rf','--',path), io);
}

function worker(account, action, input) {
  assert.equal(interrupted, false);
  const child = spawn('/usr/bin/sudo', sudo(account, process.execPath, join(stage, 'worker.mjs'), action), {
    stdio:['pipe','pipe','ignore'], timeout:60_000,
  });
  active.add(child);
  const exit = once(child, 'close').finally(() => active.delete(child));
  child.stdin.on('error', () => {});
  const lines = createInterface({input:child.stdout})[Symbol.asyncIterator]();
  const receive = async () => {
    const next = await lines.next();
    if (next.done) throw Error('missing worker observation');
    return JSON.parse(next.value);
  };
  child.stdin.write(JSON.stringify(input) + '\n');
  return { child, receive, exit, finish:value => child.stdin.end(value === undefined ? '' : JSON.stringify(value) + '\n') };
}

async function run() {
  assert.ok((darwin || process.platform === 'linux') && process.getuid() > 0);
  assert.ok(values.archive && /^[0-9a-f]{64}$/.test(values.sha256) && /^[0-9a-f]{40}$/.test(values.commit));
  assert.equal(accounts.length, 2);
  for (const a of accounts) assert.ok(/^[a-z_][a-z0-9_-]{0,31}$/.test(a));
  const uids = [role,...accounts].map(a => {
    const uid = Number(execFileSync('/usr/bin/id', ['-u',a], io).trim());
    const groups = execFileSync('/usr/bin/id', ['-Gn',a], io).trim().split(/\s+/);
    assert.ok(Number.isSafeInteger(uid) && uid > 0 && !groups.some(g => ['wheel','admin','sudo','root'].includes(g)));
    return uid;
  });
  assert.equal(new Set([process.getuid(),...uids]).size, 4);
  if (darwin) {
    assert.equal(values['linux-fixture-dir'], undefined);
    requireDarwinClone(values['exclusive-disposable-clone'], uids[0]);
  }
  const suite = suiteRevision();
  const platform = values['offline-platform'] ? null : (await platformContext()).revision;
  phase = 'archive verification';
  const tmp = realpathSync(darwin ? '/private/tmp' : '/tmp');
  stage = mkdtempSync(join(tmp,'s2-code-'));
  const hq = join(stage,'hq');
  // The root remains private until extraction and verification are finished.
  const umask = process.umask(0o022);
  try {
    execFileSync('python3', [join(ROOT,'scripts/archive.py'),'--hq-tar',resolve(values.archive),values.sha256,hq], io);
  } finally { process.umask(umask); }
  const json = rel => JSON.parse(readFileSync(join(hq,rel)));
  const meta = json('governance/interim-release.json');
  assert.equal(meta.schema_version, 1);
  assert.equal(meta.hq_commit, values.commit);
  assert.equal(meta.target_platform ?? 'linux', process.platform);
  const contracts = json('governance/soul-contracts.json');
  assert.equal(meta.contracts_commit, contracts.commit);
  assert.equal(meta.contracts_digest, contracts.digest);
  verifyContracts(join(hq,'vendor/soul-contracts'), contracts);
  const workerFile = join(stage,'worker.mjs');
  copyFileSync(fileURLToPath(new URL('./native-worker.mjs',import.meta.url)), workerFile);
  chmodSync(workerFile, 0o644);
  chmodSync(stage, 0o755); // This directory contains only verified public code.
  phase = 'Linux fixture endpoint reservation';
  const dir = darwin ? darwinDir : claimLinuxEndpoints(values['linux-fixture-dir'], process.getuid());
  phase = 'HQ private state allocation';
  home = roleDirectory(tmp, 's2-host-', uids[0]);
  const started = new Date().toISOString();
  let previous;
  const observations = [];
  for (const pass of [1,2]) {
    phase = 'fixture HQ startup, pass ' + pass;
    if (darwin) requireDarwinClone(values['exclusive-disposable-clone'], uids[0]);
    const host = worker(role, 'host', {home, account:role, accounts, dir, pass, previous});
    try {
      const ready = await host.receive();
      assert.equal(ready.sockets.length, 2);
      assert.equal(ready.tickets.length, 2);
      if (previous) assert.deepEqual(ready.tickets, previous.tickets);
      const members = [];
      const taskRequests = {};
      const taskReceipts = {};
      for (const [i, account] of accounts.entries()) {
        phase = 'own-account bind and directive read, pass ' + pass;
        const ticket = ready.tickets[i];
        assert.equal(ready.sockets[i], join(dir, account, 'broker.sock'));
        const roleName = ticket.role;
        let request;
        if (pass === 1) {
          const expectedRevision = roleName === 'lead'
            ? ready.task.offer.revision : taskReceipts.lead.receipt.revision;
          request = {
            contract:'task/v1', request_id:`req_stage2a_${roleName}`, operation_id:`op_stage2a_${roleName}`,
            installation_epoch:ready.task.installation_epoch, lease_generation:ready.task.lease_generation,
            runtime_id:ticket.runtime_id, task_id:ready.task.offer.task_id, expected_revision:expectedRevision,
            transition:roleName === 'lead' ? 'accepted' : 'completed',
            ...(roleName === 'specialist' ? {result_ref:'artifact_stage2a'} : {}),
          };
          taskRequests[roleName] = request;
        } else {
          request = ready.task.requests[roleName];
        }
        const task = {...ready.task, requests:{[roleName]:request}};
        const m = worker(account, 'member-task', {account, socket:ready.sockets[i], ticket, task, pass});
        m.finish();
        try {
          const result = await m.receive();
          assert.deepEqual([result.bound,result.directives_read,result.uid], [true,true,uids[i+1]]);
          assert.equal(result.task_replayed, true);
          assert.equal(result.after_restart, pass === 2);
          if (pass === 1) taskReceipts[roleName] = {runtime_id:ticket.runtime_id, receipt:result.task_receipt};
          else assert.deepEqual(result.task_receipt, ready.task.memberReceipts[roleName].receipt);
          members.push({...result, role:roleName});
          assert.deepEqual(await m.exit, [0,null]);
        } finally { m.child.stdin.end(); await m.exit; }
      }
      phase = 'persisted receipt check, pass ' + pass;
      host.finish({cmd:'check-receipts', requests:pass === 1 ? taskRequests : ready.task.requests,
        memberReceipts:members.map(({role:memberRole, uid, task_receipt, task_replayed, after_restart}) =>
          ({role:memberRole, runtime_id:ready.tickets.find(t => t.role === memberRole).runtime_id,
            uid, receipt:task_receipt, replayed:task_replayed, after_restart}))});
      const receipt = await host.receive();
      observations.push({...receipt, account_count:new Set(members.map(m => m.uid)).size,
        directives:members.filter(m => m.directives_read).length});
      previous = {tickets:ready.tickets, task:receipt.task};
      assert.deepEqual(await host.exit, [0,null]);
    } finally { host.child.stdin.end(); await host.exit; }
  }
  const environment = darwin ? 'exclusive-disposable-macos-vm' : 'isolated-linux-endpoints';
  return hostReport({started, suite, platform, environment, os:process.platform, arch:arch(), release:release(),
    os_version:darwin ? execFileSync('/usr/bin/sw_vers',['-productVersion'],io).trim() : release(),
    archive_sha256:values.sha256, meta, policy:hash(readFileSync(join(hq,'governance/plugins.json'))), observations});
}

try {
  let result;
  try { result = await run(); }
  finally {
    try {
      const failures = [];
      for (const item of roleDirectories.reverse()) {
        try { removeRoleDirectory(item); } catch (e) { failures.push(e); }
      }
      if (failures.length) throw new AggregateError(failures);
    } finally {
      if (stage) rmSync(stage, {recursive:true, force:true});
    }
  }
  assert.equal(interrupted, false);
  const json = JSON.stringify(result,null,2) + '\n';
  phase = 'report output';
  if (values.out) writeFileSync(values.out,json,{flag:'wx'});
  else process.stdout.write(json);
  process.exitCode = 1; // Release gate incomplete, validated positive evidence available.
} catch {
  console.error('Stage 2a host check failed during ' + phase + '. No report was issued.');
  process.exitCode = 2;
}
