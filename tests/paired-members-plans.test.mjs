import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ARCHIVES_PIN, CACHE, ROOT } from '../lib/pins.mjs';

test('paired HQ reads signed saved Machine plans on macOS', { skip: process.platform !== 'darwin' }, (t) => {
  function subject(component) {
    const name = `members-${component}`;
    const pin = ARCHIVES_PIN[name];
    assert.match(pin.commit, /^[a-f0-9]{40}$/);
    assert.equal(pin.url, `https://codeload.github.com/true-line/agent-bot-${component}/tar.gz/${pin.commit}`);
    return execFileSync('python3', [join(ROOT, 'scripts/archive.py'), name, CACHE], { encoding: 'utf8', timeout: 120_000 }).trim();
  }
  const machine = subject('machine');
  const hq = subject('hq');
  const suite = join(ROOT, 'suites/paired-members-plans');
  const temp = mkdtempSync(join(realpathSync(tmpdir()), 'paired-plans-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const filename = 'paired_members_interop_test.go';
  const overlay = join(temp, 'overlay.json');
  writeFileSync(overlay, JSON.stringify({ Replace: { [join(machine, 'internal/daemon', filename)]: join(suite, filename) } }));
  execFileSync('go', ['test', '-overlay', overlay, '-count=1', '-run', '^TestPairedMembersInterop$', '-v', './internal/daemon'], {
    cwd: machine, stdio: 'inherit', timeout: 180_000,
    env: { ...process.env, HQ_PLAN_CLIENT: join(suite, 'client.mjs'), HQ_PLAN_MODULE: join(hq, 'hq/machine-channel.mjs'), HQ_PLAN_NODE: process.execPath },
  });
});
