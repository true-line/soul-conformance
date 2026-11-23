#!/usr/bin/env node
// Independent, read-only Q observer. A owns the listener, plan, corroboration and verdict.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createConnection } from 'node:net';
import { isAbsolute, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'soul-conformance/qualification-session/v1';
// ps_sha256 names the fixed ps-compatible observer format on the v1 wire.
const PROCESS_OBSERVER = '/private/var/db/managed-machine/qualification-q/process-observer';
const MAX_FRAME = 65536;
const MAX_OBSERVATIONS = 128;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TOKEN = /^[a-z][a-z0-9_-]{0,63}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const ASCII = /^[\x00-\x7f]*$/;
const PRINTABLE = /^[\x20-\x7e]*$/;
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw Error(message); };
const keys = (object, required, optional = []) => {
  if (!object || typeof object !== 'object' || Array.isArray(object)) fail('object required');
  const actual = Object.keys(object);
  if (required.some(k => !actual.includes(k)) || actual.some(k => !required.includes(k) && !optional.includes(k))) fail('unexpected fields');
};
const safeInt = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const token = (s, max = 64) => typeof s === 'string' && s.length <= max && TOKEN.test(s);
const ascii = (s, max) => typeof s === 'string' && s.length <= max && PRINTABLE.test(s);
const digest = s => typeof s === 'string' && DIGEST.test(s);

function canonical(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (typeof value === 'string' && ASCII.test(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(k => {
      if (!PRINTABLE.test(k)) fail('non-ASCII field');
      return JSON.stringify(k) + ':' + canonical(value[k]);
    }).join(',') + '}';
  }
  fail('noncanonical value');
}

function frame(value) {
  const payload = Buffer.from(canonical(value), 'ascii');
  if (payload.length < 1 || payload.length > MAX_FRAME) fail('frame size');
  const result = Buffer.allocUnsafe(payload.length + 4);
  result.writeUInt32BE(payload.length);
  payload.copy(result, 4);
  return result;
}

class Channel {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.pending = null;
    this.error = null;
    socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > MAX_FRAME * 2 + 8) this.error = Error('input buffer exceeded');
      this.wake();
    });
    socket.on('error', error => { this.error = error; this.wake(); });
    socket.on('end', () => { this.error = Error('A closed session'); this.wake(); });
    socket.on('close', () => { this.error ??= Error('socket closed'); this.wake(); });
  }
  wake() { if (this.pending) { const wake = this.pending; this.pending = null; wake(); } }
  async read(timeout) {
    const until = Date.now() + timeout;
    while (true) {
      if (this.error) throw this.error;
      if (this.buffer.length >= 4) {
        const length = this.buffer.readUInt32BE(0);
        if (length < 1 || length > MAX_FRAME) fail('frame length');
        if (this.buffer.length >= length + 4) {
          const bytes = this.buffer.subarray(4, length + 4);
          this.buffer = this.buffer.subarray(length + 4);
          const decoded = new TextDecoder('utf-8', { fatal:true }).decode(bytes);
          const object = JSON.parse(decoded);
          if (!Buffer.from(canonical(object), 'ascii').equals(bytes)) fail('noncanonical frame');
          return { object, bytes };
        }
      }
      await new Promise((resolve, reject) => {
        const remaining = until - Date.now();
        if (remaining <= 0) { reject(Error('frame timeout')); return; }
        const timer = setTimeout(() => { this.pending = null; reject(Error('frame timeout')); }, remaining);
        this.pending = () => { clearTimeout(timer); resolve(); };
      });
    }
  }
  async send(object) {
    const bytes = frame(object);
    await new Promise((resolve, reject) => this.socket.write(bytes, error => error ? reject(error) : resolve()));
    return bytes;
  }
}

function absolutePath(path) {
  return ascii(path, 512) && isAbsolute(path) && path !== '/' && !path.endsWith(sep) && normalize(path) === path &&
    !path.split(sep).some(segment => segment === '.' || segment === '..') && !path.includes('//');
}

