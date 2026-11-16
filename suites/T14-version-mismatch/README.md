# T14 Version mismatch

- Stimulus: Use N-1 and an unknown required capability
- Required observation: Supported version works; unsupported semantics fail explicitly.
- Gates stage: 0 (exit evidence: shared fixtures validate in runtime and broker)
- Profile scope: observed fixture HQ admission only; no protected enforcement claim. Semantic refusals remain mandatory.
- Status: current-major implementation with a separately evaluated controlled compatibility policy. `run.mjs`, logic in `lib/t14.mjs`.

Report fields: definition revision, policy digest, dependency versions, enforcement profile, host, adapter versions, outcome, evidence references.

## Run

```sh
npm run prepare:pins   # fetch and verify soul-contracts and the pinned subjects into .cache/
npm test               # harness self-tests: each breaks one rule and checks the run catches it
node suites/T14-version-mismatch/run.mjs --out reports/T14/<name>.json
```

Evidence mode exits 0 when every implemented check passes, even if the report says `outcome: blocked`; 1 means an implemented check failed, and 2 means the run could not start. Add `--gate` (or run `npm run t14:gate`) to also exit 2 while compatibility policy is blocked. CI retains the exact report on pull requests, `main`, and manual `workflow_dispatch` reruns. Rerunning unchanged source reads fresh platform main.

## Inputs

- `governance/soul-contracts.json`: the release under test, the same pin (tag, commit, `sha256-manifest-v1` digest) its consumers use. The immutable archive is checked against `governance/archives.json`; the released contract manifest is also checked. Any changed, missing or extra contract file refuses the run.
- `governance/archives.json`: reviewed SHA-256 and byte length for each public codeload archive. Every archive and extracted regular-file byte/executable mode is reverified before imports, including cached runs. Extra files and symlinks fail; missing cached files are not silently repaired.
- `governance/subjects.json`: the runtime (`agent-bot-souls`), the broker (`agent-bot-comms`) and HQ (`agent-bot-hq`), pinned by commit and fetched from their public URLs with no credential. Moving a pin is a reviewer change in this repository. This preserves the original v0.4.1 cohort (HQ `f3c39d2`, Souls `c5a858d`, comms `972fcbe`); it does not claim to test the newer HQ13 live-pilot candidate.
- `governance/t14-fixture-inventory.json`: independent mandatory fixture IDs. The result validator rejects missing, duplicate, unexpected or ungated cases and unknown outcomes.
- Fresh platform main: T14, R7, PDR-0020 and required report/authority paths must resolve. If the compatibility inventory is absent or Proposed, the overall result is blocked. Accepted `registry/protocol-compatibility.json` must name Accepted PDR-0075 and immutable source evidence whose hashes verify. Invalid or contradictory evidence fails closed.

## What it checks

Gating:

| Check | Observation |
|---|---|
| `pins.*` | Runtime and HQ pin the identical release; the broker's vendored `wire/v1` and `task/v1` schemas are byte-identical to it. |
| `coverage.*` | Every schema in the release has a positive and a negative fixture; the broker implements every `wire/v1` and `task/v1` schema. |
| `fixtures.runtime` | Every fixture through the runtime's contract boundary: positives accepted unchanged, parse and schema negatives refused, the two T14 semantic negatives refused with their codes, other semantic negatives accepted as shape only (the runtime holds no authority or clock context). |
| `fixtures.broker` | Every `wire/v1` and `task/v1` fixture through the broker's codecs, with the typed code the fixture names (`frame_too_large`, `required_capability_missing`, otherwise `bad-request`). |
| `fixtures.hq` | Every `hq/v1` Hello fixture against a live HQ admission socket: positives admitted with a result the runtime accepts, schema negatives refused before any decision, `hello.unsupported-version` refused with `unsupported_version`. |
| `version.current` | A Hello offering N is admitted at N and the runtime accepts the admission. |
| `version.newer-peer` | A peer offering N+1 and N negotiates N on HQ and on the runtime. |
| `version.n-minus-1` | Policy row, never counted as executed: only verified Accepted PDR-0075 inventory with current/first major 1 and previous supported major null permits explicit N/A. Missing policy remains blocked; a future previous-major cohort requires new reviewed tests. |
| `version.unsupported-*` | No common `hq` or `wire` version: HQ returns `unsupported_version` as a schema-valid `common/v1` refusal and records no decision (exact correlated refusal, expected Admit refusal, unchanged expanded-row store digest); the runtime refuses such an offer and an admission that selects an unsupported version; a `wire_version: 2` frame is refused by both runtime and broker. |
| `capability.unknown` | A frame requiring an unnegotiated capability is refused with `required_capability_missing` by runtime and broker. |
| `capability.control` | The same frame is accepted once the capability is negotiated, so the refusal is semantic. |

Informational (recorded, owned by later tests): `hello.unaccepted-definition`, `hello.unsupported-profile` (T21), `hello.stale-epoch` (T15; not run, needs prior epoch state), `wire-frame.stale-expiry` (T25).

HQ runs in a fresh 0700 directory per exchange with a fixed clock and a canned stand-in for the legacy `agent-bot` CLI, so the run needs no installed daemon and launches no member.

The comms corpus exercises production codecs; live wire/v1 transport framing is not implemented in that candidate and is not claimed here. Capability context is supplied to the codec; HQ Hello does not negotiate that capability intersection. Package releases v0.4.1/v0.5.0 are not protocol majors. Task/v1 is a record schema. Passing T14 for this cohort does not declare Stage 0 exit.
