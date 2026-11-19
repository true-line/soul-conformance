"""Run the paired service handoff against three reviewed, clean checkouts on macOS."""
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
from tempfile import TemporaryDirectory

suite = Path(__file__).resolve().parent
root = suite.parents[1]
if sys.platform != 'darwin' or platform.machine() != 'arm64' or len(sys.argv) != 2:
    sys.exit('On Apple Silicon macOS, run: python3 suites/paired-hq-recovery/run.py SUBJECTS')
subjects = Path(sys.argv[1]).resolve()
pins = json.loads((root / 'governance/paired-hq-recovery.json').read_text())
for component in ('machine', 'hq', 'identity'):
    directory = subjects / component
    rev = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=directory, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=directory)
    if rev != pins[component] or dirty:
        sys.exit(f'{component} must be a clean checkout of {pins[component]}')

owner = subjects / 'identity/owner-presence-macos'
with TemporaryDirectory(prefix='hq-recovery-') as tmp:
    signer = Path(tmp) / 'fixture-owner'
    subprocess.run(['xcrun', '--sdk', 'macosx', 'swiftc', '-swift-version', '5', '-parse-as-library',
                    owner / 'PairingChallenge.swift', owner / 'FirstHQChallenge.swift', suite / 'owner.swift',
                    '-o', signer], check=True)
    name = 'hq_recovery_interop_test.go'
    overlay = Path(tmp) / 'overlay.json'
    overlay.write_text(json.dumps({'Replace': {str(subjects / 'machine/internal/daemon' / name): str(suite / name)}}))
    env = {**os.environ, 'RECOVERY_SUITE': str(suite), 'RECOVERY_SUBJECTS': str(subjects), 'RECOVERY_OWNER': str(signer)}
    subprocess.run(['go', 'test', '-race', '-count=1', '-timeout=90s', '-overlay', str(overlay),
                    '-run', '^TestPairedHQRecoveryInterop$', '-v', './internal/daemon'],
                   cwd=subjects / 'machine', env=env, check=True)
