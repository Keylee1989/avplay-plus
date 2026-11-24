import os, json, urllib.request, urllib.error, time
T = os.environ['GITHUB_TOKEN']
H = {'Authorization':'Bearer '+T, 'Accept':'application/vnd.github+json', 'User-Agent':'check'}
def get(p):
    r = urllib.request.Request('https://api.github.com'+p, headers=H)
    try:
        with urllib.request.urlopen(r, timeout=30) as x: return x.status, json.loads(x.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
s, repo = get('/repos/Keylee1989/avplay-plus')
print('repo', s, repo.get('private'), repo.get('default_branch'), repo.get('size'))
s, pages = get('/repos/Keylee1989/avplay-plus/pages')
print('pages', s, json.dumps(pages, ensure_ascii=False)[:600])
s, tree = get('/repos/Keylee1989/avplay-plus/git/trees/main?recursive=1')
print('tree', s, len(tree.get('tree', [])), [x['path'] for x in tree.get('tree', [])[:12]])
