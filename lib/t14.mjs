// T14 Version mismatch (Stage 0 gate, R7).
//   Stimulus: use N-1 and an unknown required capability.
//   Required observation: supported version works; unsupported semantics fail explicitly.
// Stage 0 exit evidence: shared fixtures validate in runtime and broker (T14),
// as a soul-conformance result. Specification: agent-bot-platform
// registry/tests.yaml (T14), read at main.
//
// Every check is gating unless marked `informational`: a refusal the fixture
// names but that belongs to another test (T15, T21, T25, ...) is recorded,
// never counted for or against T14.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { listSchemas, readJson } from './fixtures.mjs';

const HELLO = 'hq/v1/hello.schema.json';
// Semantic refusals T14 owns. Every other semantic fixture is informational here.
const T14_SEMANTIC = new Set(['negative/hello.unsupported-version.json', 'negative/wire-frame.unknown-required-capability.json']);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const brief = (v) => (v.outcome === 'accepted' ? 'accepted' : `refused ${v.code}`);
const hqVerdict = (res) => (res.ok ? { outcome: 'accepted', value: res.result } : { outcome: 'refused', code: res.refusal?.error ?? res.host_refusal?.code, refusal: res.refusal, message: res.refusal?.explanation ?? res.host_refusal?.explanation });

// What a fixture requires of one subject, given the subject's verdict.
// Returns { gating, expected, pass }.
export function judge(subject, fx, v) {
  const t14 = T14_SEMANTIC.has(fx.id);
  switch (fx.expectation) {
    case 'accept':
      // HQ answers a Hello with a new record; the run checks that the runtime accepts it.
      if (subject === 'hq') return { gating: true, expected: 'admitted; runtime accepts the admission result', pass: v.outcome === 'accepted' };
      return { gating: true, expected: 'accepted unchanged', pass: v.outcome === 'accepted' && isDeepStrictEqual(v.value, fx.input) };
    case 'parse':
      return { gating: true, expected: 'refused (strict parse)', pass: v.outcome === 'refused' };
    case 'schema': {
      // The broker is the receiver that maps a schema refusal to its typed
      // code (frame_too_large); the others only have to refuse.
      const code = subject === 'broker' ? fx.expect.error ?? 'bad-request' : null;
      return { gating: true, expected: code ? `refused ${code}` : 'refused', pass: v.outcome === 'refused' && (!code || v.code === code) };
    }
    case 'semantic':
      if (subject === 'runtime' && !t14) {
        // The runtime holds no authority or clock context: it must accept the
        // record's shape and claims nothing about its effect (roadmap, Stage 0).
        return { gating: true, expected: 'shape accepted; effect not claimed', pass: v.outcome === 'accepted' };
      }
      if (fx.id === 'negative/hello.unsupported-profile.json') {
        // Fixture note: refuse, or admit naming managed-cooperative; never a silent downgrade (R8, T21).
        const ok = (v.outcome === 'refused' && v.code === fx.expect.error) || (v.outcome === 'accepted' && v.value?.profile === 'managed-cooperative');
        return { gating: false, expected: `refused ${fx.expect.error} or admitted as managed-cooperative`, pass: ok };
      }
      return { gating: t14, expected: `refused ${fx.expect.error}`, pass: v.outcome === 'refused' && v.code === fx.expect.error };
    default:
      throw new Error(`unknown expectation ${fx.expectation}`);
  }
}

