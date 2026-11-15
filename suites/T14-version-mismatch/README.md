# T14 Version mismatch

- Stimulus: Use N-1 and an unknown required capability
- Required observation: Supported version works; unsupported semantics fail explicitly.
- Gates stage: 0 (exit evidence: shared fixtures validate in runtime and broker)
- Profiles: protected required; cooperative may report unenforced.
- Status: implemented (0.2.0). `run.mjs`, logic in `lib/t14.mjs`.

Report fields: definition revision, policy digest, dependency versions, enforcement profile, host, adapter versions, outcome, evidence references.

## Run

```sh
npm run prepare:pins   # fetch and verify soul-contracts and the pinned subjects into .cache/
npm test               # harness self-tests: each breaks one rule and checks the run catches it
node suites/T14-version-mismatch/run.mjs --out reports/T14/<name>.json
```

Exit status 0 only when every gating check passes; 1 on a failed check; 2 when the run could not start. CI (`.github/workflows/t14.yml`) runs all three on every pull request and on `main`.

## Inputs

- `governance/soul-contracts.json`: the release under test, the same pin (tag, commit, `sha256-manifest-v1` digest) its consumers use. Fetched by tag, checked against the commit and the manifest; any changed, missing or extra file refuses the run.
- `governance/subjects.json`: the runtime (`agent-bot-souls`), the broker (`agent-bot-comms`) and HQ (`agent-bot-hq`), pinned by commit and fetched from their public URLs with no credential. Moving a pin is a reviewer change in this repository.

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
| `version.n-minus-1` | A peer offering only N-1 is admitted at N-1. Not applicable while every current major is 1; the report says so instead of claiming it. |
| `version.unsupported-*` | No common `hq` or `wire` version: HQ returns `unsupported_version` as a schema-valid `common/v1` refusal and records no decision; the runtime refuses such an offer and an admission that selects an unsupported version; a `wire_version: 2` frame is refused by both runtime and broker. |
| `capability.unknown` | A frame requiring an unnegotiated capability is refused with `required_capability_missing` by runtime and broker. |
| `capability.control` | The same frame is accepted once the capability is negotiated, so the refusal is semantic. |

Informational (recorded, owned by later tests): `hello.unaccepted-definition`, `hello.unsupported-profile` (T21), `hello.stale-epoch` (T15; not run, needs prior epoch state), `wire-frame.stale-expiry` (T25).

HQ runs in a fresh 0700 directory per exchange with a fixed clock and a canned stand-in for the legacy `agent-bot` CLI, so the run needs no installed daemon and launches no member.