function begin(value) {
  keys(value, ['schema','kind','session_id','challenge_base64url','cohort_id','installation_id','soul_id',
    'start_id','host_id','profile','reservation_sha256','test_plan_sha256','suite_revision',
    'q_uid','q_gid','deadline_at','path_roots','ps_sha256',
    ...(value.require_argv_proof === true ? ['require_argv_proof'] : [])]);
  if (value.schema !== SCHEMA || value.kind !== 'begin' || !HEX32.test(value.session_id) ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.challenge_base64url) ||
      Buffer.from(value.challenge_base64url, 'base64url').toString('base64url') !== value.challenge_base64url ||
      ![value.cohort_id,value.installation_id,value.soul_id,value.start_id,value.host_id].every(s => ascii(s,128) && s.length > 0) ||
      !['managed-protected','managed-cooperative'].includes(value.profile) ||
      !digest(value.reservation_sha256) || !digest(value.test_plan_sha256) ||
      !HEX40.test(value.suite_revision) || !safeInt(value.q_uid,1,2147483647) ||
      !safeInt(value.q_gid,1,2147483647) || !digest(value.ps_sha256) ||
      !Array.isArray(value.path_roots) || value.path_roots.length < 1 || value.path_roots.length > 16 ||
      !value.path_roots.every(absolutePath) || new Set(value.path_roots).size !== value.path_roots.length) fail('invalid begin');
  const deadline = Date.parse(value.deadline_at);
  const now = Date.now();
  if (!ascii(value.deadline_at,32) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value.deadline_at) ||
      !Number.isFinite(deadline) || deadline <= now || deadline > now + 3600000) fail('invalid deadline');
  if (process.getuid() !== value.q_uid || process.getgid() !== value.q_gid) fail('Q identity mismatch');
  if (hash(readFileSync(PROCESS_OBSERVER)) !== value.ps_sha256) fail('observer digest mismatch');
  const roots = value.path_roots.map(path => {
    if (!lstatSync(path).isDirectory() || realpathSync(path) !== path) fail('root is not a canonical directory');
    return { path, real:path };
  });
  return { deadline, roots, challengeHash:hash(Buffer.from(value.challenge_base64url,'base64url')) };
}

function validateRequest(value, session, sequence, kind) {
  const common = ['schema','kind','session_id','sequence'];
  if (kind === 'observe') keys(value, [...common,'gate','phase','event_id','processes','paths'], ['stimulus_ref']);
  else keys(value, common);
  if (value.schema !== SCHEMA || value.kind !== kind || value.session_id !== session ||
      value.sequence !== sequence || !safeInt(value.sequence,1,1024)) fail('session sequence');
  if (kind !== 'observe') return;
  if (!['T01','T02','T03','T21'].includes(value.gate) || !token(value.phase) || !token(value.event_id) ||
      !Array.isArray(value.processes) || value.processes.length > 16 ||
      !Array.isArray(value.paths) || value.paths.length > 32) fail('invalid observation request');
  for (const p of value.processes) {
    keys(p,['role','pid']);
    if (!token(p.role) || !safeInt(p.pid,1,2147483647)) fail('invalid process');
  }
  for (const p of value.paths) {
    keys(p,['role','path']);
    if (!token(p.role) || !absolutePath(p.path)) fail('invalid path');
  }
  if (value.stimulus_ref !== undefined) {
    keys(value.stimulus_ref,['uri','sha256']);
    if (!ascii(value.stimulus_ref.uri,512) || !digest(value.stimulus_ref.sha256)) fail('invalid stimulus reference');
  }
}

function probeProcess({role,pid}) {
  const result = spawnSync(PROCESS_OBSERVER,['-p',String(pid),'-o','pid=','-o','uid=','-o','gid=','-o','comm='],
    {encoding:'utf8',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},timeout:3000,maxBuffer:2048,stdio:['ignore','pipe','pipe']});
  if (result.error || result.status === null) fail('process observer failed');
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (stdout.length > 2048 || stderr.length > 2048 || !ASCII.test(stdout) || !ASCII.test(stderr)) fail('process observer output outside ASCII bound');
  return {role,pid,status:result.status,stdout,stderr};
}

