# T25 Message expiry

- Stimulus: A queued message passes its expiry while the Soul is unavailable
- Required observation: message_expired is emitted to the sender; the frame is not treated as new work later.
- Gates stage: 2b
- Profiles: protected required; cooperative may report unenforced.
- Status: not implemented.

Report fields: definition revision, policy digest, dependency versions, enforcement profile, host, adapter versions, outcome, evidence references.
