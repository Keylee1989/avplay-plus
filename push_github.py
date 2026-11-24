import os, subprocess, sys
T = os.environ.get('GITHUB_TOKEN', '').strip()
if not T: sys.exit('no token')
def run(c, check=True):
    print('+', c[0]); p = subprocess.run(c, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if p.stdout.strip(): print(p.stdout.strip()[:1200])
    if check and p.returncode: sys.exit(p.returncode)
    return p.returncode
run(['git','add','-A'])
rc = run(['git','commit','-q','-m','Add MikuTools membership entry and ed2k playback helper'], check=False)
if rc not in (0, 1): sys.exit(rc)  # 1 = nothing to commit
url = 'https://Keylee1989:%s@github.com/Keylee1989/avplay-plus.git' % T
run(['git','-c','http.proxy=','-c','https.proxy=','push','-q',url,'main'])
run(['git','remote','set-url','origin','https://github.com/Keylee1989/avplay-plus.git'])
print('pushed')
