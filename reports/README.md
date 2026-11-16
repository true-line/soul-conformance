# Reports

One report per release candidate. Required fields: definition revision, policy digest, dependency versions, enforcement profile, host, adapter versions, suite revision, per-test outcome, evidence references.

T14 writes ignored `T14-latest.json` on every run. Its `outcome.implemented`
field records the mandatory executed checks; `outcome.overallT14` and
`policyBlocked` record the separate acceptance decision. Dependency archives,
source-content hash and fresh platform revision make the evidence traceable.

`T14-current-major-development.json` records the initial reviewed source-tree
run. It explicitly identifies a dirty development worktree and is not evidence
for a later commit. CI retains a newly generated report for the exact checkout.
