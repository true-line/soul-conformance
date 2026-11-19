# Paired HQ service recovery on macOS

This gate covers the one-operation owner handoff for a stopped HQ service with an existing role. It runs on Apple Silicon macOS with Go, Node 22, Python 3 and the Xcode Command Line Tools. The [macOS job](../../.github/workflows/paired-hq-recovery.yml) checks out the [reviewed component commits](../../governance/paired-hq-recovery.json). To repeat it locally, put clean checkouts named `machine`, `hq` and `identity` at those commits under one directory, then run:

```sh
python3 suites/paired-hq-recovery/run.py /path/to/checkouts
```

Machine serves its signed protocol on a private Unix socket. HQ pins the fixture Machine key, retrieves the saved plan and exports the signed challenge. Identity’s terminal review verifies the Machine identity and displays both fingerprints, the plan digest, service owner, requested action and full LaunchDaemon plist before the test answers through a pseudoterminal. Pressing Return produces no proof. HQ cancels the first challenge and exports a fresh one. Explicit confirmation signs the new challenge, HQ submits the proof, and Machine records the approved plan ID and digest. Submitting the same proof again is refused.

The fixture supplies a synthetic saved service plan, paired identities, a simulated role UID after checking the socket peer, and a stopped-service observation. The Swift fixture uses Identity’s production parser, owner-pin check and recovery transcript with a disposable software P-256 key. The physical qualification separately covers protected owner presence, account separation, the live host rebuild, and service installation.
