"""Apply only additive proposal routes/assets, with a timestamped backup."""
from pathlib import Path
import datetime, shutil
root=Path('/var/www/portal').resolve()
src=Path('/opt/guanheng-proposals')
backup=Path('/var/backups/guanheng-proposals')/datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
backup.mkdir(parents=True)
nginx=Path('/etc/nginx/sites-enabled/guanhengsoft-ssl.conf').resolve()
for file in [root/'index.html',nginx]:shutil.copy2(file,backup/file.name)
shutil.copy2(src/'proposal.html',root/'proposal.html')
shutil.copy2(src/'proposal.js',root/'assets/js/proposal.js')
shutil.copy2(src/'proposal-api.conf','/etc/nginx/snippets/proposal-api.conf')
config=nginx.read_text()
if 'include /etc/nginx/snippets/proposal-api.conf;' not in config:
    needle='include /etc/nginx/snippets/portal-api.conf;'
    if config.count(needle)!=1:raise RuntimeError('Unexpected nginx include layout')
    nginx.write_text(config.replace(needle,needle+'\n    include /etc/nginx/snippets/proposal-api.conf;'))
home=root/'index.html'
html=home.read_text()
if 'href="proposal.html"' not in html:
    needle='<a href="products.html">产品方案</a>'
    if needle not in html:raise RuntimeError('Homepage navigation changed')
    home.write_text(html.replace(needle,needle+'\n      <a href="proposal.html">定制方案 · ¥99</a>',1))
print('backup='+str(backup))
print('site='+str(root))
