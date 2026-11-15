"""Prepare only the pinned public gold, nickel and tin CSV fixtures."""
import hashlib
import json
import urllib.request
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads(Path(__file__).with_name('corpus-fixtures.json').read_text(encoding='utf-8'))
groups = {'01-emas-epitermal', '02-nikel-laterit', '03-timah-placer'}
selected = [e for e in manifest['files'] if PurePosixPath(e['path']).parts[0] in groups]
if len(selected) != 12:
    raise ValueError('Expected the twelve pinned public corpus files')
for entry in selected:
    relative = PurePosixPath(entry['path'])
    if relative.is_absolute() or '..' in relative.parts or not entry['url'].startswith('https://raw.githubusercontent.com/'):
        raise ValueError('Invalid public fixture path or URL')
    target = ROOT / 'data/dataset-demo/repo' / relative
    if target.exists():
        raw = target.read_bytes()
    else:
        with urllib.request.urlopen(entry['url'], timeout=30) as response:
            raw = response.read(16 * 1024 * 1024 + 1)
    if len(raw) > 16 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != entry['sha256']:
        raise ValueError('Public fixture checksum mismatch: ' + entry['path'])
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(raw)
    print('Verified public fixture:', relative)
