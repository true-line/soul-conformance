#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtimeBin = process.env.HELLO_SOUL_RUNTIME_BIN;
const workspace = process.env.HELLO_SOUL_WORKSPACE;
if (!runtimeBin || !workspace) throw new Error('quickstart adapter needs its instantiated runtime and workspace paths');

if (process.env.AGENT_BOT_SOULS_ROLE === 'specialist') {
  const issue = readFileSync(join(workspace, 'issue.md'), 'utf8');
  if (!issue.includes('status=broken') || !issue.includes('status=fixed')) throw new Error('seeded issue does not describe the approved repair');
  const answer = join(workspace, 'answer.txt');
  const current = readFileSync(answer, 'utf8');
  if (current === 'status=broken\n') writeFileSync(answer, 'status=fixed\n');
  else if (current !== 'status=fixed\n') throw new Error(`unexpected seeded answer ${JSON.stringify(current)}`);
  execFileSync(process.execPath, [join(workspace, 'check.mjs')], { stdio: 'inherit' });
}

process.argv = [process.execPath, runtimeBin, 'fake-adapter'];
await import(pathToFileURL(runtimeBin).href);
