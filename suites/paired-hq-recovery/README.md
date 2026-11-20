# Paired HQ service recovery on macOS

This gate covers the one-operation owner handoff for a stopped HQ service with an existing role. It runs on Apple Silicon macOS with Go, Node 22, Python 3 and the Xcode Command Line Tools. The [macOS job](../../.github/workflows/paired-hq-recovery.yml) checks out the [reviewed component commits](../../governance/paired-hq-recovery.json). To repeat it locally, put clean checkouts named `machine`, `hq` and `identity` at those commits under one directory, then run:

```sh
python3 suites/paired-hq-recovery/run.py /path/to/checkouts
```

Machine serves its signed protocol on a private Unix socket. HQ pins the fixture Machine key, retrieves the saved plan and exports the signed challenge. Identity’s terminal review verifies the Machine identity and displays both fingerprints, the plan digest, service owner, requested action and full LaunchDaemon plist before the test answers through a pseudoterminal. Pressing Return produces no proof. HQ cancels the first challenge and exports a fresh one. Explicit confirmation signs the new challenge, HQ submits the proof, and Machine records the approved plan ID and digest. Submitting the same proof again is refused.

The suite retains a saved v1 repair plan. For v2 it invokes the pinned Machine planner against disposable release files and two simulated host layouts. The first needs the managed runtime directory created. The second already has the correct directory and plist and needs the stopped job started again. In both cases the test compares the complete plan displayed before the prompt with the signed plan, including the directory path, action, owner, group and mode. It also checks the full plist separately.

The Machine fixture supplies paired identities, a simulated role UID after checking the socket peer, and the stopped-service observation. The terminal uses the historical private-pilot Identity reviewer from [#1463](https://github.com/true-line/agent-bot-identity/pull/1463) directly from its pinned source. The Swift fixture checks the owner pin and signs the recovery transcript using a disposable software P-256 key. Physical owner presence, customer packaging, real role separation and applying the repair to a live LaunchDaemon require separate qualification.
