import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

assert.equal(readFileSync(new URL('answer.txt', import.meta.url), 'utf8'), 'status=fixed\n');
process.stdout.write('hello.soul approved check: pass\n');
