// Copied beside the verified archive so the disposable roles can import its own implementation.
// Only fresh fixture binding material crosses the controller's private stdio pipes.
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), 'hq');
const load = name => import(pathToFileURL(join(root, name)));
const read = path => JSON.parse(readFileSync(join(root, path)));
const input = createInterface({input: process.stdin})[Symbol.asyncIterator]();
const receive = async () => {
  const next = await input.next();
  assert.ok(!next.done);
  return JSON.parse(next.value);
};
const send = value => process.stdout.write(JSON.stringify(value) + '\n');

async function member({ account, socket, ticket }) {
  assert.equal(userInfo().username, account);
  const { connectSocket } = await load('hq/socket.mjs');
  const { bindProof } = await load('hq/admission.mjs');
  const conn = await connectSocket(socket);
  try {
    const { channel_binding, ...expected } = ticket;
    const runtime_id = ticket.runtime_id;
    const challenge = await conn.request('bind.challenge', {runtime_id});
    assert.ok(challenge.ok && challenge.result.nonce);
    const proof = bindProof(channel_binding, challenge.result.nonce, runtime_id);
    const bind = await conn.request('bind', {runtime_id, proof});
    assert.equal(bind.ok, true);
    assert.deepEqual(bind.result, expected);
    assert.equal((await conn.request('task.directives', {})).ok, true);
    send({ uid:process.getuid(), bound:true, directives_read:true });
  } finally { await conn.close(); }
}

async function host({ home, account, accounts, dir, pass, previous }) {
  assert.equal(userInfo().username, account);
  const { createHQ } = await load('hq/hq.mjs');
  const { connectSocket } = await load('hq/socket.mjs');
  const { readPins, productionPluginsDir } = await load('hq/plugins.mjs');
  const { fakeLegacy, helloOn, schemas } = await load('tests/hq-harness.mjs');
  const hello = helloOn('adapter-a', 'adapter-b', {requested_profile:'managed-cooperative'});
  const release = read('governance/interim-release.json');
  const config = { harnesses:{dir, accounts:{'adapter-a':accounts[0], 'adapter-b':accounts[1]}},
    acceptedDefinitions:{[hello.soul_id]:[hello.definition_digest]} };
  const pins = readPins(join(root, 'governance/plugins.json'));
  const darwin = process.platform === 'darwin';
  const plugins = darwin ? { pins, pluginsDir:productionPluginsDir({}, join(root, 'hq/interim-core.mjs'), pins) } :
    { plugins:[(await load('tests/broker-fixture.mjs')).referenceBroker()] };
  // Only the enrolled/not-enrolled observation is supplied, as in HQ's native two-account producer.
  const { legacyDaemon } = await load('hq/legacy.mjs');
  const legacy = legacyDaemon({run:fakeLegacy().run});
  const hq = createHQ({home, config, schemas, legacy, ...plugins, signer:{deviceStatus:async () => 'enrolled'}});
  function checkVacant() {
    for (const name of accounts) {
      try { lstatSync(join(dir, name, 'broker.sock')); }
      catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      throw Error('occupied fixture endpoint');
    }
  }
  checkVacant();
  try {
    const status = await hq.start();
    assert.equal(status.mode, 'running');
    assert.equal(status.profile, 'managed-cooperative');
    assert.equal(status.hq.account, account);
    assert.equal(status.hq.devPlugins, undefined);
    if (darwin) {
      const [broker, ...others] = status.hq.pluginLoad.filter(p => p.name === 'agent-comms');
      assert.ok(broker && !others.length && !broker.dev && broker.state === 'loaded');
      assert.equal(broker.digest, release.broker.sha256);
      assert.ok(status.plugins.some(p => p.name === release.broker.name && p.version === release.broker.version && p.state === 'running'));
    }
    const sockets = accounts.map((account, i) => {
      const endpoint = status.hq.sockets.harnesses.find(p => p.account === account);
      assert.deepEqual(endpoint.adapters, [hello.requested_roles[i].adapter_id]);
      assert.equal(endpoint.path, join(dir, account, 'broker.sock'));
      return endpoint.path;
    });
    let tickets = previous;
    if (pass === 1) {
      const admission = await connectSocket(hq.paths.admission);
      try {
        const reply = await admission.request('Hello', hello);
        assert.ok(reply.ok && reply.result.profile === status.profile);
        tickets = hello.requested_roles.map(({role, member_id}) => {
          const rt = reply.result.admitted_runtimes.find(r => r.role === role);
          assert.ok(rt?.runtime_id && rt.channel_binding && rt.member_id === member_id);
          return { role, member_id, runtime_id:rt.runtime_id, channel_binding:rt.channel_binding };
        });
        assert.equal(new Set(tickets.map(t => t.runtime_id)).size, 2);
        assert.equal(new Set(tickets.map(t => t.channel_binding)).size, 2);
      } finally { await admission.close(); }
    }
    send({sockets, tickets});
    assert.equal(await receive(), 'check-receipts');
    const rows = hq.core.receipts.filter(r => r.kind === 'hq.bind');
    assert.equal(rows.length, pass * 2);
    for (const [i, ticket] of tickets.entries()) {
      const own = rows.filter(r => r.runtime_id === ticket.runtime_id);
      assert.equal(own.length, pass);
      for (const r of own) {
        assert.equal(r.caller_account, accounts[i]);
        assert.equal(r.member_id, ticket.member_id);
        assert.equal(r.soul_id, hello.soul_id);
        assert.equal(r.profile, status.profile);
        assert.equal(r.proof, 'hmac-sha256');
      }
    }
    send({ pass, persisted_receipts:rows.length, profile:status.profile,
      definition_digest:hello.definition_digest, soul_id:hello.soul_id });
  } finally { await hq.stop(); }
  checkVacant();
}

try {
  const first = await receive();
  if (process.argv[2] === 'member') await member(first);
  else if (process.argv[2] === 'host') await host(first);
  else throw Error('unexpected action');
} catch {
  // Assertion details may include a reusable fixture binding. Keep them off the console.
  process.exitCode = 1;
}
