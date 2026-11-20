// Stage 1's real HQ subject. The conformance harness supplies only the
// deterministic broker transport; task authority and persistence stay in the
// pinned HQ implementation and are exercised over its public local sockets.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CACHE } from './pins.mjs';

const load = (dir, rel) => import(pathToFileURL(join(dir, rel)).href);
const schemasFrom = (contractsDir, contract, names) => names.map((name) => [
  name,
  JSON.parse(readFileSync(join(contractsDir, 'schemas', contract, `${name}.schema.json`), 'utf8')),
]);

export async function stage1Subject(dir, contractsDir, hello, { notices = false } = {}) {
  const { createHQ } = await load(dir, 'hq/hq.mjs');
  const { SCHEMA_NAMES } = await load(dir, 'hq/admission.mjs');
  const noticeSchemas = notices ? (await load(dir, 'hq/notices.mjs')).NOTICE_SCHEMA_NAMES : [];
  const { TASK_SCHEMA_NAMES, TASK_WIRE_SCHEMA_NAMES } = await load(dir, 'hq/tasks.mjs');
  const { legacyDaemon, legacySigner } = await load(dir, 'hq/legacy.mjs');
  const { connectSocket } = await load(dir, 'hq/socket.mjs');
  const { definePlugin } = await load(dir, 'sdk/plugin.mjs');
  const { fail } = await load(dir, 'sdk/errors.mjs');
  const schemas = Object.fromEntries([
    ...schemasFrom(contractsDir, 'hq/v1', [...SCHEMA_NAMES, ...noticeSchemas]),
    ...schemasFrom(contractsDir, 'task/v1', TASK_SCHEMA_NAMES),
    ...schemasFrom(contractsDir, 'wire/v1', TASK_WIRE_SCHEMA_NAMES),
  ]);

  const broker = definePlugin({
    name: 'conformance-broker', version: '1.0.0', hostApi: 1,
    requires: { 'hq-admission': '^0.1.0' },
    async init(ctx) {
      const admission = ctx.deps['hq-admission'];
      const bound = new Map();
      ctx.broker.serve({
        async accept(kind, message, { connection }) {
          if (kind === 'bind.challenge') {
            if (bound.has(connection)) fail('host.invalid_request', 'connection already bound');
            return admission.bindChallenge(message, { connection });
          }
          if (kind === 'bind') {
            if (bound.has(connection)) fail('host.invalid_request', 'connection already bound');
            const runtime = await admission.verifyBinding(message, { connection });
            bound.set(connection, runtime.runtime_id);
            return { runtime_id: runtime.runtime_id, member_id: runtime.member_id, role: runtime.role };
          }
          const runtimeId = bound.get(connection);
          if (!runtimeId) fail('caller_mismatch', 'bind before sending a task message');
          return ctx.broker.deliver(kind, message, { runtime_id: runtimeId });
        },
        closed(connection) { bound.delete(connection); admission.forgetConnection(connection); },
      });
    },
  });

  const run = async (argv) => {
    const command = argv.join(' ');
    if (command.includes('server status')) return { code: 0, stdout: JSON.stringify({ enrolled: true, device: { device_id: 'dev-stage1' } }) };
    if (command.includes('daemon status')) return { code: 0, stdout: JSON.stringify({ running: true, pid: 1, version: '0.0.0', souls: [] }) };
    return { code: 127, stdout: '' };
  };

  return {
    name: 'hq-stage1',
    async open() {
      mkdirSync(join(CACHE, 'runs'), { recursive: true });
      const work = mkdtempSync(join(CACHE, 'runs', 'stage1-'));
      const previous = process.cwd();
      process.chdir(work);
      const home = join(work, 'hq');
      const clock = { now: () => Date.UTC(2026, 10, 9) };
      let hq;
      const clients = [];
      try {
        hq = createHQ({
          home, schemas, clock,
          platform: process.platform === 'darwin' ? 'darwin' : 'linux',
          config: { acceptedDefinitions: { [hello.soul_id]: [hello.definition_digest] } },
          enrollment: legacySigner({ run }),
          legacy: legacyDaemon({ run, supervise: false, clock }),
          plugins: [broker],
          launch: { spawn: () => { throw new Error('Stage 1 conformance launches no host process'); } },
        });
        const status = await hq.start();
        await hq.settled();
        const connect = async (path) => { const client = await connectSocket(path); clients.push(client); return client; };
        const entry = await connect(hq.paths.admission);
        const owner = await connect(hq.paths.control);
        const tasks = hq.host.provided('hq-tasks');
        return {
          hqHome: home,
          profile: status.profile ?? status.hq?.profile ?? hq.core.profile,
          hello: (payload) => entry.request('Hello', payload),
          owner: (op, payload) => owner.request(op, payload),
          member: async (runtime) => {
            const client = await connect(hq.paths.broker);
            const response = await client.request('bind', { runtime_id: runtime.runtime_id, channel_binding: runtime.channel_binding });
            if (!response.ok) throw new Error(`bind refused: ${JSON.stringify(response)}`);
            return { request: (kind, payload) => client.request(kind, payload) };
          },
          peerOffer: (payload, soul) => tasks.offer(payload, { from: { kind: 'peer', soul } }),
          task: (taskId) => tasks.get(taskId),
          receipts: () => structuredClone(hq.core.receipts),
          grantRows: () => [...hq.core.tables.entries()].filter(([name]) => /grant/i.test(name)).reduce((n, [, rows]) => n + rows.size, 0),
          async close() {
            try {
              for (const client of clients) await client.close().catch(() => {});
              await hq.stop();
            } finally {
              process.chdir(previous);
              rmSync(work, { recursive: true, force: true });
            }
          },
        };
      } catch (error) {
        for (const client of clients) await client.close().catch(() => {});
        if (hq) await hq.stop().catch(() => {});
        process.chdir(previous);
        rmSync(work, { recursive: true, force: true });
        throw error;
      }
    },
  };
}
