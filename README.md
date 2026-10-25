# soul-conformance

The independent verification suite for the Soul Agent Platform: conformance tests T01–T30, the hostile-member suite, deterministic simulators, the `hello.soul` template and task, the evaluation-cell harness, and release reports. Owned by the independent reviewer (WP7), not by any implementer.

Source of record: Soul Agent Platform draft 0.3, Section 14 and Appendix D (`soul-contracts/papers/`).

## Owns

- `suites/` — one directory per test, each stating stimulus, required observation, stage gate, and report fields (`suites/TESTS.md` is the index).
- `simulators/` — deterministic fake adapter, fake service with idempotency and ambiguous-outcome modes, fake provider with cost reporting. The MVP integration environment starts here; a pilot must use real approved adapters.
- `templates/hello.soul/` — the sample Soul and its task: investigate, change one file in a scratch workspace, run checks, produce a reviewable change against the simulated service. No credentials required.
- `evals/` — the evaluation-cell harness: baseline-in-run replay, train and held-out split, regression rule, ATIF output, per-cell summary.
- `reports/` — release reports naming definition revision, policy digest, dependency versions, enforcement profile, host, and adapter versions.

## Depends on

`soul-contracts` (schemas, fixtures, error registry) at build time; the binaries under test (`managed-machine`, `agent-bot-identity`, `agent-comms`, `soul-adapters`) at test time only. Nothing depends on this repository.

## Rules

- A failing security requirement is a release blocker, never rewritten as success under the same profile name (draft 0.3, Section 13).
- No implementer changes a test or fixture to make an implementation pass; changes land through the reviewer.
- Every report is reproducible from its named versions.

## Work package

WP7 Verification — independent reviewer. Begins at WP1; delivers adversarial tests, recovery evidence, and the release report.
