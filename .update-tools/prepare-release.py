#!/usr/bin/env python3
"""Stamp Firebase release metadata and local runtime URLs at deployment time."""
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

root = Path(__file__).resolve().parents[1]
version = os.environ.get('GITHUB_SHA', '')
if not re.fullmatch(r'[0-9a-f]{40}', version):
    raise SystemExit('GITHUB_SHA must identify the deployed commit')
index = root / 'index.html'
html = index.read_text(encoding='utf-8')
if html.count('__XISHAN_RELEASE__') != 2:
    raise SystemExit('Missing release metadata or updater placeholder')

def stamped(url):
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query) if k != 'v']
    query.append(('v', version))
    return urlunsplit(('', '', parts.path, urlencode(query), parts.fragment))

# Match complete local file literals only. Leave external URLs and directory bases alone.
pattern = re.compile(r'''(['"])((?:\.{1,2}/|assets/)[^'"\s]+\.(?:js|glb|gltf|json|webp|png|jpg)(?:\?[^'"\s]*)?)\1''')
paths = [root / 'auth.js', *sorted((root / 'js').rglob('*.js')), *sorted((root / 'lib').rglob('*.js')), *sorted((root / 'css').rglob('*.css'))]
for path in paths:
    text = path.read_text(encoding='utf-8')
    def replace(match):
        quote, url = match.groups()
        base = root if url.startswith('assets/') else path.parent
        target = (base / urlsplit(url).path).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            # Third-party documentation contains example paths which are not assets.
            return match.group(0)
        return quote + stamped(url) + quote
    path.write_text(pattern.sub(replace, text), encoding='utf-8')
html = html.replace('__XISHAN_RELEASE__', version)
html = html.replace('href="css/style.css"', 'href="' + stamped('css/style.css') + '"')
html = html.replace('src="auth.js"', 'src="' + stamped('auth.js') + '"')
index.write_text(html, encoding='utf-8')
(root / 'release.json').write_text(json.dumps({'version': version}) + '\n', encoding='utf-8')
print('Prepared Xishan release ' + version[:12])
