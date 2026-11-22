# Stage 2a independent Q observation session

`qualification-runner.mjs` is the source-pinned, one-shot Q executable for the
Machine A qualification issuer. It collects bounded read-only host observations.
It never starts HQ, owns an ACP or owner socket, issues a reservation, signs a
report, or decides that T01, T02, T03 or T21 passed. A's separate issuer and
the physical driver must produce and corroborate the release, live start,
stimuli, refusals and receipts before any positive qualification report.

## Installed boundary

A creates an A-owned private session directory and a fresh one-use Unix
listener. The installation plan pins the actual dedicated nonadmin Q UID/GID,
the absolute Node executable and its digest, this single source file and its
digest, `/bin/ps` and its digest, and the directory/socket modes or ACLs. A
spawns exactly `node qualification-runner.mjs --connect <socket>` under Q and
accepts one fresh connection. Before `begin`, A checks the kernel peer PID and
UID, live primary GID, exact child executable/argv/source hashes and one-use
socket custody. A must close the listener after the first accept and fail on a
wrong first peer or second connection. Q must not gain A, R, B or HQ owner
group membership or direct access to their sockets. A confirms these facts on
the installed host; this repository cannot certify them by inspection.

The connection carries 4-byte big-endian length followed by 1–65536 bytes of
canonical ASCII JSON. Object keys are recursively sorted by code point;
strings use JSON escaping, numbers are safe integers, and no duplicate keys,
floats, unknown fields, invalid UTF-8, extra whitespace or non-ASCII values are
accepted. `sha256:` values use lowercase hex. The protocol schema is
`soul-conformance/qualification-session/v1`. A retains the exact request,
response, heartbeat, refusal and finish frame bytes/hashes; Q's transcript
digest alone cannot establish completeness.

`begin` has exactly `schema,kind,session_id,challenge_base64url,cohort_id,
installation_id,soul_id,start_id,host_id,profile,reservation_sha256,
test_plan_sha256,suite_revision,q_uid,q_gid,deadline_at,path_roots,ps_sha256`.
`session_id` is 32 lowercase hex; challenge is 32 random bytes as unpadded
base64url; profile is `managed-protected` or `managed-cooperative`; deadline is
UTC RFC 3339, at most one hour ahead. `path_roots` is 1–16 absolute, canonical,
owner-reviewed directory paths, each at most 512 ASCII characters. A derives
them from the signed test plan. Q verifies its UID/GID, the `/bin/ps` digest,
root existence and the deadline. Q's `ready` response has exactly `schema,
kind,session_id,challenge_sha256,sequence:0,pid,uid,gid,source_sha256,
captured_at`. `source_sha256` and self-reported identity are corroborative only;
A measures the actual installed files and peer independently.

After `ready`, A sends `observe`, `heartbeat`, or `finish` with strictly
increasing `sequence` 1–1024 and the same session ID. `observe` has exactly
`schema,kind,session_id,sequence,gate,phase,event_id,processes,paths`, with
optional `stimulus_ref:{uri,sha256}`. Gate is T01/T02/T03/T21; phase and event
ID are lowercase bounded tokens. Up to 16 process entries `{role,pid}` and 32
path entries `{role,path}` are allowed. Q runs the pinned `/bin/ps` only with
`-p <PID> -o pid= -o uid= -o gid= -o comm=` under a clean environment, never
captures command-line arguments or file contents, and uses `lstat` only for
paths within reviewed roots after checking each real parent for symlink
escape. A parent removed during cleanup yields a bounded absent observation.
`ENOENT`/`ENOTDIR` mean `exists:false`; `EACCES`/`EPERM` mean
`exists:null` (unobservable), never cleanup proof. A independently refuses a
positive cleanup claim on an unobservable path.
The response is `observation` with session/challenge/sequence,
`request_sha256` over the canonical `observe` JSON payload bytes, timestamp,
gate/phase/event ID, and raw bounded process and path metadata. A schedules
the expected gates/phases/events, authenticates ACP capture separately, and
independently corroborates host state. `stimulus_ref` is not authoritative by
itself.

`heartbeat` has only the four common request fields; Q echoes the same fields
plus challenge hash and capture time. `finish` has the same four request fields;
Q replies with exactly `schema,kind:"finished",session_id,challenge_sha256,
sequence,observation_count,observations_sha256,captured_at`. The latter hash
covers the concatenated exact 4-byte-length-plus-JSON `observation` frames.
The first frame must arrive within 10 seconds; later frames within 60 seconds;
the whole session must meet its deadline. There can be at most 128
observations. Error, malformed frame, timeout, EOF or child exit before
`finished` is a failed session, with no completed signed evidence. Distinct
protected/cooperative starts and an HQ restart each need their own
reservation, start, session and challenge; a reviewed cohort can link them.

The physical driver owns the real HQ start and ACP stimuli. A owns the
authenticated host and receipt joins, durable evidence bundle, signature and
verdict. Until A authenticates driver/HQ/Comms/Machine/keyd/provider receipts
and the designated physical host proves each gate, protected launch and
T01–T03/T21 remain open.
