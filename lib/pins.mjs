// Pinned inputs: the soul-contracts release (build-time dependency) and the
// implementations under test (test-time only). Everything is fetched from
// public URLs with no credential, checked against its pin, and refused on any
// mismatch. Nothing falls back to an unpinned copy.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

// git with no credential helper, prompt, hook, alias or injected header.
function git(cwd, ...args) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key) || ['GIT_ASKPASS', 'SSH_ASKPASS', 'GH_TOKEN', 'GITHUB_TOKEN'].includes(key)) delete env[key];
  }
  return execFileSync('git', ['-c', 'credential.helper=', '-c', 'core.askPass=', '-c', 'core.hooksPath=/dev/null', '-C', cwd, ...args],
    { env, timeout: 120_000, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Fetch `ref` of `repository` into a bare work repo and check it resolves to `commit`.
function fetchExact(work, repository, ref, commit) {
  git(work, 'init', '-q');
  git(work, 'fetch', '-q', '--depth', '1', '--no-tags', repository, ref);
  const head = git(work, 'rev-parse', 'FETCH_HEAD^{commit}').toString().trim();
  if (head !== commit) throw new Error(`${repository} ${ref} is ${head}, pinned ${commit}`);
}

// Write the regular files of `commit` under `paths` (all when empty) into `tree`.
function extract(work, commit, paths, tree) {
  const rows = git(work, 'ls-tree', '-r', '-z', commit, '--', ...paths).toString().split('\0').filter(Boolean);
  for (const row of rows) {
    const [meta, path] = row.split('\t');
    const [mode, type, oid] = meta.split(' ');
    if (type === 'commit') continue; // submodule: not part of what we run
    if (type !== 'blob') throw new Error(`${path}: unexpected ${type}`);
    if (!MODES.has(mode)) {
      if (paths.length) throw new Error(`${path}: mode ${mode} in a pinned contract path`);
      continue; // a symlink in a subject tree is never materialized
    }
    if (path.startsWith('/') || path.split('/').some((s) => !s || s === '.' || s === '..')) throw new Error(`${path}: not canonical`);
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), git(work, 'cat-file', 'blob', oid), { mode: mode === '100755' ? 0o755 : 0o644 });
  }
}

function materialize(target, build) {
  if (existsSync(target)) return target;
  mkdirSync(dirname(target), { recursive: true });
  const work = mkdtempSync(`${target}.tmp-`);
  try {
    const tree = join(work, 'tree');
    mkdirSync(join(work, 'repo'));
    mkdirSync(tree);
    build(join(work, 'repo'), tree);
    try { renameSync(tree, target); } catch (error) { if (!existsSync(target)) throw error; }
    return target;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

export function prepareContracts(pin = CONTRACTS_PIN) {
  const target = join(CACHE, `soul-contracts-${pin.commit}`);
  materialize(target, (repo, tree) => {
    fetchExact(repo, pin.repository, `refs/tags/${pin.tag}`, pin.commit);
    extract(repo, pin.commit, pin.paths, tree);
    verifyContracts(tree, pin);
  });
  verifyContracts(target, pin);
  return target;
}

export function prepareSubject(name, pin = SUBJECTS_PIN.subjects[name]) {
  if (!pin) throw new Error(`no pinned subject ${name}`);
  const target = join(CACHE, 'subjects', `${name}-${pin.commit}`);
  materialize(target, (repo, tree) => {
    fetchExact(repo, pin.repository, pin.commit, pin.commit);
    extract(repo, pin.commit, [], tree);
    writeFileSync(join(tree, '.soul-conformance-commit'), `${pin.commit}\n`);
  });
  const recorded = readFileSync(join(target, '.soul-conformance-commit'), 'utf8').trim();
  if (recorded !== pin.commit || !existsSync(join(target, pin.entry))) throw new Error(`${name}: cached tree at ${target} is not ${pin.commit}`);
  return target;
}

export function prepareAll() {
  return {
    contracts: prepareContracts(),
    subjects: Object.fromEntries(Object.keys(SUBJECTS_PIN.subjects).map((name) => [name, prepareSubject(name)])),
  };
}
