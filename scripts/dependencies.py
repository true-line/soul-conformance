"""Anonymous immutable public inputs; archive and extracted tree fail closed."""
import hashlib, json, os, sys, tarfile
from pathlib import Path, PurePosixPath
from urllib.request import urlopen, Request
ROOT = Path(__file__).resolve().parent.parent
PINS = json.loads((ROOT / 'dependencies.json').read_text())['dependencies']
CACHE = ROOT / '.cache'
def digest(data): return hashlib.sha256(data).hexdigest()
def prepare(verify_only=False):
    for name, pin in PINS.items():
        archive = CACHE / 'archives' / (name + '.tar.gz')
        destination = CACHE / 'dependencies' / name
        if not archive.exists():
            if verify_only: raise ValueError('missing archive: ' + name)
            archive.parent.mkdir(parents=True, exist_ok=True)
            with urlopen(Request(pin['url'], headers={'User-Agent': 'soul-conformance-T14'}), timeout=60) as response:
                data = response.read(64 * 1024 * 1024 + 1)
            if len(data) != pin['archiveBytes'] or digest(data) != pin['sha256']: raise ValueError('archive digest mismatch: ' + name)
            archive.write_bytes(data)
        if archive.is_symlink(): raise ValueError('archive symlink')
        data = archive.read_bytes()
        if len(data) != pin['archiveBytes'] or digest(data) != pin['sha256']: raise ValueError('archive digest mismatch: ' + name)
        if verify_only and not destination.is_dir(): raise ValueError('missing dependency: ' + name)
        expected = set()
        with tarfile.open(archive) as source:
            for member in source:
                path = PurePosixPath(member.name)
                if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()): raise ValueError('unsafe archive member')
                rel = Path(*path.parts[1:])
                target = destination / rel
                # Reject symlinks throughout the extraction ancestry.
                for parent in [target, *target.parents]:
                    if parent.is_symlink(): raise ValueError('dependency symlink')
                    if parent == ROOT: break
                if member.isdir():
                    if not verify_only: target.mkdir(parents=True, exist_ok=True)
                    continue
                expected.add(rel.as_posix())
                with source.extractfile(member) as stream: original = stream.read()
                if not target.exists() and not verify_only:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(original); target.chmod(member.mode & 0o777)
                if not target.is_file() or target.read_bytes() != original or bool(target.stat().st_mode & 0o111) != bool(member.mode & 0o111):
                    raise ValueError('extracted dependency mismatch: ' + name + '/' + str(rel))
        actual = {p.relative_to(destination).as_posix() for p in destination.rglob('*') if p.is_file() or p.is_symlink()}
        if actual != expected: raise ValueError('unexpected/missing dependency files: ' + name)
        print(name + ' verified ' + pin['commit'])
if __name__ == '__main__': prepare('--verify' in sys.argv)
