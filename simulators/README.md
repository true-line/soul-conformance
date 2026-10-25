# Simulators

Deterministic stand-ins for Stage 1. Each records every call it receives so a test can assert exactly-once intent, duplicate delivery, and ambiguous outcomes.

- `fake-adapter/` — an ACP harness that follows scripted plans; supports kill-at-step for T06, T07, T17.
- `fake-service/` — a remote service with idempotency-key, no-idempotency, and accept-then-drop-response modes.
- `fake-provider/` — an inference destination with configurable cost, latency, 5xx injection, and version string.
