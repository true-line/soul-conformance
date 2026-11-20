# First-HQ plan approval on macOS

Run the cross-repository test on Apple Silicon with the Machine and Identity
checkouts that implement the first-HQ transfer.

```sh
suites/first-hq-approval/run.sh /path/to/agent-bot-machine /path/to/agent-bot-identity
```

The **macOS first-HQ approval** Actions workflow runs the same command on a
disposable runner for pull requests and pushes to main. The two subject
commits are pinned in [the fixture manifest](../../governance/first-hq-subjects.json).

The pinned Identity checks cover the account-only review and both versions of
the service plan, including the v2 runtime directory displayed to the owner.
Machine then plans the first HQ account and exports its saved plan and challenge.
Identity's daily-account loopback interface opens the transferred file, claims
the one-time session and presents the recomputed plan for approval. The flat
owner CLI’s parser and first-HQ request form the signed bytes. An ephemeral CryptoKit software key signs
them. Identity verifies the proof and Machine consumes it. The test checks
the resulting approval and the receipt from the human apply command against
the reviewed digest. It also exercises replay, cancellation and expiry.

The fixture supplies a temporary home, clock, owner key and in-memory account
executor. Physical Secure Enclave signing, owner presence, actual service
installation and paired HQ status are tracked by the
[Mac pilot](https://github.com/true-line/agent-bot-hq/issues/56).