function probePath({role,path}, roots) {
  const root = roots.find(r => path === r.path || path.startsWith(r.path + sep));
  if (!root) fail('path outside reviewed roots');
  const unavailable = error => ({role,path,exists:['EACCES','EPERM'].includes(error) ? null : false,error});
  // Walk each parent. A removed parent is an absent observation; a link that
  // resolves outside the reviewed root remains a hard refusal.
  const underRoot = real => real === root.real || real.startsWith(root.real + sep);
  const parents = path === root.path ? [] : path.slice(root.path.length + 1).split(sep).slice(0,-1);
  let current = root.path;
  for (const part of ['',...parents]) {
    if (part) current += sep + part;
    try {
      const st = lstatSync(current);
      if (!st.isDirectory() && !st.isSymbolicLink()) return unavailable('ENOTDIR');
      let real;
      try { real = realpathSync(current); }
      catch (error) {
        if (st.isSymbolicLink()) fail('unresolved parent symlink');
        throw error;
      }
      if (!underRoot(real)) fail('path symlink escape');
    } catch (error) {
      if (['ENOENT','EACCES','EPERM','ENOTDIR'].includes(error.code)) return unavailable(error.code);
      throw error;
    }
  }
  try {
    const st = lstatSync(path, {bigint:true});
    const type = st.isFile() ? 'file' : st.isDirectory() ? 'directory' : st.isSymbolicLink() ? 'symlink' : 'other';
    return {role,path,exists:true,dev:String(st.dev),ino:String(st.ino),uid:Number(st.uid),
      gid:Number(st.gid),mode:Number(st.mode & 0o7777n),type};
  } catch (error) {
    if (!['ENOENT','EACCES','EPERM','ENOTDIR'].includes(error.code)) throw error;
    return unavailable(error.code);
  }
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--connect' || !absolutePath(process.argv[3])) fail('usage');
  const socket = createConnection({path:process.argv[3]});
  const channel = new Channel(socket);
  try {
    const first = (await channel.read(10000)).object;
    const state = begin(first);
    const session = first.session_id;
    const challenge_sha256 = state.challengeHash;
    const source_sha256 = hash(readFileSync(fileURLToPath(import.meta.url)));
    await channel.send({schema:SCHEMA,kind:'ready',session_id:session,challenge_sha256,sequence:0,
      pid:process.pid,uid:process.getuid(),gid:process.getgid(),source_sha256,captured_at:new Date().toISOString(),
      ...(first.require_argv_proof === true ? {exec_path:process.execPath, argv:[process.argv0,...process.argv.slice(1)]} : {})});
    let sequence = 1;
    let count = 0;
    const transcript = createHash('sha256');
    for (;;) {
      const remaining = state.deadline - Date.now();
      if (remaining <= 0) fail('session deadline');
      const {object:request,bytes} = await channel.read(Math.min(60000,remaining));
      if (!['observe','heartbeat','finish'].includes(request.kind)) fail('invalid command');
      validateRequest(request,session,sequence,request.kind);
      if (request.kind === 'finish') {
        if (channel.buffer.length) fail('trailing frame after finish');
        await channel.send({schema:SCHEMA,kind:'finished',session_id:session,challenge_sha256,
          sequence,observation_count:count,observations_sha256:'sha256:' + transcript.digest('hex'),
          captured_at:new Date().toISOString()});
        socket.end();
        return;
      }
      if (request.kind === 'heartbeat') {
        await channel.send({schema:SCHEMA,kind:'heartbeat',session_id:session,challenge_sha256,
          sequence,captured_at:new Date().toISOString()});
      } else {
        if (++count > MAX_OBSERVATIONS) fail('observation limit');
        const processes = request.processes.map(probeProcess);
        const paths = request.paths.map(p => probePath(p,state.roots));
        const response = {schema:SCHEMA,kind:'observation',session_id:session,challenge_sha256,
          sequence,request_sha256:hash(bytes),captured_at:new Date().toISOString(),
          gate:request.gate,phase:request.phase,event_id:request.event_id,processes,paths,
          ...(request.stimulus_ref === undefined ? {} : {stimulus_ref:request.stimulus_ref})};
        transcript.update(await channel.send(response));
      }
      sequence++;
    }
  } finally { socket.destroy(); }
}

main().catch(error => { process.stderr.write(`qualification runner refused: ${error.message}\n`); process.exitCode = 2; });
