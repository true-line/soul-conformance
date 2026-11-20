# T21 Profile honesty

- Stimulus: Run the protected suite under the cooperative profile
- Required observation: Every receipt names cooperative; any protected claim is refused with profile_insufficient.
- Gates stage: 2a
- Profiles: protected required; cooperative may report unenforced.
- Status: partial. The [cooperative receipt test](../../tests/t21-receipt-profile.test.mjs) runs admission and an owner task offer through HQ’s local sockets. It checks the profile on the owner reply, replays the same operation, and verifies that both replies match one audited offer. A bound lead then accepts the task and a bound specialist proposes a result. Each member redelivers its operation on a second bound connection. The test checks the cooperative profile on each original and replayed reply, matches it to a single persisted audit record, and checks the profile on every receipt saved during the session. The test uses the dedicated `hq-t21` archive pin for [HQ #194](https://github.com/true-line/agent-bot-hq/pull/194) and its matching v0.5.0 contract schemas.

The test also submits the pinned `hello.unsupported-profile` fixture through
the admission socket. A protected *preference* in Hello may produce either
`profile_insufficient` or an explicitly warned cooperative admission. The test
checks the persisted decision in both cases and replays a granted admission to
verify that its warning and cooperative profile survive redelivery. The
credential test below separately exercises a mandatory protected claim.

On macOS the same test can also exercise an approved Darwin interim archive.
Supply the archive's independently known SHA-256 and HQ source commit. The
fixture verifies the archive before importing its HQ modules, loads the
production-pinned broker and checks a normal keyed bind on a local socket.
The enrolled device-status fixture keeps this check independent of live
signing, enrollment and the installed service.

```sh
SOUL_T21_HQ_TAR="$archive" SOUL_T21_HQ_SHA256="$archive_sha256" SOUL_T21_HQ_COMMIT="$hq_commit" \
  node --test tests/t21-receipt-profile.test.mjs
```

Report fields: definition revision, policy digest, dependency versions, enforcement profile, host, adapter versions, outcome, evidence references.

The [credential profile test](credential_profile_test.go) exercises the identity service's installation-token, provider-key and soul-token routes with a disposable tenant, software keys and a simulated upstream issuer. Each route returns a signed, request-bound `403 profile_insufficient` for a protected claim. The test checks that the operation has no issuance, then repeats it under the cooperative profile and verifies the profile on the reply and stored record. Only the cooperative installation-token request reaches the simulated upstream issuer.

The [identity-service CI job](https://github.com/true-line/agent-bot/pull/293) pins a revision of this public test for use with its private service checkout. To verify the current test, run the following in an authorized checkout of the service with the absolute path to the test file. HQ admission has a separate acceptance boundary.

```sh
go test -race -count=1 -v -tags=e2e /path/to/soul-conformance/suites/T21-profile-honesty/credential_profile_test.go
```

Full T21 still requires the protected suite on a cooperative host.
