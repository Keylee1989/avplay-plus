"""Push the whole working tree to GitHub via the REST API in a single commit.
Avoids git transport entirely (git push kept being reset by the network).
"""
import os, sys, json, base64, urllib.request, urllib.error, time

T = os.environ.get('GITHUB_TOKEN', '').strip()
if not T: sys.exit('no token')
OWNER, REPO = 'Keylee1989', 'avplay-plus'
API = 'https://api.github.com'
H = {'Authorization': 'Bearer ' + T, 'Accept': 'application/vnd.github+json',
     'User-Agent': 'avplay-upload', 'X-GitHub-Api-Version': '2022-11-28'}
ROOT = os.path.dirname(os.path.abspath(__file__))

def req(method, path, body=None, tries=3):
    data = json.dumps(body).encode() if body is not None else None
    for i in range(tries):
        r = urllib.request.Request(API + path, data=data, headers=H, method=method)
        try:
            with urllib.request.urlopen(r, timeout=120) as x:
                raw = x.read().decode('utf-8', 'replace')
                return x.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b'{}')
        except Exception as e:
            if i == tries - 1: return 0, {'message': str(e)}
            time.sleep(2)

st, ref = req('GET', '/repos/%s/%s/git/ref/heads/main' % (OWNER, REPO))
if st != 200: sys.exit('cannot get main ref: %s' % ref)
parent = ref['object']['sha']
st, commit0 = req('GET', '/repos/%s/%s/git/commits/%s' % (OWNER, REPO, parent))
base_tree = commit0['tree']['sha']
print('parent', parent[:10], 'base_tree', base_tree[:10])

skip_dirs = {'.git', '__pycache__', '.idea', '.vscode'}
files = []
for root, dirs, names in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in skip_dirs]
    for n in names:
        p = os.path.join(root, n)
        rel = os.path.relpath(p, ROOT).replace('\\', '/')
        files.append((rel, p))
print('files', len(files))

entries = []
for rel, p in files:
    try:
        content = open(p, 'rb').read()
    except Exception as e:
        print('SKIP', rel, e); continue
    b64 = base64.b64encode(content).decode()
    st, blob = req('POST', '/repos/%s/%s/git/blobs' % (OWNER, REPO), {'content': b64, 'encoding': 'base64'})
    if st not in (200, 201):
        print('BLOB FAIL', rel, st, blob); continue
    entries.append({'path': rel, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
    print('blob', rel, len(content))

st, tree = req('POST', '/repos/%s/%s/git/trees' % (OWNER, REPO), {'base_tree': base_tree, 'tree': entries})
if st not in (200, 201): sys.exit('tree failed: %s' % tree)
st, commit = req('POST', '/repos/%s/%s/git/commits' % (OWNER, REPO), {
    'message': 'Add MikuTools member entry, ed2k helper, recommendation page, light-theme fix',
    'tree': tree['sha'], 'parents': [parent]
})
if st not in (200, 201): sys.exit('commit failed: %s' % commit)
st, upd = req('PATCH', '/repos/%s/%s/git/refs/heads/main' % (OWNER, REPO), {'sha': commit['sha'], 'force': False})
print('ref update', st, upd.get('message', '')[:200])
print('DONE https://github.com/%s/%s/commit/%s' % (OWNER, REPO, commit['sha'][:12]))
