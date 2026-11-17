# hello.soul

A credential-free Stage 1 sample with one lead, one specialist, the production
`agent-bot-souls` entry point and its deterministic fake adapter. The
conformance harness supplies a pinned real HQ and deterministic broker
transport, copies this template to a scratch directory, materializes the
host-specific adapter command, offers the seeded task and verifies one proposal
and one final commitment.

From the `soul-conformance` checkout:

```sh
npm run prepare:pins
npm run quickstart -- --out reports/hello-soul-latest.json
```

The command exits zero only when the template is admitted under
`managed-cooperative`, both members start, the specialist creates one proposal,
the lead makes the sole final commitment, and the artifact exists. The report
names the exact runtime, HQ, contracts, platform policy, host and simulated
transport. It makes no protected-host claim and uses no credentials.
