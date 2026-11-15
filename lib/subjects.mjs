// The implementations under test, driven only through the entry points a
// peer would use: the runtime's contract boundary, the broker's codecs, and a
// live HQ over its admission socket. Each call returns a verdict
// { outcome: 'accepted', value } or { outcome: 'refused', code, message };
// nothing here decides whether that verdict is correct.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const load = (dir, rel) => import(pathToFileURL(join(dir, rel)).href);
const verdict = (fn) => {
  try { return { outcome: 'accepted', value: fn() }; } catch (error) { return { outcome: 'refused', code: error.code ?? error.name, message: error.message }; }
};

export async function openRuntime(dir, contractsDir) {
  const m = await load(dir, 'lib/contracts.mjs');
  const c = m.loadContracts({ directory: contractsDir });
  return {
    name: 'runtime',
    pin: m.CONTRACT_PIN,
    current: m.SUPPORTED_VERSIONS,
    schemas: m.SCHEMAS,
    covers: () => true,
    // Decode, then apply the runtime's own semantic gates: a frame's required
    // capabilities against the fixture's negotiated set (or exactly its own,
    // with no context), and a Hello's versions against what the runtime speaks.
    receive: (fx) => verdict(() => {
      const value = c.decode(fx.schema, fx.input_raw ?? JSON.stringify(fx.input));
      if (fx.schema === m.SCHEMAS.frame) c.frame(value, fx.context?.negotiated_capabilities ?? value.required_capabilities);
      if (fx.schema === m.SCHEMAS.hello) m.negotiateVersions(value.supported_versions, m.SUPPORTED_VERSIONS);
      return value;
    }),
    record: (schema, value) => verdict(() => c.record(schema, value)),
    frame: (value, negotiated) => verdict(() => c.frame(value, negotiated)),
    negotiate: (offered) => verdict(() => m.negotiateVersions(offered, m.SUPPORTED_VERSIONS)),
    admission: (result, hello) => verdict(() => c.admission(result, hello)),
  };
}

export async function openBroker(dir) {
  const wire = await load(dir, 'lib/contracts/wire-v1.mjs');
  const task = await load(dir, 'lib/contracts/task-v1.mjs');
  const { CONTRACT_SCHEMAS } = await load(dir, 'lib/contracts/schemas.mjs');
  const source = JSON.parse(readFileSync(join(dir, 'lib/vendor/soul-contracts/source.json'), 'utf8'));
  // A positive frame carries no context: deliver it just before its expiry
  // with exactly the capabilities it requires, as a live broker would.
  const admitFrame = (input, context = {}) => {
    const value = typeof input === 'string' ? JSON.parse(input) : input;
    return wire.admitFrame(input, {
      now: context.now === undefined ? Date.parse(value.expires_at) - 1000 : Date.parse(context.now),
      negotiatedCapabilities: context.negotiated_capabilities ?? value.required_capabilities,
    });
  };
  const codecs = {
    'wire/v1/wire-frame.schema.json': admitFrame,
    'wire/v1/directive-or-query.schema.json': (input) => wire.admitDirectiveOrQuery(input),
    'task/v1/task-record.schema.json': (input) => task.mirrorTaskRecord(input),
    'task/v1/task-commitment.schema.json': (input) => task.mirrorTaskCommitment(input),
    'task/v1/action-record.schema.json': (input) => task.mirrorActionRecord(input),
  };
  return {
    name: 'broker',
    source,
    schemas: CONTRACT_SCHEMAS,
    vendored: (path) => readFileSync(join(dir, 'lib/vendor/soul-contracts', path)),
    covers: (schema) => Object.hasOwn(codecs, schema),
    receive: (fx) => verdict(() => codecs[fx.schema](fx.input_raw ?? fx.input, fx.context)),
    frame: (value, negotiated, now = Date.parse(value.expires_at) - 1000) =>
      verdict(() => wire.admitFrame(value, { now, negotiatedCapabilities: negotiated })),
  };
}

// A real HQ (store, sockets, SDK host, admission plugin) in a fresh 0700
// directory per session. The legacy agent-bot CLI is replaced by a canned
// runner reporting an enrolled device, and the clock is fixed, so the run
// needs no installed daemon and is reproducible. No member is ever launched.
export async function openHQ(dir, contractsDir, { accepted }) {
  const { createHQ } = await load(dir, 'hq/hq.mjs');
  const { CURRENT_VERSIONS, SCHEMA_NAMES } = await load(dir, 'hq/admission.mjs');
  const { TASK_SCHEMA_NAMES, TASK_WIRE_SCHEMA_NAMES } = await load(dir, 'hq/tasks.mjs');
  const { legacyDaemon, legacySigner } = await load(dir, 'hq/legacy.mjs');
  const { connectSocket } = await load(dir, 'hq/socket.mjs');
  const schema = (contract, names) => names.map((n) => [n, JSON.parse(readFileSync(join(contractsDir, 'schemas', contract, `${n}.schema.json`), 'utf8'))]);
  const schemas = Object.fromEntries([...schema('hq/v1', SCHEMA_NAMES), ...schema('task/v1', TASK_SCHEMA_NAMES), ...schema('wire/v1', TASK_WIRE_SCHEMA_NAMES)]);
  const run = async (argv) => {
    const cmd = argv.join(' ');
    if (cmd.includes('server status')) return { code: 0, stdout: JSON.stringify({ enrolled: true, device: { device_id: 'dev-conformance' } }) };
    if (cmd.includes('daemon status')) return { code: 0, stdout: JSON.stringify({ running: true, pid: 1, version: '0.0.0', souls: [] }) };
    return { code: 127, stdout: '' };
  };
  const session = async () => {
    const home = mkdtempSync(join(tmpdir(), 'sc-hq-'));
    const clock = { now: () => Date.UTC(2026, 10, 8) };
    const hq = createHQ({
      home, schemas, clock, platform: process.platform === 'darwin' ? 'darwin' : 'linux',
      config: { acceptedDefinitions: accepted },
      enrollment: legacySigner({ run }),
      legacy: legacyDaemon({ run, supervise: false, clock }),
      launch: { spawn: () => { throw new Error('soul-conformance T14 launches no member'); } },
    });
    await hq.start();
    await hq.settled();
    const entry = await connectSocket(hq.paths.admission);
    return {
      hello: (payload) => entry.request('Hello', payload),
      admit: (requestId) => entry.request('Admit', { request_id: requestId }),
      async close() { await entry.close().catch(() => {}); await hq.stop(); rmSync(home, { recursive: true, force: true }); },
    };
  };
  return {
    name: 'hq',
    pin: JSON.parse(readFileSync(join(dir, 'governance/soul-contracts.json'), 'utf8')),
    current: CURRENT_VERSIONS,
    covers: (schema) => schema === 'hq/v1/hello.schema.json',
    // One fresh HQ per exchange, so no fixture depends on another's state.
    async exchange(fn) {
      const s = await session();
      try { return await fn(s); } finally { await s.close(); }
    },
  };
}
