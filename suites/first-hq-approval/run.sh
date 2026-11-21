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
node --test "$identity/tests/machine-first-hq.test.mjs"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export FIRST_HQ_IDENTITY="$identity" FIRST_HQ_PREVIEW="$src/preview.mjs" FIRST_HQ_NATIVE="$work/owner-fixture"
owner="$identity/owner-presence-macos"
# Newer Identity sources share the request enum with other typed plan parsers.
# The original pinned sources need only the pairing and first-HQ parsers.
parsers=("$owner/PairingChallenge.swift" "$owner/FirstHQChallenge.swift")
for name in HarnessLaunchChallenge HarnessLaunchPlan HarnessAccountPlan HQServiceRecoveryPlan; do
    if [[ -f "$owner/$name.swift" ]]; then parsers+=("$owner/$name.swift"); fi
done
xcrun --sdk macosx swiftc -target arm64-apple-macosx15.0 -swift-version 5 -parse-as-library \
    "${parsers[@]}" "$src/owner-fixture.swift" -o "$FIRST_HQ_NATIVE"
python3 - "$machine" "$src" "$work" <<'PY'
import json, subprocess, sys
from pathlib import Path

machine, suite, work = map(Path, sys.argv[1:])
module = json.loads(subprocess.check_output(['go', 'mod', 'edit', '-json'], cwd=machine))['Module']['Path']
name = 'first_hq_interop_test.go'
source = (suite / name).read_text()
for package in ('internal/cli', 'internal/members'):
    source = source.replace(f'"MACHINE_MODULE/{package}"', json.dumps(f'{module}/{package}'))
(work / name).write_text(source)
with (work / 'overlay.json').open('w') as f:
    json.dump({'Replace': {str(machine / 'internal/daemon' / name): str(work / name)}}, f)
PY
(cd "$machine" && go test -overlay "$work/overlay.json" -count=1 -run '^TestFirstHQCrossRepositoryApproval$' -v ./internal/daemon)
