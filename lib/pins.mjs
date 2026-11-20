// Pinned inputs: the soul-contracts release (build-time dependency) and the
// implementations under test (test-time only). Everything is fetched from
// public URLs with no credential, checked against its pin, and refused on any
// mismatch. Nothing falls back to an unpinned copy.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CACHE = process.env.SOUL_CONFORMANCE_CACHE || join(ROOT, '.cache');
export const CONTRACTS_PIN = Object.freeze(JSON.parse(readFileSync(join(ROOT, 'governance/soul-contracts.json'), 'utf8')));
export const SUBJECTS_PIN = Object.freeze(JSON.parse(readFileSync(join(ROOT, 'governance/subjects.json'), 'utf8')));

const MODES = new Set(['100644', '100755']);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// RFC 8785 for the only values a manifest holds: objects, strings, safe integers.
export function canonicalManifest(value) {
  if (typeof value === 'string' || Number.isSafeInteger(value)) return JSON.stringify(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalManifest(value[k])}`).join(',')}}`;
  }
  throw new TypeError(`manifest holds objects, strings and safe integers only, got ${JSON.stringify(value)}`);
}

// sha256-manifest-v1: path -> { sha256, size, mode }, digest of its JCS bytes.
export function manifestDigest(entries) {
  const manifest = {};
  for (const { path, mode, bytes } of entries) {
    if (!MODES.has(mode)) throw new Error(`${path}: mode ${mode} is not a regular file`);
    if (path.startsWith('/') || path.split('/').some((s) => !s || s === '.' || s === '..')) throw new Error(`${path}: not a canonical relative path`);
    if (Object.hasOwn(manifest, path)) throw new Error(`${path}: duplicate manifest entry`);
    manifest[path] = { sha256: sha256(bytes), size: bytes.length, mode };
  }
  return `sha256:${sha256(Buffer.from(canonicalManifest(manifest), 'utf8'))}`;
}

// Read the pinned paths of a contracts tree, never following a symlink, and
// check it equals the release manifest. Returns the file count and digest.
export function verifyContracts(directory, pin = CONTRACTS_PIN) {
  const entries = [];
  const walk = (rel) => {
    const st = lstatSync(join(directory, rel));
    if (st.isDirectory()) { for (const name of readdirSync(join(directory, rel)).sort()) walk(`${rel}/${name}`); return; }
    if (!st.isFile()) throw new Error(`${rel}: not a regular file`);
    entries.push({ path: rel, mode: st.mode & 0o111 ? '100755' : '100644', bytes: readFileSync(join(directory, rel)) });
  };
  for (const rel of pin.paths) walk(rel);
  const digest = manifestDigest(entries);
  if (pin.digest_algorithm !== 'sha256-manifest-v1') throw new Error(`unknown digest algorithm ${pin.digest_algorithm}`);
  if (entries.length !== pin.files || digest !== pin.digest) {
    throw new Error(`soul-contracts at ${directory} does not match ${pin.tag}: ${entries.length} files, ${digest}; pinned ${pin.files} files, ${pin.digest}`);
  }
  return { files: entries.length, digest };
}

// Public archives have independently reviewed SHA-256/length pins. The verifier
// checks the archive and all extracted bytes/modes on every reuse, before import.
export const ARCHIVES_PIN = Object.freeze(JSON.parse(readFileSync(join(ROOT, 'governance/archives.json'), 'utf8')).archives);
function archive(name, commit, subject = name) {
  const pin = ARCHIVES_PIN[name];
  if (!pin || pin.commit !== commit) throw new Error(`${name}: archive/source pin mismatch`);
  const expectedRepo = (subject === 'contracts' ? CONTRACTS_PIN : SUBJECTS_PIN.subjects[subject]).repository.replace('https://github.com/', '').replace(/\.git$/, '');
  if (pin.url !== `https://codeload.github.com/${expectedRepo}/tar.gz/${commit}` || !/^[a-f0-9]{64}$/.test(pin.sha256) || !Number.isSafeInteger(pin.archiveBytes)) throw new Error(`${name}: invalid archive pin`);
  return execFileSync('python3', [join(ROOT, 'scripts/archive.py'), name, CACHE], { encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 20 }).trim();
}
export function prepareContracts(pin = CONTRACTS_PIN, archiveName = 'contracts') {
  const directory = archive(archiveName, pin.commit, 'contracts');
  verifyContracts(directory, pin);
  return directory;
}
export function prepareSubject(name, pin = SUBJECTS_PIN.subjects[name], archiveName = name) {
  if (!pin) throw new Error(`no pinned subject ${name}`);
  const directory = archive(archiveName, pin.commit, name);
  const entry = pin.entry ?? SUBJECTS_PIN.subjects[name].entry;
  if (!existsSync(join(directory, entry))) throw new Error(`${name}: missing entry`);
  return directory;
}
export function prepareAll() {
  return { contracts: prepareContracts(), subjects: Object.fromEntries(Object.keys(SUBJECTS_PIN.subjects).map((name) => [name, prepareSubject(name)])) };
}
