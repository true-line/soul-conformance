# Changelog

## Unreleased
- Replace the `hello.soul` placeholder with a runnable, credential-free package and fail-closed quickstart evidence through the pinned production HQ and Soul runtime.
- Consolidate independent T14 work into the original harness, preserving its fixture loader, newer-peer fallback, positive capability control and implementation mutation tests.
- Verify archive hashes and every cached source byte/mode before import; enforce mandatory case inventory and exact correlated refusal/no-decision checks.
- Read platform main fresh and validate controlled compatibility policy; separate implemented evidence from the overall T14 gate, with explicit first-major N/A only under Accepted PDR-0075 inventory.
- Record actual source revision, dirty status and source hash, retain exact CI receipts, and add fail-closed integrity/policy controls.

## 0.2.0 — 2026-11-15
- T14 Version mismatch, the Stage 0 gate: fixture loader with base byte pins, pinned subjects (runtime, broker, live HQ), the T14 suite and its result record, and harness self-tests that break each rule once.
- `governance/soul-contracts.json` pins soul-contracts v0.4.1, the release its consumers use; `governance/subjects.json` pins the implementations under test by commit.
- CI runs the self-tests and T14 on every pull request and on `main`.
- First result in `reports/T14/`.

## 0.1.0 — 2026-10-24
- Initial scaffold from draft 0.3: T01–T30 suite stubs, simulator layout, hello.soul placeholder, eval harness and report layout.
