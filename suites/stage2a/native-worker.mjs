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

async function memberTask({ account, socket, ticket, task, pass }) {
  assert.equal(userInfo().username, account);
  const { connectSocket } = await load('hq/socket.mjs');
  const { bindProof } = await load('hq/admission.mjs');
  async function bound() {
    const conn = await connectSocket(socket);
    try {
      const challenge = await conn.request('bind.challenge', {runtime_id:ticket.runtime_id});
      assert.ok(challenge.ok && challenge.result.nonce);
      const proof = bindProof(ticket.channel_binding, challenge.result.nonce, ticket.runtime_id);
      const bind = await conn.request('bind', {runtime_id:ticket.runtime_id, proof});
      assert.equal(bind.ok, true);
      assert.deepEqual(bind.result, {role:ticket.role, member_id:ticket.member_id, runtime_id:ticket.runtime_id});
      return conn;
    } catch (error) {
      await conn.close();
      throw error;
    }
  }
  const first = await bound();
  try {
    const directiveReply = await first.request('task.directives', {});
    assert.equal(directiveReply.ok, true);
    const directives = directiveReply.result.directives;
    assert.ok(Array.isArray(directives));
    if (pass === 1 && ticket.role === 'lead') {
      assert.equal(directives.length, 1);
      const [directive] = directives;
      assert.deepEqual([directive.kind, directive.issuer.principal, directive.recipient,
        directive.task_or_decision_reference.task_id],
      ['directive', 'owner', task.soul_id, task.offer.task_id]);
      assert.equal(directive.payload.task.task_id, task.offer.task_id);
      assert.equal(directive.payload.task.status, 'offered');
    } else assert.deepEqual(directives, [], 'accepted work must no longer appear as a waiting directive');
    const view = await first.request('task.get', {task_id:task.offer.task_id});
    assert.equal(view.ok, true);
    const {task:record, proposals} = view.result;
    assert.equal(record.task_id, task.offer.task_id);
    assert.equal(record.accountable_soul, task.soul_id);
    if (pass === 1) {
      const expected = ticket.role === 'lead' ? 'offered' : 'accepted';
      assert.equal(record.status, expected);
      assert.equal(proposals.length, 0);
    } else {
      assert.equal(record.status, 'accepted');
      assert.deepEqual(proposals.map(p => [p.proposal_id, p.role, p.transition, p.evidence]),
        [[task.memberReceipts.specialist.receipt.proposal_id, 'specialist', 'completed', ['artifact_stage2a']]]);
    }
    const request = task.requests[ticket.role];
    assert.equal(request.runtime_id, ticket.runtime_id);
    const reply = await first.request('task.commit', request);
    assert.equal(reply.ok, true);
    const expected = task.memberReceipts?.[ticket.role]?.receipt;
    if (expected) assert.deepEqual(reply.result, expected);
    assert.deepEqual([reply.result.profile, reply.result.task_id, reply.result.operation_id, reply.result.by, reply.result.outcome],
      ['managed-cooperative', task.offer.task_id, request.operation_id, ticket.member_id,
        ticket.role === 'lead' ? 'committed' : 'proposal']);
    const second = await bound();
    try {
      const repeated = await second.request('task.commit', request);
      assert.equal(repeated.ok, true);
      assert.deepEqual(repeated.result, reply.result, 'a fresh bound connection must replay the original task receipt');
      send({uid:process.getuid(), bound:true, directives_read:true, task_receipt:reply.result,
        task_replayed:true, after_restart:pass === 2});
    } finally { await second.close(); }
  } finally { await first.close(); }
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
    let tickets = previous?.tickets;
    let task = previous?.task;
    if (pass === 2) {
      assert.ok(task?.offer?.task_id && task.memberReceipts?.lead && task.memberReceipts?.specialist);
      const owner = await connectSocket(hq.paths.control);
      try {
        const replay = await owner.request('tasks.offer', task.offerInput);
        assert.equal(replay.ok, true);
        assert.deepEqual(replay.result, task.offer);
      } finally { await owner.close(); }
      assertTaskAudit(hq.core.receipts, task, true);
    }
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
        const owner = await connectSocket(hq.paths.control);
        try {
          const offerInput = {
            operation_id: 'op_stage2a_owner_offer',
            objective: 'Verify cooperative task receipts across the packaged HQ restart.',
            done_criteria: 'The lead accepts and the specialist proposes fixture evidence.',
            accountable_soul: hello.soul_id,
          };
          const offer = await owner.request('tasks.offer', offerInput);
          assert.equal(offer.ok, true);
          assert.equal(offer.result.profile, status.profile);
          assert.equal(offer.result.operation_id, offerInput.operation_id);
          assert.ok(offer.result.task_id && offer.result.receipt_id);
          task = {soul_id:hello.soul_id, offerInput, offer:offer.result,
            installation_epoch:reply.result.installation_epoch, lease_generation:reply.result.lease_generation};
        } finally { await owner.close(); }
      } finally { await admission.close(); }
    }
    send({sockets, tickets, task, pass});
    const command = await receive();
    assert.equal(command?.cmd, 'check-receipts');
    if (pass === 1) {
      assert.equal(command.memberReceipts.length, 2);
      const byRole = Object.fromEntries(command.memberReceipts.map(row => [row.role, row]));
      assert.deepEqual(Object.keys(byRole).sort(), ['lead','specialist']);
      const lead = byRole.lead.receipt;
      const specialist = byRole.specialist.receipt;
      assert.equal(lead.outcome, 'committed');
      assert.equal(lead.status, 'accepted');
      assert.equal(specialist.outcome, 'proposal');
      assert.ok(specialist.proposal_id);
      task.requests = command.requests;
      task.memberReceipts = Object.fromEntries(Object.entries(byRole).map(([role,row]) => [role,
        {runtime_id:row.runtime_id, receipt:row.receipt}]));
    } else {
      assert.deepEqual(command.memberReceipts.map(row => [row.role, row.receipt]),
        Object.entries(task.memberReceipts).map(([role, value]) => [role, value.receipt]).sort(([a],[b]) => a.localeCompare(b)));
    }
    assertTaskAudit(hq.core.receipts, task, pass === 2);
    const rows = hq.core.receipts.filter(r => r.kind === 'hq.bind');
    assert.equal(rows.length, pass * 4);
    for (const [i, ticket] of tickets.entries()) {
      const own = rows.filter(r => r.runtime_id === ticket.runtime_id);
      assert.equal(own.length, pass * 2);
      for (const r of own) {
        assert.equal(r.caller_account, accounts[i]);
        assert.equal(r.member_id, ticket.member_id);
        assert.equal(r.soul_id, hello.soul_id);
        assert.equal(r.profile, status.profile);
        assert.equal(r.proof, 'hmac-sha256');
      }
    }
    send({ pass, persisted_receipts:rows.length, task_offer_receipts:1,
      cooperative_task_receipts:2, task_receipts_replayed:command.memberReceipts.filter(row => row.replayed).length,
      task_state_retained:pass === 2 ? true : null, task,
      profile:status.profile,
      definition_digest:hello.definition_digest, soul_id:hello.soul_id });
  } finally { await hq.stop(); }
  checkVacant();
}

function assertTaskAudit(receipts, task, afterRestart) {
  const offerRows = receipts.filter(r => r.kind === 'task.offer' && r.operation_id === task.offerInput.operation_id);
  assert.deepEqual(offerRows.map(r => [r.receipt_id,r.profile]), [[task.offer.receipt_id,'managed-cooperative']]);
  for (const role of ['lead','specialist']) {
    const expected = task.memberReceipts?.[role];
    if (!expected) {
      if (afterRestart) throw Error('missing persisted member task receipts');
      continue;
    }
    const rows = receipts.filter(r => r.kind === 'task.commit' && r.operation_id === expected.receipt.operation_id);
    assert.deepEqual(rows.map(r => [r.receipt_id,r.profile,r.runtime_id,r.by,r.outcome]),
      [[expected.receipt.receipt_id,'managed-cooperative',expected.runtime_id,expected.receipt.by,expected.receipt.outcome]]);
  }
}

try {
  const first = await receive();
  if (process.argv[2] === 'member-task') await memberTask(first);
  else if (process.argv[2] === 'host') await host(first);
  else throw Error('unexpected action');
} catch {
  // Assertion details may include a reusable fixture binding. Keep them off the console.
  process.exitCode = 1;
}
