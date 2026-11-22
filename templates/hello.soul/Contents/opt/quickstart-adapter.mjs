#!/usr/bin/env node
import { constants, ftruncateSync, lstatSync, readFileSync, writeSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkAnswer, readWorkspaceText, withWorkspaceFile } from './quickstart-check.mjs';

const [runtimeBin, workspace] = process.argv.slice(2);
if (process.argv.length !== 4 || !isAbsolute(runtimeBin) || !isAbsolute(workspace)) {
  throw new Error('quickstart adapter requires an absolute runtime path and an absolute workspace path');
}
if (!lstatSync(runtimeBin).isFile()) throw new Error('quickstart runtime entry must be a regular file');

if (process.env.AGENT_BOT_SOULS_ROLE === 'specialist') {
  const issue = readWorkspaceText(join(workspace, 'issue.md'));
  if (!issue.includes('status=broken') || !issue.includes('status=fixed')) throw new Error('seeded issue does not describe the approved repair');
  const answer = join(workspace, 'answer.txt');
  withWorkspaceFile(answer, constants.O_RDWR, (fd) => {
    const current = readFileSync(fd, 'utf8');
    const fixed = 'status=fixed\n';
    if (current === fixed) return;
    if (current !== 'status=broken\n') throw new Error('unexpected seeded answer');
    const written = writeSync(fd, fixed, 0, 'utf8');
    if (written !== fixed.length) throw new Error('quickstart repair wrote an incomplete answer');
    ftruncateSync(fd, written);
  });
  checkAnswer(answer);
  process.stdout.write('hello.soul approved check: pass\n');
}

process.argv = [process.execPath, runtimeBin, 'fake-adapter'];
await import(pathToFileURL(runtimeBin).href);
