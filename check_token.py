import os, json, urllib.request, urllib.error
T = os.environ.get('GITHUB_TOKEN','').strip()
H = {'Authorization':'Bearer '+T, 'Accept':'application/vnd.github+json', 'User-Agent':'check'}
for path in ['/user', '/repos/Keylee1989/avplay-plus']:
    r = urllib.request.Request('https://api.github.com'+path, headers=H)
    try:
        with urllib.request.urlopen(r, timeout=30) as x:
            d = json.loads(x.read() or b'{}')
            print(path, x.status, d.get('login') or d.get('full_name'), 'private=', d.get('private'), 'push=', (d.get('permissions') or {}).get('push'))
    except urllib.error.HTTPError as e:
        print(path, e.code, e.read()[:300])
