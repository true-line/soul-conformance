# hello.soul quickstart

This runner is the Stage 1 documentation gate. It instantiates the checked-in
`templates/hello.soul` package with host-local adapter commands, starts the
pinned production HQ and Soul runtime, offers the seeded task, and gives the
lead one turn.

The result passes only when the specialist repairs the seeded scratch file and
runs its approved check, HQ records exactly one specialist proposal, the lead
makes exactly one final commitment, and every surface reports
`managed-cooperative`. The deterministic conformance broker and workspace
wrapper are named in the report. No real provider, credential, or protected
host boundary is exercised.

```sh
npm run prepare:pins
npm run quickstart -- --out reports/quickstart-latest.json
```

The evidence command refuses a dirty checkout or a drifted archive pin.
