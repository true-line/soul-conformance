# Stage 2a host runner

Run the positive cooperative caller and task-path check on the selected machine. The command starts two short-lived HQ processes in sequence using the same new private fixture directory. Each account binds its own admitted runtime and reads directives through its normal broker endpoint in both processes. The owner offers one task to the admitted Soul. The lead accepts it and the specialist proposes fixture evidence through their separate account-owned broker endpoints. After HQ restarts, both members read the retained task and redeliver their original operations over fresh bound connections. The runner compares each reply payload with its original cooperative receipt and confirms the audit store still has exactly one owner offer and one member receipt per operation. Each member binds twice per HQ process: once before the operation and again on a fresh connection to replay it. The bind log contains four receipts after the first process and eight after the restart, two per account per process.

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

The fixture supplies enrolled-device and legacy-daemon status to the packaged HQ constructor. No cloud session, signed owner action or live key is involved. The runner does not start an installed LaunchDaemon or vendor adapter. This is positive cooperative owner/member protocol and receipt-persistence evidence; it is not a protected pass and does not qualify T01's refusal boundary, T02, T03 or T21. Those tests retain their full independent requirements. [HQ #56](https://github.com/true-line/agent-bot-hq/issues/56) and [Platform #68](https://github.com/true-line/agent-bot-platform/issues/68)
