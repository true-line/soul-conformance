#!/usr/bin/env node
// Fetch and verify every pinned input into .cache/ (or SOUL_CONFORMANCE_CACHE).
import { CONTRACTS_PIN, SUBJECTS_PIN, prepareAll } from '../lib/pins.mjs';

try {
  const { contracts, subjects } = prepareAll();
  console.log(`soul-contracts ${CONTRACTS_PIN.tag} (${CONTRACTS_PIN.commit.slice(0, 7)}) ${CONTRACTS_PIN.digest} -> ${contracts}`);
  for (const [name, dir] of Object.entries(subjects)) console.log(`${name} ${SUBJECTS_PIN.subjects[name].commit.slice(0, 7)} -> ${dir}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
