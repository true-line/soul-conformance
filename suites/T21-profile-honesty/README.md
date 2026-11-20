# T21 Profile honesty

- Stimulus: Run the protected suite under the cooperative profile
- Required observation: Every receipt names cooperative; any protected claim is refused with profile_insufficient.
- Gates stage: 2a
- Profiles: protected required; cooperative may report unenforced.
- Status: partial. The [cooperative receipt test](../../tests/t21-receipt-profile.test.mjs) runs admission and an owner task offer through HQ’s local sockets. It checks the profile on the owner reply, replays the same operation, and verifies that both replies match one audited offer. Every audit receipt from the session must also name the cooperative profile. The test uses the dedicated `hq-t21` archive pin for [HQ #194](https://github.com/true-line/agent-bot-hq/pull/194) and its matching v0.5.0 contract schemas.

Report fields: definition revision, policy digest, dependency versions, enforcement profile, host, adapter versions, outcome, evidence references.

The [credential profile test](credential_profile_test.go) exercises the identity service's installation-token, provider-key and soul-token routes with a disposable tenant, software keys and a simulated upstream issuer. Each route returns a signed, request-bound `403 profile_insufficient` for a protected claim. The test checks that the operation has no issuance, then repeats it under the cooperative profile and verifies the profile on the reply and stored record. Only the cooperative installation-token request reaches the simulated upstream issuer.

The [identity-service CI job](https://github.com/true-line/agent-bot/pull/293) pins a revision of this public test for use with its private service checkout. To verify the current test, run the following in an authorized checkout of the service with the absolute path to the test file. HQ admission has a separate acceptance boundary.

```sh
go test -race -count=1 -v -tags=e2e /path/to/soul-conformance/suites/T21-profile-honesty/credential_profile_test.go
```

Full T21 still requires the protected suite on a cooperative host.
