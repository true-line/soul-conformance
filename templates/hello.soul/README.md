# hello.soul

Runnable Stage 1 package with a lead and specialist on the pinned production
Soul runtime's deterministic fake adapter. It uses the real pinned HQ task
authority and a deterministic conformance broker. It needs no credentials and
makes no protected-host claim.

From the repository root:

```sh
npm run prepare:pins
npm run quickstart -- --out reports/quickstart-latest.json
```

The runner copies this template to a disposable instance, writes only the
host-specific `Contents/host/adapters.json`, starts the pinned HQ and pinned
production `agent-bot-souls` entry point, offers the seeded task, and gives the
lead one turn. The specialist changes `workspaces/scratch/answer.txt`, runs the
checked-in approved check from `Contents/opt/quickstart-check.mjs`, and submits
one proposal. The lead makes the sole final commitment. The adapter receives
the pinned runtime entry and scratch directory as ordered arguments. The
scratch directory holds the seeded issue and answer as data. The source
template is never modified.

The report identifies the exact HQ and runtime archives, platform revision,
template digest, simulated transport/wrapper, and cooperative profile in force.
