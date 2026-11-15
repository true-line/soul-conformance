# Changelog

## 0.2.0 — 2026-11-15
- T14 Version mismatch, the Stage 0 gate: fixture loader with base byte pins, pinned subjects (runtime, broker, live HQ), the T14 suite and its result record, and harness self-tests that break each rule once.
- `governance/soul-contracts.json` pins soul-contracts v0.4.1, the release its consumers use; `governance/subjects.json` pins the implementations under test by commit.
- CI runs the self-tests and T14 on every pull request and on `main`.
- First result in `reports/T14/`.

## 0.1.0 — 2026-10-24
- Initial scaffold from draft 0.3: T01–T30 suite stubs, simulator layout, hello.soul placeholder, eval harness and report layout.
