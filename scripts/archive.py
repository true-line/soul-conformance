"""Verify a public immutable archive and every extracted file before execution."""
import hashlib, json, os, sys, tarfile
from pathlib import Path, PurePosixPath
from urllib.request import Request, urlopen
ROOT = Path(__file__).resolve().parent.parent
PINS = json.loads((ROOT / 'governance/archives.json').read_text())['archives']

def prepare(name, cache, verify_only=False):
    pin = PINS[name]
    archive = cache / 'archives' / (name + '-' + pin['commit'] + '.tar.gz')
    destination = cache / 'verified' / (name + '-' + pin['commit'])
    def no_links(path):
        for part in [path, *path.parents]:
            if part.is_symlink(): raise ValueError('symlink in dependency path')
    no_links(archive); no_links(destination)
    if not archive.exists():
        if verify_only: raise ValueError('missing archive: ' + name)
        with urlopen(Request(pin['url'], headers={'User-Agent': 'soul-conformance-T14'}), timeout=60) as response:
            data = response.read(64 * 1024 * 1024 + 1)
        if len(data) != pin['archiveBytes'] or hashlib.sha256(data).hexdigest() != pin['sha256']:
            raise ValueError('archive digest mismatch: ' + name)
        archive.parent.mkdir(parents=True, exist_ok=True)
        archive.write_bytes(data)
    data = archive.read_bytes()
    if len(data) != pin['archiveBytes'] or hashlib.sha256(data).hexdigest() != pin['sha256']:
        raise ValueError('archive digest mismatch: ' + name)
    # A reused extraction is verification-only: never silently repair missing files.
    existing = destination.exists()
    if verify_only and not existing: raise ValueError('missing extracted dependency')
    expected = set()
    roots = set()
    with tarfile.open(archive) as source:
        for member in source:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
                raise ValueError('unsafe archive member')
            roots.add(path.parts[0])
            if len(roots) != 1: raise ValueError('multiple archive roots')
            rel = Path(*path.parts[1:]); target = destination / rel
            no_links(target)
            if member.isdir():
                if not existing: target.mkdir(parents=True, exist_ok=True)
                continue
            if not path.parts[1:] or rel.as_posix() in expected: raise ValueError('duplicate/invalid archive file')
            expected.add(rel.as_posix())
            with source.extractfile(member) as stream: original = stream.read()
            if not existing:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(original); target.chmod(member.mode & 0o777)
            if not target.is_file() or target.read_bytes() != original or bool(target.stat().st_mode & 0o111) != bool(member.mode & 0o111):
                raise ValueError('extracted dependency mismatch: ' + name + '/' + str(rel))
    actual = set()
    for path in destination.rglob('*'):
        no_links(path)
        if path.is_file(): actual.add(path.relative_to(destination).as_posix())
        elif not path.is_dir(): raise ValueError('non-regular extracted dependency')
    if actual != expected: raise ValueError('unexpected/missing dependency files: ' + name)
    return destination

if __name__ == '__main__':
    print(prepare(sys.argv[1], Path(sys.argv[2]).absolute(), '--verify' in sys.argv))
