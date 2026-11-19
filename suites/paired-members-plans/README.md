# Paired HQ members-plan lookup

Run `node --test tests/paired-members-plans.test.mjs` on macOS with Node 22, Python 3 and Go with automatic toolchain selection. The normal `npm test` suite discovers the same test. The test verifies the public Machine and HQ archive hashes in [the archive manifest](../../governance/archives.json) before importing either subject.

The fixture starts a private Unix listener with the Machine request handler and uses HQ’s signed role client against it. It checks 64+1 pagination, an unpinned lookup, a missing plan, and byte-preserving retrieval of account, service and harness plans. The current Darwin planner emits an empty array for an HQ-only plan. Synthetic null records exercise the compatible reader and retain their distinct digests.

Both processes run as the local test user. The fixture checks the socket peer UID, supplies a simulated dedicated account through Machine’s test seam, and generates temporary role keys. Provisioning, hardware presence and cross-account installation require separate qualification.
