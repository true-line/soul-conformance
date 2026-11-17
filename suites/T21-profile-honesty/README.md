# T21 Profile honesty

- Stimulus: Run the protected suite under the cooperative profile
- Required observation: Every receipt names cooperative; any protected claim is refused with profile_insufficient.
- Gates stage: 2a
- Profiles: protected required; cooperative may report unenforced.
- Status: partial. The [cooperative receipt test](../../tests/t21-receipt-profile.test.mjs) runs admission and an owner task offer through pinned HQ sockets and checks every HQ audit receipt from that session.

Report fields: definition revision, policy digest, dependency versions, enforcement profile, host, adapter versions, outcome, evidence references.

The [credential profile test](credential_profile_test.go) covers one protected claim at the identity service. It sends a credential request to the real device HTTP handler in a loopback harness with a simulated upstream issuer. It checks the signed `403 profile_insufficient`, verifies that the refused request created no issuance, then checks the cooperative profile on a successful issuance and its stored record. The [identity-service CI job](https://github.com/true-line/agent-bot/pull/293) runs this public test against the private service checkout. For local verification, run the following in an authorized checkout of the service with the absolute path to this file. The credential route has a separate acceptance boundary from HQ admission.

```sh
go test -race -count=1 -v -tags=e2e /path/to/soul-conformance/suites/T21-profile-honesty/credential_profile_test.go
```

Full T21 still requires the protected suite on a cooperative host.
