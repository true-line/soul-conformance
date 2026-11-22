import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';

const runner = new URL('../suites/stage2a/qualification-runner.mjs', import.meta.url).pathname;
const schema = 'soul-conformance/qualification-session/v1';
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, x) =>
  x && !Array.isArray(x) && typeof x === 'object'
    ? Object.fromEntries(Object.entries(x).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
const wire = value => {
  const data = Buffer.from(canonical(value));
  const result = Buffer.alloc(4 + data.length);
  result.writeUInt32BE(data.length);
  data.copy(result,4);
  return result;
};

class Reader {
  constructor(socket) {
    this.buffer = Buffer.alloc(0);
    this.pending = null;
    socket.on('data', data => { this.buffer = Buffer.concat([this.buffer,data]); this.pending?.(); });
  }
  async read() {
    while (this.buffer.length < 4 || this.buffer.length < 4 + this.buffer.readUInt32BE(0)) {
      await new Promise((resolve,reject) => {
        const timer = setTimeout(() => reject(Error('frame timeout')),5000);
        this.pending = () => { clearTimeout(timer); this.pending = null; resolve(); };
      });
    }
    const length = this.buffer.readUInt32BE(0);
    const value = JSON.parse(this.buffer.subarray(4,4+length));
    this.buffer = this.buffer.subarray(4+length);
    return value;
  }
}

async function session(run) {
  const dir = mkdtempSync(join(tmpdir(),'q-observer-'));
  const file = join(dir,'sample');
  const socketPath = join(dir,'a.sock');
  writeFileSync(file,'sample');
  const server = createServer();
  server.listen(socketPath);
  await once(server,'listening');
  const peerPromise = once(server,'connection');
  const child = spawn(process.execPath,[runner,'--connect',socketPath],{stdio:['ignore','ignore','pipe']});
  let stderr = '';
  child.stderr.on('data',chunk => { stderr += chunk; });
  const exit = once(child,'exit');
  const [socket] = await peerPromise;
  const reader = new Reader(socket);
  const begin = {
    schema,kind:'begin',session_id:'a'.repeat(32),challenge_base64url:randomBytes(32).toString('base64url'),
    cohort_id:'cohort',installation_id:'install',soul_id:'soul',start_id:'start',host_id:'host',
    profile:'managed-protected',reservation_sha256:sha('reservation'),test_plan_sha256:sha('plan'),
    suite_revision:'b'.repeat(40),q_uid:process.getuid(),q_gid:process.getgid(),
    deadline_at:new Date(Date.now()+300000).toISOString(),path_roots:[dir],ps_sha256:sha(readFileSync('/bin/ps')),
  };
  try { await run({begin,reader,socket,child,exit,file,dir}); }
  finally {
    socket.destroy();
    child.kill();
    await exit;
    server.close();
    rmSync(dir,{recursive:true,force:true});
  }
  return stderr;
}

test('returns bounded process and lstat observations with transcript digest, no verdict', async () => {
  await session(async ({begin,reader,socket,child,exit,file}) => {
    socket.write(wire(begin));
    const ready = await reader.read();
    assert.equal(ready.kind,'ready');
    assert.equal(ready.uid,process.getuid());
    assert.equal(ready.source_sha256,sha(readFileSync(runner)));
    const request = {schema,kind:'observe',session_id:begin.session_id,sequence:1,gate:'T02',
      phase:'file_probe',event_id:'sample_1',processes:[{role:'q',pid:child.pid}],paths:[{role:'sample',path:file}]};
    socket.write(wire(request));
    const observed = await reader.read();
    assert.equal(observed.kind,'observation');
    assert.equal(observed.request_sha256,sha(wire(request).subarray(4)));
    assert.match(observed.processes[0].stdout, new RegExp(String(child.pid)));
    assert.equal(observed.paths[0].exists,true);
    assert.equal(observed.paths[0].type,'file');
    assert.equal(Object.hasOwn(observed,'result'),false);
    socket.write(wire({schema,kind:'finish',session_id:begin.session_id,sequence:2}));
    const finished = await reader.read();
    assert.equal(finished.kind,'finished');
    assert.equal(finished.observation_count,1);
    assert.equal(finished.observations_sha256,sha(wire(observed)));
    assert.equal((await exit)[0],0);
  });
});

test('refuses a mismatched Q account before ready', async () => {
  const stderr = await session(async ({begin,socket,exit}) => {
    begin.q_uid++;
    socket.write(wire(begin));
    assert.equal((await exit)[0],2);
  });
  assert.match(stderr,/Q identity mismatch/);
});

test('refuses paths outside A-reviewed roots', async () => {
  const stderr = await session(async ({begin,socket,reader,exit}) => {
    socket.write(wire(begin));
    await reader.read();
    socket.write(wire({schema,kind:'observe',session_id:begin.session_id,sequence:1,gate:'T02',
      phase:'file_probe',event_id:'outside',processes:[],paths:[{role:'outside',path:'/etc/passwd'}]}));
    assert.equal((await exit)[0],2);
  });
  assert.match(stderr,/outside reviewed roots/);
});

test('refuses an intermediate symlink escape from a reviewed root', async () => {
  const stderr = await session(async ({begin,socket,reader,exit,dir}) => {
    symlinkSync('/etc',join(dir,'escape'));
    socket.write(wire(begin));
    await reader.read();
    socket.write(wire({schema,kind:'observe',session_id:begin.session_id,sequence:1,gate:'T02',
      phase:'file_probe',event_id:'symlink',processes:[],
      paths:[{role:'escaped',path:join(dir,'escape','passwd')}]}));
    assert.equal((await exit)[0],2);
  });
  assert.match(stderr,/path symlink escape/);
});

test('records a child as absent when cleanup removes its parent after begin', async () => {
  await session(async ({begin,socket,reader,exit,dir}) => {
    const parent = join(dir,'cleanup');
    mkdirSync(parent);
    socket.write(wire(begin));
    await reader.read();
    rmSync(parent,{recursive:true});
    socket.write(wire({schema,kind:'observe',session_id:begin.session_id,sequence:1,gate:'T01',
      phase:'after_cleanup',event_id:'missing_socket',processes:[],
      paths:[{role:'socket',path:join(parent,'owner.sock')}]}));
    const observed = await reader.read();
    assert.deepEqual(observed.paths,[{role:'socket',path:join(parent,'owner.sock'),exists:false,error:'ENOENT'}]);
    socket.write(wire({schema,kind:'finish',session_id:begin.session_id,sequence:2}));
    assert.equal((await reader.read()).kind,'finished');
    assert.equal((await exit)[0],0);
  });
});

test('refuses noncanonical and changed observer bytes', async () => {
  for (const alteration of ['noncanonical','observer']) {
    const stderr = await session(async ({begin,socket,exit}) => {
      if (alteration === 'observer') begin.ps_sha256 = sha('wrong');
      const bytes = alteration === 'noncanonical' ? Buffer.from(JSON.stringify(begin)) : wire(begin);
      if (alteration === 'noncanonical') {
        const prefix = Buffer.alloc(4);
        prefix.writeUInt32BE(bytes.length);
        socket.write(Buffer.concat([prefix,bytes]));
      } else socket.write(bytes);
      assert.equal((await exit)[0],2);
    });
    assert.match(stderr,alteration === 'observer' ? /observer digest mismatch/ : /noncanonical frame/);
  }
});

test('refuses replayed sequence and stale session deadline', async () => {
  const replay = await session(async ({begin,socket,reader,exit}) => {
    socket.write(wire(begin));
    await reader.read();
    const heartbeat = {schema,kind:'heartbeat',session_id:begin.session_id,sequence:1};
    socket.write(wire(heartbeat));
    assert.equal((await reader.read()).sequence,1);
    socket.write(wire(heartbeat));
    assert.equal((await exit)[0],2);
  });
  assert.match(replay,/session sequence/);
  const stale = await session(async ({begin,socket,exit}) => {
    begin.deadline_at = new Date(Date.now()-1000).toISOString();
    socket.write(wire(begin));
    assert.equal((await exit)[0],2);
  });
  assert.match(stale,/invalid deadline/);
});
