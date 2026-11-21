// The macOS product uses fixed endpoints. Reserve the whole disposable clone
// and positively distinguish an absent Machine-managed job from a failed probe.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';

const label = 'ai.true-line.agent-bot-hq';
const command = (file, args) => spawnSync(file, args, { encoding:'utf8', timeout:5000,
  stdio:['ignore','pipe','pipe'], env:{LC_ALL:'C', PATH:'/usr/bin:/bin:/usr/sbin:/sbin'} });

export function requireDarwinClone(attested, uid, probe = command, inspect = lstatSync) {
  assert.equal(attested, true);
  const machine = probe('/usr/sbin/sysctl', ['-n','hw.model']);
  assert.ok(machine.status === 0 && /^VirtualMac\d+,\d+$/.test(machine.stdout.trim()));
  const plist = '/Library/LaunchDaemons/' + label + '.plist';
  assert.throws(() => inspect(plist), {code:'ENOENT'});
  const job = probe('/bin/launchctl', ['print','system/' + label]);
  assert.ok(job.status === 113 && job.stderr.split('\n').includes('Could not find service "' + label + '" in domain for system'));
  const processes = probe('/usr/bin/pgrep', ['-u',String(uid)]);
  assert.ok(processes.status === 1 && processes.stdout === '' && processes.stderr === '');
}
