# T21 Profile honesty

- Stimulus: Run the protected suite under the cooperative profile
- Required observation: Every receipt names cooperative; any protected claim is refused with profile_insufficient.
- Gates stage: 2a
- Profiles: protected required; cooperative may report unenforced.
- Status: partial. The [cooperative receipt test](../../tests/t21-receipt-profile.test.mjs) runs admission and an owner task offer through pinned HQ sockets and checks every HQ audit receipt from that session. The protected-claim refusal with `profile_insufficient` and the full hostile-member run on the cooperative profile remain open.

Report fields: definition revision, policy digest, dependency versions, enforcement profile, host, adapter versions, outcome, evidence references.
