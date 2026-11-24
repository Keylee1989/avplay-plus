import os, subprocess, sys
T = os.environ.get('GITHUB_TOKEN', '').strip()
if not T: sys.exit('no token')
def run(c):
    print('+', c[0]); p = subprocess.run(c, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if p.stdout.strip(): print(p.stdout.strip()[:1200])
    if p.returncode: sys.exit(p.returncode)
run(['git','add','-A'])
run(['git','commit','-q','-m','Add recommendation page, fix light-theme quickbar contrast, bump SW cache'])
url = 'https://x-access-token:%s@github.com/Keylee1989/avplay-plus.git' % T
run(['git','push','-q',url,'main'])
run(['git','remote','set-url','origin','https://github.com/Keylee1989/avplay-plus.git'])
print('pushed')
