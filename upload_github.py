#!/usr/bin/env python3
"""Create a public GitHub repo, push the PWA, and enable GitHub Pages.
Requires env GITHUB_TOKEN (classic token with 'repo' scope, or fine-grained
Contents:write + Pages:write + Metadata:read).
"""
import os, sys, json, subprocess, urllib.request, urllib.error

TOKEN = os.environ.get('GITHUB_TOKEN', '').strip()
if not TOKEN:
    print('ERROR: GITHUB_TOKEN missing'); sys.exit(1)

REPO = os.environ.get('GH_REPO', 'avplay-plus').strip()
API = 'https://api.github.com'
HEADERS = {
    'Authorization': 'Bearer ' + TOKEN,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'avplay-upload'
}

def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode('utf-8', 'replace')
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        print('API ERROR', method, path, e.code, raw[:500])
        return e.code, {}

def run(cmd, check=True):
    print('+', ' '.join(c if 'GITHUB_TOKEN' not in c else '<token>' for c in cmd))
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if p.stdout.strip(): print(p.stdout.strip()[:1500])
    if check and p.returncode != 0: sys.exit(p.returncode)
    return p.returncode

status, user = api('GET', '/user')
if status != 200:
    print('ERROR: token invalid'); sys.exit(1)
owner = user['login']
print('owner:', owner, 'repo:', REPO)

status, repo = api('GET', '/repos/%s/%s' % (owner, REPO))
if status != 200:
    status, repo = api('POST', '/user/repos', {
        'name': REPO,
        'description': 'AvPlay+ 聚合资源 / 32 源字幕 / LTX 4310 部 · PWA',
        'public': True,
        'has_issues': False,
        'has_wiki': False,
        'auto_init': False
    })
    if status not in (200, 201):
        print('ERROR: create repo failed'); sys.exit(1)

# Make sure Pages exists (ignore errors; will report later)
remote = 'https://x-access-token:%s@github.com/%s/%s.git' % (TOKEN, owner, REPO)
run(['git', 'init', '-q'])
run(['git', 'config', 'user.email', 'avplay-plus@users.noreply.github.com'])
run(['git', 'config', 'user.name', 'AvPlay+ Builder'])
run(['git', 'add', '-A'])
run(['git', 'commit', '-q', '-m', 'AvPlay+ initial: script resources + 2 IPA resources + PWA'])
run(['git', 'branch', '-M', 'main'])
run(['git', 'remote', 'remove', 'origin'], check=False)
run(['git', 'remote', 'add', 'origin', remote])
run(['git', 'push', '-u', 'origin', 'main', '--force'])

st, pages = api('GET', '/repos/%s/%s/pages' % (owner, REPO))
if st != 200:
    st, pages = api('POST', '/repos/%s/%s/pages' % (owner, REPO), {
        'source': {'branch': 'main', 'path': '/'},
        'build_type': 'legacy'
    })
print('Pages status:', st)
print('URL: https://%s.github.io/%s/' % (owner, REPO))
