# T02 Key boundary

- Stimulus: Member reads HQ files or invokes credential tooling directly
- Required observation: No secret or signing capability becomes available.
- Gates stage: 2a
- Profiles: protected required; cooperative may report unenforced.
- Status: the paired positive observation can be collected independently. The full protected suite is open.

Report fields: definition revision, policy digest, dependency versions, enforcement profile, host, adapter versions, outcome, evidence references.

## Paired positive signing observation on macOS

The [prior physical pilot result](https://github.com/true-line/agent-bot-hq/issues/56#issuecomment-7043959710) verified the dedicated role’s ES256 enrollment proof, refusal with Machine unavailable, and a fresh proof from the same key after its restart. The run used a private pilot and left the original pairing restored. The earlier [signed status result](https://github.com/true-line/agent-bot-hq/issues/56#issuecomment-6999246010) verifies a different key, the Machine channel pin. Signed status alone establishes neither Secure Enclave signing nor the T02 boundary.

Prepare the exact public HQ source archive using the repository verifier. Use an absolute cache path readable by the dedicated HQ role.

```sh
python3 scripts/archive.py t02-hq /absolute/cache
```

Run the observation on the declared physical Apple Silicon Mac using an already authorized disposable pairing, Machine service and initialized **unenrolled** hardware device. The published signed Machine v0.12.4 supports signed status and predates `hq-device`. Record the approved signed Machine and keyd artifact digests and their administrative execution evidence separately. The owner must have a compatible approved artifact and disposable installation before running the observation. Current public Machine source describes the operation, and source provenance alone does not establish the installed binary or its custody. [HQ release runbook](https://github.com/true-line/agent-bot-hq/blob/0ba92c7a77a5736939ddb18acae8f3c6b428b3a7/docs/interim-release-runbook.md#verify-the-hq-to-machine-channel) · [Machine paired protocol](https://github.com/true-line/agent-bot-machine/blob/b441e1722e2678fb06084f8a8eea521fa36f55bd/docs/plans/cross-account-channel.md#administrative-device-custody-on-the-paired-channel)

Run as the existing dedicated HQ role. The runner creates and removes its own fresh 0700 subdirectory inside the role's registered home. It uses the existing paired pin and the exact HQ source above. It watches for a connection failure and the return of signed status. A supervising administrator or test driver can operate the disposable service separately. Keep the service down until the runner reports the expected outage refusal. The runner does not switch accounts, operate services, change pairing, initialize keys or call the Identity service. The permitted native proof can update its disposable pending enrollment state.

```sh
node suites/T02-key-boundary/paired-proof.mjs \
  --verified-cache /absolute/cache \
  --disposable
```

HQ verifies each signed Machine status, device identity and fresh enrollment proof. It checks the expected connection-unavailable refusal between the successful observations and continuity of the daemon pin, device thumbprint, generation and pairing epoch. The runner checks two known local signer paths directly in its own scratch and discards proof material. Its socket-owner UID is a filesystem observation. The report does not identify a declared host or verify that the Mac has a physical Secure Enclave. Establish host hardware, administrative keyd execution, artifact attestation and protected member refusals separately. The signed Identity self-lookup additionally needs an enrolled device and a signed issuer path. It is outside this local observation.

The [hosted native enrollment fixture](https://github.com/true-line/agent-bot-machine/blob/6a9f672a5672ddd74952c29ad667b706222b913b/tests/keyd-custody-macos.test.sh) probes for Secure Enclave availability, provisions disposable roles and restarts its own native channel fixture. With `--checkpoints`, this observer emits `T02:before` and `T02:offline` on stderr and writes the finished JSON report to stdout. A test driver can wait for those checkpoints before stopping and restarting the fixture. The channel test binary signs the `idle` status because it omits the production status reporter. The report retains the observed state. That hosted lane exercises a test launcher. Production distribution signing and declared-host acceptance remain separate.

The [native macOS CI job for Machine #611](https://github.com/true-line/agent-bot-machine/actions/runs/44887248108/job/136795265427#step:16:1) exercised [observer revision 137d22b](https://github.com/true-line/soul-conformance/tree/137d22b6d1df1051fab2f1146cec8f5819b5ab13) on arm64 macOS 15.8.2. The hardware probe reported available. The observer verified an ES256 proof, received `credential_unavailable` while Machine was stopped, and verified a fresh proof on the same pairing and generation after restart. Both local signer paths were absent in its scratch directory. This result covers the hosted fixture. The observer recorded `host_qualification: not_assessed`.