export async function runT14({ contractsDir, pin, fixtures, runtime, broker, hq }) {
  const checks = [];
  const rows = [];
  let profile;
  const check = (id, description, pass, observed, { gating = true } = {}) => {
    checks.push({ id, description, gating, result: pass ? 'pass' : 'fail', observed });
  };

  // 1. One release on every side.
  const short = (p) => ({ tag: p?.tag, commit: p?.commit, digest: p?.digest });
  check('pins.runtime', 'runtime pins the same soul-contracts release (tag, commit, manifest digest)', isDeepStrictEqual(runtime.pin, pin), short(runtime.pin));
  check('pins.hq', 'HQ pins the same soul-contracts release (tag, commit, manifest digest)', isDeepStrictEqual(hq.pin, pin), short(hq.pin));
  {
    const mismatched = Object.entries(broker.source.files).filter(([path, digest]) => {
      const vendored = broker.vendored(path);
      return sha256(vendored) !== digest || !vendored.equals(readFileSync(join(contractsDir, path)));
    }).map(([path]) => path);
    const same = broker.source.commit === pin.commit && mismatched.length === 0
      && isDeepStrictEqual(Object.keys(broker.source.files).sort(), broker.schemas.map((s) => `schemas/${s}`).sort());
    check('pins.broker', 'broker vendors the wire/v1 and task/v1 schemas byte-identical to the pinned release', same, { commit: broker.source.commit, mismatched });
  }

  // 2. Coverage: every schema has fixtures, and each seam is fully implemented.
  const schemas = listSchemas(contractsDir);
  const missing = schemas.filter((s) => !['positive', 'negative'].every((k) => fixtures.some((f) => f.schema === s && f.kind === k)));
  check('coverage.fixtures', 'every schema in the release has a positive and a negative fixture', missing.length === 0, { schemas: schemas.length, missing });
  const seamGap = schemas.filter((s) => (s.startsWith('wire/v1/') || s.startsWith('task/v1/')) && !broker.covers(s));
  check('coverage.broker', 'the broker implements every wire/v1 and task/v1 schema in the release', seamGap.length === 0, { missing: seamGap });

  // 3. Shared fixture verdicts.
  const tally = {};
  const record = async (subject, fx, run) => {
    const v = await run();
    const j = judge(subject, fx, v);
    rows.push({ subject, fixture: fx.id, expectation: fx.expectation, expected: j.expected, observed: brief(v), gating: j.gating, result: j.pass ? 'pass' : 'fail' });
    const t = (tally[subject] ??= { pass: 0, fail: 0, informational: 0 });
    if (!j.gating) t.informational += 1; else t[j.pass ? 'pass' : 'fail'] += 1;
  };
  for (const fx of fixtures) await record('runtime', fx, () => runtime.receive(fx));
  for (const fx of fixtures.filter((f) => broker.covers(f.schema))) await record('broker', fx, () => broker.receive(fx));
  for (const fx of fixtures.filter((f) => f.schema === HELLO)) {
    if (fx.id === 'negative/hello.stale-epoch.json') {
      // Needs an HQ already at epoch 5 (T15, Stage 4); a fresh HQ cannot produce it.
      rows.push({ subject: 'hq', fixture: fx.id, expectation: fx.expectation, expected: `refused ${fx.expect.error}`, observed: 'not run: needs prior epoch state (T15)', gating: false, result: 'not-run' });
      (tally.hq ??= { pass: 0, fail: 0, informational: 0 }).informational += 1;
      continue;
    }
    await record('hq', fx, () => hq.exchange(async (s) => {
      const v = hqVerdict(await s.hello(fx.input));
      // An admission result is only conforming if the other side accepts it.
      if (v.outcome === 'accepted') {
        const shape = runtime.record(runtime.schemas.admission, v.value);
        const agreed = runtime.admission(v.value, fx.input);
        if (shape.outcome !== 'accepted' || agreed.outcome !== 'accepted') return { outcome: 'refused', code: `runtime-rejects-admission:${shape.code ?? agreed.code}` };
        return v;
      }
      return v;
    }));
  }
  for (const [subject, t] of Object.entries(tally)) {
    const fails = rows.filter((r) => r.subject === subject && r.gating && r.result === 'fail').map((r) => r.fixture);
    check(`fixtures.${subject}`, `every shared ${subject === 'hq' ? 'hq/v1 Hello ' : subject === 'broker' ? 'wire/v1 and task/v1 ' : ''}fixture gets the verdict it pins`, fails.length === 0,
      { verdicts: t.pass + t.fail, failed: fails, informational: t.informational });
  }

  // 4. Versions. N works, a peer that also speaks N+1 lands on N, and an
  // offer with no common version is refused with a typed refusal.
  const base = readJson(contractsDir, 'fixtures/positive/hello.first-start.json').input;
  const refusalSchema = 'common/v1/error-response.schema.json';
  const hello = (request_id, supported_versions) => ({ ...base, request_id, supported_versions });
  const admitted = async (request) => hq.exchange(async (s) => {
    const res = await s.hello(request);
    if (!res.ok) return { ok: false, observed: hqVerdict(res) };
    return { ok: true, negotiated: res.result.negotiated_versions, profile: res.result.profile, runtime: runtime.admission(res.result, request) };
  });
  {
    const r = await admitted(hello('req_t14_current', { hq: [1], wire: [1] }));
    check('version.current', 'HQ admits a Hello offering N (hq 1, wire 1) and the runtime accepts the admission',
      r.ok && isDeepStrictEqual(r.negotiated, { hq: 1, wire: 1 }) && r.runtime.outcome === 'accepted', r.ok ? { negotiated: r.negotiated, runtime: brief(r.runtime) } : brief(r.observed));
    profile = r.profile;
  }
  {
    const r = await admitted(hello('req_t14_newer_peer', { hq: [2, 1], wire: [2, 1] }));
    const rt = runtime.negotiate({ hq: [2, 1], wire: [2, 1] });
    check('version.newer-peer', 'a peer offering N+1 and N negotiates N on HQ and on the runtime',
      r.ok && isDeepStrictEqual(r.negotiated, { hq: 1, wire: 1 }) && r.runtime.outcome === 'accepted' && rt.outcome === 'accepted' && isDeepStrictEqual(rt.value, { hq: 1, wire: 1 }),
      { hq: r.ok ? r.negotiated : brief(r.observed), runtime: rt.outcome === 'accepted' ? rt.value : brief(rt) });
  }
  // N-1: exercised only where a contract's current major is above 1.
  {
    const majors = { hq: hq.current, runtime: runtime.current };
    const above = Object.entries(hq.current).filter(([, n]) => n > 1);
    if (above.length === 0) {
      check('version.n-minus-1', 'N-1 is negotiated where N > 1', true, { applicable: false, reason: 'current major is 1 for every contract; there is no N-1 yet', majors });
    } else {
      const offer = Object.fromEntries(Object.entries(hq.current).filter(([c]) => c !== 'task').map(([c, n]) => [c, [n > 1 ? n - 1 : n]]));
      const r = await admitted(hello('req_t14_n_minus_1', offer));
      const want = Object.fromEntries(Object.entries(offer).map(([c, [v]]) => [c, v]));
      check('version.n-minus-1', 'a peer offering only N-1 is admitted at N-1', r.ok && isDeepStrictEqual(r.negotiated, want), { applicable: true, offer, observed: r.ok ? r.negotiated : brief(r.observed), majors });
    }
  }
  for (const [id, offer] of [['hq', { hq: [2], wire: [1] }], ['wire', { hq: [1], wire: [3, 2] }]]) {
    const requestId = `req_t14_unsupported_${id}`;
    const observed = await hq.exchange(async (s) => {
      const res = await s.hello(hello(requestId, offer));
      const after = await s.admit(requestId);
      return { res, after };
    });
    const v = hqVerdict(observed.res);
    const typed = v.refusal ? runtime.record(refusalSchema, v.refusal) : { outcome: 'refused', code: 'no-refusal-record' };
    check(`version.unsupported-${id}`, `HQ refuses a Hello with no common ${id} version: unsupported_version, a schema-valid refusal, and no decision recorded`,
      v.outcome === 'refused' && v.code === 'unsupported_version' && typed.outcome === 'accepted' && observed.after.ok === false,
      { offer, verdict: brief(v), refusal_schema: brief(typed), admit_after: observed.after.ok ? 'decision returned' : 'no decision' });
  }
  {
    const offered = runtime.negotiate({ hq: [3], wire: [3] });
    const result = readJson(contractsDir, 'fixtures/positive/admission-result.ok.json').input;
    const picked = runtime.admission({ ...result, negotiated_versions: { hq: 2, wire: 1 } }, base);
    check('version.unsupported-runtime', 'the runtime refuses an offer it cannot speak and an admission that selects an unsupported version',
      offered.outcome === 'refused' && offered.code === 'unsupported_version' && picked.outcome === 'refused' && picked.code === 'unsupported_version',
      { offer: brief(offered), admission: brief(picked) });
  }
  {
    const positive = readJson(contractsDir, 'fixtures/positive/wire-frame.notify-unsealed.json').input;
    const v2 = { ...positive, wire_version: 2 };
    const rt = runtime.frame(v2, []);
    const br = broker.frame(v2, []);
    check('version.frame', 'a wire/v1 frame claiming wire_version 2 is refused by the runtime and the broker', rt.outcome === 'refused' && br.outcome === 'refused', { runtime: brief(rt), broker: brief(br) });
  }

  // 5. Unknown required capability, with the negotiated control.
  {
    const fx = readJson(contractsDir, 'fixtures/negative/wire-frame.unknown-required-capability.json');
    const negotiated = fx.context.negotiated_capabilities;
    const rt = runtime.frame(fx.input, negotiated);
    const br = broker.frame(fx.input, negotiated);
    check('capability.unknown', `a frame requiring ${fx.input.required_capabilities.join(', ')} (not negotiated) is refused with ${fx.expect.error} by the runtime and the broker`,
      rt.code === fx.expect.error && br.code === fx.expect.error && rt.outcome === 'refused' && br.outcome === 'refused', { runtime: brief(rt), broker: brief(br), negotiated });
    const both = [...new Set([...negotiated, ...fx.input.required_capabilities])];
    const rtOk = runtime.frame(fx.input, both);
    const brOk = broker.frame(fx.input, both);
    check('capability.control', 'the same frame is accepted once its capability is negotiated, so the refusal is semantic, not a schema failure',
      rtOk.outcome === 'accepted' && brOk.outcome === 'accepted', { runtime: brief(rtOk), broker: brief(brOk), negotiated: both });
  }

  const gating = checks.filter((c) => c.gating);
  return {
    outcome: gating.every((c) => c.result === 'pass') ? 'pass' : 'fail',
    profile,
    checks,
    fixtures: rows,
    totals: {
      checks: checks.length,
      checks_failed: gating.filter((c) => c.result === 'fail').length,
      fixture_verdicts: rows.filter((r) => r.gating).length,
      fixture_verdicts_failed: rows.filter((r) => r.gating && r.result === 'fail').length,
      informational: rows.filter((r) => !r.gating).length,
    },
  };
}
