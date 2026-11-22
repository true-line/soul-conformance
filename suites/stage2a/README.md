# Stage 2a host runner

The separate [independent Q observation session](qualification-session.md)
defines the source-pinned executable and A-owned wire interface for physical
Stage 2a qualification. The cooperative host fixture below does not use that
session and does not close the protected gates.

Run the cooperative caller and task-path check on the selected machine. The command starts two short-lived HQ processes in sequence using the same new private fixture directory. Before each account binds its own runtime, it tries the other account's copied runtime ID and channel binding on its own broker endpoint. HQ must refuse both copied bindings with `caller_mismatch` before any task operation, in both processes. Each account then binds its own admitted runtime and reads directives through its normal broker endpoint in both processes. The owner offers one task to the admitted Soul. The lead accepts it and the specialist proposes fixture evidence through their separate account-owned broker endpoints. After HQ restarts, both members read the retained task and redeliver their original operations over fresh bound connections. The runner compares each reply payload with its original cooperative receipt and confirms the audit store still has exactly one owner offer and one member receipt per operation. Each member binds twice per HQ process: once before the operation and again on a fresh connection to replay it. Each process produces four successful bind receipts and two refusal receipts; the report also records the cumulative counts after restart.

## Before running

On macOS, clone a stopped disposable test VM and reserve that clone exclusively until the command exits. The dedicated HQ and two non-administrative harness accounts and their Machine-provisioned directories must already exist. Only use a clone with no installed, manually started or automatically restarted HQ. Supply `--exclusive-disposable-clone` to attest these conditions. The runner checks the VirtualMac model, absence of the official LaunchDaemon plist and loaded job, an idle dedicated account, and vacant endpoint names. These checks do not lock out a concurrent service manager. Never start or install HQ, run another qualification, or release exclusive use of this clone during measurement.

On Linux, the provisioner prepares the dedicated HQ account, two harness accounts and a fresh, root-owned `/run/soul-conformance.XXXXXXXX` directory for each run (eight random alphanumerics). Put the usual HQ-owned 2750 endpoint directories with the respective private harness groups under that base. Give the calling operator a private 0700 `claim` subdirectory. Pass the base using `--linux-fixture-dir`. The runner reserves it once; an already-used base is refused. The fixture owner discards it after the run. The [hosted Linux fixture](hosted-linux.sh) demonstrates the normal setup.

Use the verified public HQ release archive for the host OS and independently obtain its source commit and SHA-256. All three accounts must be able to execute the same Node 20+ runtime. Run as a separate ordinary operator account already authorized to use noninteractive sudo to those three fixture accounts. The runner uses Python 3 for checked extraction and Git for suite provenance. Never pass a credential or an account's home as an argument.

```sh
node suites/stage2a/run.mjs \
  --archive "$HQ_ARCHIVE" --sha256 "$HQ_ARCHIVE_SHA256" --commit "$HQ_COMMIT" \
  --accounts "$FIRST_HARNESS,$SECOND_HARNESS" --exclusive-disposable-clone --out "$NEW_REPORT"
```

The example is for macOS, where HQ uses the fixed Machine IPC directory. On Linux, replace the clone flag with the prepared fixture directory option. The Linux archive supplies HQ’s reference broker fixture. The Darwin archive supplies the production broker, loaded through its digest-pinned plugin catalog. Both paths use their native account resolution, normal broker sockets, admission, keyed challenges and receipt persistence. No account lookup, UID or filesystem ownership is simulated.

For a host-only guest, add `--offline-platform`. The report records that fresh Platform main was unavailable. Otherwise the runner uses the suite's normal public Platform main lookup. Exit **1** with a new JSON file means the positive operation passed and the overall Stage 2a gate remains incomplete. Exit **2** signals a failed measurement. Choose a fresh output file for each invocation.

## Reading the result

The report identifies the local OS, archive, contracts, broker, measured allowlist digest and suite source. Runtime and account identifiers, channel bindings and raw receipt bodies are kept out of the report. Archive checks use the same verified extraction as the T21 suite. The native producer follows HQ’s reviewed two-account tests and imports its own admission fixture, broker client and proof implementation from the measured bytes.

