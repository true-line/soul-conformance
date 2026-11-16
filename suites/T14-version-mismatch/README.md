# T14 Version mismatch

This independent suite exercises the current protocol majors and explicit
refusals. **The overall T14 gate remains blocked**, pending an accepted
compatibility inventory/bootstrap decision. The proposed resolution is
[platform Discussion 75](https://github.com/true-line/agent-bot-platform/discussions/75).
No flag waives that blocker.

The normative requirements remain in the platform's
[T14 registry](https://github.com/true-line/agent-bot-platform/blob/main/registry/tests.yaml)
and [R7 registry](https://github.com/true-line/agent-bot-platform/blob/main/registry/requirements.yaml).
Every execution fetches platform `main` fresh and checks the cited IDs and
linked governance/report paths. Unreachable or missing context fails the run;
the fetched SHA is report evidence, never a platform dependency pin.

## Reproduce

Node 22 or later, Python 3 and Git are sufficient; there are no npm dependencies.
From this repository's root:

```sh
npm run prepare:dependencies
npm test
npm run t14
npm run t14:gate
```

`prepare:dependencies` anonymously downloads the exact public source archives
in `dependencies.json`, verifies each SHA-256 and checks every extracted file
and executable mode. No credentials, moving component refs or schema copies
are used. All dependencies and temporary HQ state stay under ignored `.cache/`.
Preparation fails on changed cached files rather than repairing them silently.
`npm run t14` verifies the cache again, fetches current platform context, and
writes `reports/T14-latest.json`.

Exit status is 0 when **all 247 implemented checks** pass, 1 on any check,
infrastructure or mandatory-inventory failure. `t14:gate` additionally exits 2
when the implemented checks pass but the overall policy gate remains blocked.
CI names its job as current-major evidence and preserves the report; a green
job is not a T14/Stage 0 acceptance decision.

## Boundaries exercised

| Boundary | Actual code and observation |
| --- | --- |
| Shared schema/strict-JSON fixtures | HQ SDK validates the verified v0.5.0 corpus; Soul runtime validates its actual pinned v0.4.1 corpus. Schema-valid semantic-negative fixtures are separately identified as schema-only checks. Positive canonical hashes and negative fixture base hashes are verified. |
| Soul runtime to HQ admission socket | Real production client, strict codec, HQ admission, store and Unix socket negotiate `hq:1, wire:1`. The schema-valid unsupported offered-version fixture produces shared `unsupported_version`, including request correlation on the raw receiver boundary. A fresh request ID avoids confusing negotiation with replay-content checks. |
| Malformed Hello outer contract | `contract: hq/v99` violates the closed Hello schema and produces exact host `host.invalid_request`. This is deliberately distinct from the shared offered-version refusal. |
| HQ/comms broker notice boundary | Actual comms challenge/bind transport and default HQ notice consumer accept `notices-v1` peek, explicitly refuse an unknown required capability and unsupported contract, preserve correlation, and leave mailbox tables/upstream counters unchanged on refusal. |
| Production wire codecs | Soul runtime and comms accept a known wire/v1 frame and refuse an unknown required capability. Every comms-pinned wire/v1 and task/v1 fixture runs through its actual frame/directive/task-mirror codec with exact parse, shape and semantic outcomes. Comms schema rejects an unsupported `wire_version` as `bad-request`; the suite does not relabel it `unsupported_version`. |

A local enrollment fixture and empty upstream response supply prerequisites;
there is no live identity service or deployed environment. The suite asserts
HQ's actual `managed-cooperative` profile. It certifies no protected enforcement,
native harness, sealed-content implementation or production custody. No adapter
process is required for these protocol checks.

The selected comms revision exposes its wire codec but does not frame live
broker delivery yet. Codec results are not claimed as end-to-end wire/v1
framing. Hello version checks do not prove capability-intersection negotiation.
These are coverage limitations, not invented stage requirements.

## Previous-major status and evidence integrity

The selected implementations expose only hq/v1 and wire/v1. Package releases
v0.4.1 and v0.5.0 do not represent different protocol majors. No v0 or invented
v2 implementation is substituted for real N-1 interoperability. Missing
controlled inventory is reported as decision-needed, never inferred to be N/A.
Future adoption of an accepted platform inventory requires a reviewed suite
change; the present runner remains policy-blocked.

`case-inventory.json` fixes every mandatory case ID independently of execution.
Missing, duplicate, additional or unknown-outcome cases cannot pass. Negative
controls also reject permissive acceptance, generic/unrelated failures and
incorrect correlation. A failing protocol requirement remains a failure on a
cooperative host.

Reports record definition revision, policy digest, immutable dependency
revisions/archive digests, profile, host, adapter/driver version, suite Git
revision, dirty-worktree flag, source-content hash, fetched platform revision,
per-case outcomes and evidence paths. The checked-in development report is
provenance, not a clean-commit release certification.
