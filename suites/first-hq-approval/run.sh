#!/bin/bash
# Exercise the two selected source checkouts without running a privileged installer.
set -euo pipefail
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo 'Apple Silicon macOS required' >&2; exit 2; }
if [[ $# -ne 2 ]]; then
    echo 'usage: run.sh MACHINE_CHECKOUT IDENTITY_CHECKOUT' >&2
    exit 2
fi
src=$(cd "$(dirname "$0")" && pwd -P)
machine=$(cd "$1" && pwd -P)
identity=$(cd "$2" && pwd -P)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export FIRST_HQ_IDENTITY="$identity" FIRST_HQ_PREVIEW="$src/preview.mjs" FIRST_HQ_NATIVE="$work/owner-fixture"
owner="$identity/owner-presence-macos"
xcrun --sdk macosx swiftc -target arm64-apple-macosx15.0 -swift-version 5 -parse-as-library \
    "$owner/PairingChallenge.swift" "$owner/FirstHQChallenge.swift" "$src/owner-fixture.swift" -o "$FIRST_HQ_NATIVE"
python3 - "$machine" "$src" "$work/overlay.json" <<'PY'
import json, os, sys
machine, suite, out = sys.argv[1:]
name = 'first_hq_interop_test.go'
with open(out, 'w') as f:
    json.dump({'Replace': {os.path.join(machine, 'internal', 'daemon', name): os.path.join(suite, name)}}, f)
PY
(cd "$machine" && go test -overlay "$work/overlay.json" -count=1 -run '^TestFirstHQCrossRepositoryApproval$' -v ./internal/daemon)
