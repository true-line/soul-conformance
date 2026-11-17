# T05 Duplicate message

- Stimulus: Deliver an identical frame repeatedly
- Required observation: One committed task transition; stable prior receipt returned.
- Gates stage: 1
- Profiles: per the [platform test strategy](https://github.com/true-line/agent-bot-platform/blob/main/docs/07-verification/test-strategy.md), cooperative must pass this semantic deduplication gate and makes no protected-host claim.
- Status: implemented by `../stage1/run.mjs` against the pinned real HQ broker and task service.

Report fields: definition revision, policy digest, dependency versions, enforcement profile, host, adapter versions, outcome, evidence references.
