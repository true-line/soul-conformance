import assert from 'node:assert/strict';
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute } from 'node:path';

export function withWorkspaceFile(path, flags, use) {
  const workspace = dirname(path);
  if (!isAbsolute(path) || realpathSync(workspace) !== workspace) {
    throw new Error('quickstart workspace path must be canonical');
  }
  const { O_NOFOLLOW, O_NONBLOCK } = constants;
  if (O_NOFOLLOW === undefined || O_NONBLOCK === undefined) {
    throw new Error('quickstart requires no-follow, nonblocking file access');
  }
  // Keep validation and I/O on the same open file inside the supplied workspace.
  const fd = openSync(path, flags | O_NOFOLLOW | O_NONBLOCK);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1) {
      throw new Error('quickstart workspace input must be a regular file with one link');
    }
    return use(fd);
  } finally {
    closeSync(fd);
  }
}

export function readWorkspaceText(path) {
  return withWorkspaceFile(path, constants.O_RDONLY, (fd) => readFileSync(fd, 'utf8'));
}

export function checkAnswer(answer) {
  assert.equal(basename(answer), 'answer.txt');
  assert.equal(readWorkspaceText(answer), 'status=fixed\n');
}
