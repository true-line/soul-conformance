# Stage 2a stock Claude Soul source candidate

This additive, **unqualified** `hello.soul` lineage supplies one deterministic
first turn for the protected Stage 2a qualification plan. The existing
`templates/hello.soul` Stage 1 fake-adapter quickstart is unchanged. This
directory is source input, not a signed `.soul` transport or a launch approval.

The frozen definition has the same Soul ID as the Stage 1 template and two
members, `m_lead` and `m_spec`, both selecting `claude-code` 0.109.0. The first
turn addresses `m_lead` only. `Contents/opt/stock-claude.json` pins the public
Darwin arm64 ACP archive, extracted executable, adjacent CLI, upstream source,
and model. Machine must independently measure the actual installed executable,
archive and host launch inputs; this declaration does not authorize them.

With an empty handoff state and a lead that has not been briefed, the Souls
entry point sends these two ACP `session/prompt` text blocks in order:

1. `Brief from the entry point. You are m_lead, the lead of agent_0b3f1e2a-7c4d-4e8f-9a1b-2c3d4e5f6a7b.\nBefore continuing, read your waiting directives and your open tasks from HQ, and reconcile anything whose outcome you do not know.\nThere are no handoff notes.`
2. The exact `objective` string from `Contents/primitives/qualification-task.json`:
   `Return the fixture response.`

The claim in `SoulLock.json` is SHA-256 over the exact bytes of
`SoulInfo.json`, `opt/stock-claude.json`, and
`primitives/qualification-task.json`, framed as
`stage2a-stock-hello-source/v1\0` followed by each sorted relative path,
NUL, decimal byte length, NUL, and file bytes. It is an opaque claimed
revision for the owner plan. The separate Machine definition measurement
must cover the closed frozen inventory, including `SoulLock.json`, paths,
modes, and directory records. A new source byte or host path requires a new
reviewed plan and a fresh preflight request digest.

The current `soul-package` frozen-hello builder accepts only the original
fake-adapter template at its pinned commit. It must gain a separately
reviewed profile for this source revision before a canonical `.soul` can be
built. Signing that transport remains held. No T01, T02, T03 or T21 result
follows from this source candidate or an exploratory stock request capture.
