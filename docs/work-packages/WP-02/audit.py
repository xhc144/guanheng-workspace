"""Audit actual ownership, source bindings, retained failures and final evidence."""
import datetime as dt
import hashlib
import json
import pathlib
import re
import socket
import subprocess
import sys

from run_command import ROOT, EVIDENCE, manifest
BASE='22aab8477eeef3cb498f3be3c739b631b295ea12'


def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT)


def main():
    round_name=sys.argv[1]
    paths=set(git('diff','--name-only','-z',BASE).decode().strip('\0').split('\0'))
    paths.update(git('ls-files','--others','--exclude-standard','-z').decode().strip('\0').split('\0'))
    paths.discard('')
    task=next(t for t in json.loads((ROOT/'tasks/queue.json').read_text()) if t['id']=='WP-02')
    findings=[]
    forbidden_suffix={'.db','.db-wal','.db-shm','.png','.jpg','.jpeg','.webp','.gif','.pdf','.pptx','.xlsx','.zip','.tar','.gz','.exe','.dll','.so','.mp4','.mp3','.woff','.ttf'}
    for path in sorted(paths):
        if not any(path==p or (p.endswith('/') and path.startswith(p)) for p in task['owns']): findings.append('not owned: '+path)
        if path.startswith('systems/project-ops/'): findings.append('MAIN touched: '+path)
        p=ROOT/path
        if p.suffix.lower() in forbidden_suffix or p.name.startswith('.env'): findings.append('forbidden artifact: '+path)
        if p.is_file():
            try: text=p.read_text(encoding='utf-8-sig')
            except UnicodeDecodeError: findings.append('not UTF-8 text: '+path); continue
            if '\0' in text: findings.append('binary data: '+path)
            if re.search(r'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{25,}|"access_token"\s*:\s*"eyJ',text): findings.append('credential-like text: '+path)
    branch=git('branch','--show-current').decode().strip()
    if branch!='wp/02-pms-bootstrap': findings.append('unexpected branch '+branch)
    if git('merge-base',BASE,'HEAD').decode().strip()!=BASE: findings.append('wrong base')
    if git('diff','--name-only',BASE,'--','tasks','systems/project-ops','reports/WP-03.md','docs/work-packages/WP-03','docs/PMS账号与配置.md').strip(): findings.append('protected inputs changed')
    modified_pms=git('diff','--name-only','-z',BASE,'--','systems/pms-suite').decode().strip('\0').split('\0')
    for path in modified_pms:
        if path.endswith(('package.json','package-lock.json','requirements.txt')): findings.append('dependency input changed: '+path)
    for path in modified_pms:
        p=ROOT/path
        if path.endswith('.ps1') and not p.read_bytes().startswith(b'\xef\xbb\xbf'): findings.append('missing Windows Unicode BOM: '+path)
        if path.endswith(('.ps1','.bat')) and re.search(r'(?i)ExecutionPolicy\s+Bypass|Set-ExecutionPolicy|taskkill|E:\\',p.read_text(encoding='utf-8-sig')): findings.append('unsafe startup command: '+path)
    # New tests use actual processes/API/files. Review of their source remains separate.
    pester=EVIDENCE/'pester-final.log'
    if not pester.exists() or 'Tests Passed: 8, Failed: 0, Skipped: 0' not in pester.read_text(): findings.append('final Pester result missing')
    runs=sorted(EVIDENCE.glob('linux-20*/linux-results.json'))
    if not runs: findings.append('Linux integration missing')
    else:
        run_path=runs[-1];result=json.loads(run_path.read_text())
        if result['failures'] or len(result['results'])!=3: findings.append('Linux integration did not pass all 3')
        binding=json.loads((run_path.parent/'linux-source-binding.json').read_text())['files']
        for path,digest in binding.items():
            if hashlib.sha256((ROOT/path).read_bytes()).hexdigest()!=digest: findings.append('source binding differs: '+path)
    boundaries=sorted(EVIDENCE.glob('boundaries-*/results.json'))
    if not boundaries or len(json.loads(boundaries[-1].read_text())['results'])!=16: findings.append('final 16-case boundary result missing')
    for edition in ('basic','deepseek','kimi'):
        data=json.loads((EVIDENCE/f'windows-{edition}-required.json').read_text())
        if data['exit_code']!=127: findings.append('unexpected Windows command outcome '+edition)
    occupied=[]
    for port in (8100,8101,8102,5180,5181,5182):
        with socket.socket() as s:
            s.settimeout(.2)
            if s.connect_ex(('127.0.0.1',port))==0: occupied.append(port)
    if occupied: findings.append('test ports remain occupied: '+str(occupied))
    # Ensure local relative report/document links resolve; preserve existing unrelated files.
    for path in ('systems/pms-suite/使用说明.md','reports/WP-02.md','docs/work-packages/WP-02/README.md'):
        p=ROOT/path
        if not p.exists(): findings.append('document missing: '+path); continue
        for link in re.findall(r'\]\(([^)]+)\)',p.read_text()):
            if '://' in link or link.startswith('#'): continue
            target=link.split('#')[0]
            if not (p.parent/target).exists(): findings.append('broken link: '+path+' -> '+target)
    subprocess.run(['git','-c','core.whitespace=cr-at-eol','diff','--check',BASE,'--','systems/pms-suite','docs/work-packages/WP-02/*.py'],cwd=ROOT,check=True)
    source=manifest()
    row={'round':round_name,'time':dt.datetime.now(dt.timezone.utc).isoformat(),'head':git('rev-parse','HEAD').decode().strip(),'base':BASE,'paths':sorted(paths),'source_manifest_sha256':hashlib.sha256(json.dumps(source,sort_keys=True).encode()).hexdigest(),'findings':findings,'occupied_test_ports':occupied,'MAIN':'pending WP23 and WP24 G1; not implemented','Windows':'not run; no powershell.exe/Windows host','retained_baseline':'WP03 Basic/Kimi 5 failures each unchanged; not rerun as WP02 fixes'}
    (EVIDENCE/f'{round_name}.json').write_text(json.dumps(row,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(row,ensure_ascii=False))
    assert not findings,findings

if __name__=='__main__': main()
