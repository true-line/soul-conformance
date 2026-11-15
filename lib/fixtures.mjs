// Fixture loader. Reads every shared fixture from the verified soul-contracts
// tree, checks the envelope and each negative's byte pin to its base
// positive, and classifies what a conforming receiver must do with it.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

// What the fixture demands of a receiver:
//   accept    schema-valid, no error: accepted and returned unchanged
//   parse     strict parsing refuses the raw text
//   schema    schema refusal (expect.error, when present, is the typed code)
//   semantic  schema-valid record whose effect HQ or the broker must refuse
export function classify(fixture) {
  if (fixture.expect.parse === 'invalid') return 'parse';
  if (fixture.expect.schema === 'invalid') return 'schema';
  if (fixture.expect.schema === 'valid' && fixture.expect.error) return 'semantic';
  if (fixture.expect.schema === 'valid') return 'accept';
  throw new Error(`fixture expects nothing recognisable: ${JSON.stringify(fixture.expect)}`);
}

export function loadFixtures(contractsDir) {
  const out = [];
  for (const kind of ['positive', 'negative']) {
    for (const file of readdirSync(join(contractsDir, 'fixtures', kind)).filter((f) => f.endsWith('.json')).sort()) {
      const bytes = readFileSync(join(contractsDir, 'fixtures', kind, file));
      const fixture = JSON.parse(bytes);
      const id = `${kind}/${file}`;
      if (typeof fixture.schema !== 'string' || !fixture.expect) throw new Error(`${id}: not a fixture envelope`);
      if (!fixture.schema.endsWith(`/${file.split('.')[0]}.schema.json`)) {
        throw new Error(`${id}: file name does not name its schema ${fixture.schema}`);
      }
      const expectation = classify(fixture);
      if (kind === 'positive' && expectation !== 'accept') throw new Error(`${id}: a positive must expect acceptance`);
      if (kind === 'negative') {
        if (expectation === 'accept') throw new Error(`${id}: a negative must expect a refusal`);
        if (!fixture.base?.fixture || !fixture.base?.sha256) throw new Error(`${id}: a negative pins its base positive`);
        const base = readFileSync(join(contractsDir, 'fixtures', fixture.base.fixture));
        if (sha256(base) !== fixture.base.sha256) throw new Error(`${id}: base ${fixture.base.fixture} bytes changed`);
      }
      if (expectation === 'parse' && typeof fixture.input_raw !== 'string') throw new Error(`${id}: parse refusal without input_raw`);
      out.push({ id, kind, file, expectation, ...fixture });
    }
  }
  return out;
}

// Schema paths in the release, relative to schemas/.
export function listSchemas(contractsDir) {
  const walk = (rel) => readdirSync(join(contractsDir, 'schemas', rel), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(rel ? `${rel}/${e.name}` : e.name) : e.name.endsWith('.schema.json') ? [rel ? `${rel}/${e.name}` : e.name] : []));
  return walk('').sort();
}

export const readJson = (contractsDir, rel) => JSON.parse(readFileSync(join(contractsDir, rel), 'utf8'));
