"""Answer the real terminal prompt only after its complete plan and identity are visible."""
import errno
import hashlib
import json
import os
from pathlib import Path
import pty
import select
import subprocess
import sys
import time

node, review, transfer, fingerprint, seed, decision = sys.argv[1:]
if decision not in ('discard', 'approve'):
    sys.exit('unknown test decision')
challenge = json.loads(Path(transfer).read_text())['body']
plan = json.loads(challenge['plan_canonical'])
service = plan['steps'][1]
record = json.loads(service['content'])
expected = [
    'Repair the paired HQ service', 'Machine SHA-256 ' + fingerprint,
    'HQ SHA-256 ' + hashlib.sha256(bytes.fromhex(challenge['hq_key'])).hexdigest(),
    'Plan ' + challenge['plan_id'], 'Plan SHA-256 ' + challenge['plan_digest'],
    'Service owner ' + json.dumps(service['owner']), '"action": "' + service['action'] + '"',
    'LaunchDaemon plist\n' + record['plist'],
]
master, slave = pty.openpty()
try:
    child = subprocess.Popen([node, review, transfer, fingerprint, seed],
                             stdin=slave, stderr=slave, stdout=subprocess.PIPE)
finally:
    os.close(slave)
try:
    output = bytearray()
    answered = False
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if not select.select([master], [], [], 0.25)[0]:
            if child.poll() is not None:
                break
            continue
        try:
            data = os.read(master, 8192)
        except OSError as err:
            if err.errno == errno.EIO:
                break
            raise
        if not data:
            break
        output.extend(data)
        if len(output) > 128 * 1024:
            sys.exit('terminal review exceeded its display bound')
        if not answered and b'Type approve' in output:
            display = output.decode().replace('\r\n', '\n')
            if not all(field in display for field in expected):
                sys.exit('the terminal omitted a reviewed identity, service step, or full plist')
            os.write(master, b'approve\n' if decision == 'approve' else b'\n')
            answered = True
    if not answered or child.wait(timeout=3) != 0:
        sys.exit('the terminal review did not complete')
    sys.stdout.buffer.write(child.stdout.read())
finally:
    os.close(master)
    if child.poll() is None:
        child.kill()
    child.wait()
    child.stdout.close()
