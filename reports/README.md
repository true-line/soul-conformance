# Reports

One report per release candidate. Required fields: definition revision, policy digest, dependency versions, enforcement profile, host, adapter versions, suite revision, per-test outcome, evidence references.

The combined runner records `implemented_checks` separately from overall `outcome` and `compatibility_policy`. An absent/unaccepted inventory at fetched platform main produces `blocked`; only accepted, hash-verified first-major policy can mark N-1 explicitly not applicable. N/A is never an executed check.

[Combined development receipt](T14/2026-11-16-consolidated-development.json) records the dirty development tree and its source hash. CI artifacts from the exact published source revision are the primary reproducible evidence; use manual workflow dispatch to re-evaluate fresh platform main without changing suite source.

The original [2026-11-15 receipt](T14/2026-11-15-soul-contracts-v0.4.1.json) is preserved as historical provenance. Its inferred N-1 N/A and overall-pass interpretation are superseded by the combined runner's explicit controlled-policy evaluation.

[Supplemental newer-cohort development receipt](T14/2026-11-16-newer-cohort-development.json) preserves the separate PR3 run, not a result from this combined runner. Its source is [721566139d80904ead93869a783173e9b7a0fa62](https://github.com/true-line/soul-conformance/tree/721566139d80904ead93869a783173e9b7a0fa62): HQ e8c3da0f / Souls 699ea4a / comms 972fcbed, with their genuine v0.5.0/v0.4.1 contract releases. The checked-in receipt names its dirty development base/source hash. The separate [clean source CI run](https://github.com/true-line/soul-conformance/actions/runs/43947002470) passed 247 implemented checks and five negative controls while reporting the policy gate blocked; its [exact report artifact](https://github.com/true-line/soul-conformance/actions/runs/43947002470/artifacts/14263509489) has published ZIP SHA-256 `7ae24622198d7ed1cbaa6213bc0cf0e897818ba3be85e294e9a0f0ff0856ec2a`. No competing runner is installed here and that report does not establish this cohort's current-policy verdict.