If the shell or VM is forcibly interrupted, stop and discard that working clone and restart from the stopped snapshot. A surviving endpoint is evidence of incomplete cleanup. The runner never reclaims a pre-existing socket.

The fixture supplies enrolled-device and legacy-daemon status to the packaged HQ constructor. No cloud session, signed owner action or live key is involved. The runner does not start an installed LaunchDaemon or vendor adapter. This is cooperative owner/member protocol, copied-binding refusal, and receipt-persistence evidence; it is not a protected pass and does not qualify T01's protected refusal boundary, T02, T03 or T21. Those tests retain their full independent requirements. [HQ #56](https://github.com/true-line/agent-bot-hq/issues/56) and [Platform #68](https://github.com/true-line/agent-bot-platform/issues/68)

This fixture exercises the broker endpoints served by HQ and its pinned `agent-comms` plugin path; it does not run the legacy standalone `agent-comms broker` developer service. Product communications go through HQ, which routes to local agents or Agent Bot Harbor.

## Stage 2a release gate

`npm run stage2a:host` is a cooperative integration check. Its `T01-positive` row is deliberately separate from acceptance test T01; its output must keep `outcome: incomplete` and mark T01, T02, T03 and T21 `not-qualified`. A successful runner invocation is not a Stage 2a pass.

The current runner is scoped to an isolated disposable VM on macOS (or isolated Linux endpoints). It records `execution_scope.hq_started_soul: false`: its cooperative profile value comes from the HQ fixture, but the check does not start a Soul through the HQ Soul runner. Do not use it as the designated physical Mac acceptance run. A profile label alone does not prove managed execution.

For each acceptance result, `lib/stage2a-gate.mjs` checks the report's HQ start fields identifying `agent-bot-souls run`, the runner revision, and a matching `hq.launch` receipt (`soul_id`, `launch_id`, `argv0`, and command digest). These are report metadata checks, not authentication of the receipt or proof that HQ started the Soul. The current validator refuses every T01, T02, T03 and T21 acceptance pass until an independent runner verifies signed host evidence and the release trust chain. A direct vendor CLI/IDE/web trial can supply supporting evidence but cannot satisfy a managed gate, even if it has useful local or provider controls. Record such observations as unmanaged supporting evidence, never as `managed-protected` or `managed-cooperative`. Conversely, an unmanaged interface may still enforce its own policies; unmanaged is not a synonym for control-free or for the `managed-cooperative` profile.

Before a release can claim Stage 2a, retain separate evidence from the declared host showing:

| Gate | Required profile and observation | Current conformance support |
|---|---|---|
| T01 | `managed-protected` through an HQ-started Soul runner; transfer member A's handle to B, observe refusal before the operation, then repeat after HQ restart. | The disposable fixture observes copied-binding refusal under cooperative enforcement before and after restart. It does not exercise an HQ-started Soul or protected operation. |
| T02 | `managed-protected` through an HQ-started Soul runner; verify member file/tool refusals and the permitted device signature through Machine/keyd, administrator-side custody, absence of a signing key file, continuity across restart, and refusal during outage or revocation. Also exercise the explicitly configured standalone Secure Enclave signing exception with Machine absent, under its dedicated-account constraints. | `paired-proof.mjs` records a paired positive signing observation. Its host qualification is `not_assessed`; it is supporting evidence, not the gate. The standalone exception has no Stage 2a runner here. |
| T03 | `managed-protected` through an HQ-started Soul runner; bypass the assigned inference/service proxy and observe the host block the direct route during the protected operation. | No declared-host direct-egress acceptance runner. |
| T21 | `managed-cooperative`; use an HQ-started Soul runner, replay the protected suite, verify all receipts name cooperative, and verify protected claims return `profile_insufficient`. | Component and cooperative receipt fixtures exist; no single declared-host report currently proves the complete replay. |

Do not combine hosted jobs, disposable VMs, component fixtures, or cooperative observations into a physical protected pass. The stage remains open until the four required results identify the same declared Mac and configuration, carry the dependency and policy versions plus evidence references, and pass the platform's owner sign-off process.
