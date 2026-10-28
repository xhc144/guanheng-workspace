"""Additional real startup entrypoint and failure tests in synthetic workspaces."""
import hashlib
import json
import os
import pathlib
import shutil
import signal
import sqlite3
import subprocess
import tempfile
import time

import verify_linux as live
from run_command import EVIDENCE, ROOT, run

STAMP=time.strftime('%Y%m%d-%H%M%S',time.gmtime())
OUT=EVIDENCE/('boundaries-'+STAMP)
OUT.mkdir(parents=True)
live.EVIDENCE=OUT
PWSH=live.PWSH
RESULTS=[]


def execute(label, command, env=None):
    result=subprocess.run(command,cwd='/tmp',env=env or live.clean_environment(),capture_output=True,timeout=180)
    output=(result.stdout+result.stderr).decode(errors='replace')
    (OUT/(label+'.log')).write_text(output)
    RESULTS.append({'case':label,'cwd':'/tmp','command':command,'exit_code':result.returncode})
    return result.returncode,output


def command(suite,edition,*extra):
    return [PWSH,'-NoProfile','-File',str(suite/'start-helper.ps1'),'-Edition',edition,'-NoBrowser','-NoPopup',*extra]


def snapshot(database):
    with sqlite3.connect(database) as db:
        data=list(db.iterdump())
    return hashlib.sha256('\n'.join(data).encode()).hexdigest()


def sync_scripts(suite):
    paths=subprocess.check_output(['git','diff','--name-only','-z','22aab8477eeef3cb498f3be3c739b631b295ea12','--','systems/pms-suite'],cwd=ROOT).decode().strip('\0').split('\0')
    paths+=['systems/pms-suite/tests/bootstrap.Tests.ps1']
    bindings={}
    for path in paths:
        if not path.endswith(('.ps1','.bat')): continue
        source=ROOT/path
        destination=suite/source.relative_to(ROOT/'systems/pms-suite')
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,destination)
        bindings[path]=hashlib.sha256(destination.read_bytes()).hexdigest()
    (OUT/'script-binding.json').write_text(json.dumps(bindings,ensure_ascii=False,indent=2))


def main():
    previous=sorted(EVIDENCE.glob('linux-20*/linux-results.json'))
    candidates=[json.loads(p.read_text()) for p in previous]
    previous=next(p for p in reversed(candidates) if not p['failures'])
    suite=pathlib.Path(previous['fixture'])
    assert suite.is_dir()
    assert not any(live.is_open(p) for p in (8100,8101,8102,5180,5181,5182))
    sync_scripts(suite)
    # Verify/WhatIf must leave the complete existing database untouched.
    for edition,name,bp,fp,prefix in live.EDITIONS:
        database=suite/name/'backend/.demo/demo.db'
        before=snapshot(database)
        script={'Basic':suite/name/'scripts/reset-demo.ps1','DeepSeek':suite/name/'reset-demo.ps1','Kimi':suite/name/'demo.ps1'}[edition]
        extra=['-WhatIf'] if edition=='Basic' else ['-Action','Reset','-WhatIf']
        code,text=execute(edition+'-reset-whatif',[PWSH,'-NoProfile','-File',str(script),*extra])
        assert code==0 and 'What if' in text, text
        assert snapshot(database)==before
        if edition=='Kimi':
            code,text=execute('Kimi-prepare-existing',[PWSH,'-NoProfile','-File',str(script)])
            assert code==0 and 'Verified controlled' in text,text
            assert snapshot(database)==before
            code,text=execute('Kimi-start-reset-refused',[PWSH,'-NoProfile','-File',str(suite/name/'start.ps1'),'-ResetDemo','-NoBrowser','-NoPopup'])
            assert code!=0 and '启动入口不重置' in text,text
            assert snapshot(database)==before
        RESULTS[-1]['database_preserved']=True
    # Real missing-node discovery: Python's real executable directory contains no Node/npm.
    env=live.clean_environment()
    env['PATH']=str(pathlib.Path(shutil.which('python3')).parent)
    code,text=execute('missing-node',command(suite,'Basic'),env)
    assert code==1 and '未找到 Node.js' in text,text
    # Normal npm ci repairs a real damaged node_modules directory.
    front=suite/'基础版/frontend'
    vite=front/'node_modules/vite/bin/vite.js'
    assert vite.is_file()
    vite.unlink()
    database=suite/'基础版/backend/.demo/demo.db'
    before=snapshot(database)
    code,text=execute('repair-damaged-node-modules',command(suite,'Basic','-InstallOnly'))
    assert code==0 and vite.is_file() and snapshot(database)==before,text
    RESULTS[-1]['repaired_vite_and_preserved_database']=True
    # A deliberately malformed synthetic lock must fail npm ci, without starting a service.
    lock=front/'package-lock.json'; saved=lock.read_bytes()
    lock.write_text('{"lockfileVersion":3,"packages":{}}')
    try:
        code,text=execute('npm-ci-rejects-invalid-fixture-lock',command(suite,'Basic','-InstallOnly'))
        assert code!=0 and '按原锁安装前端' in text and '退出码' in text,text
        assert not live.is_open(8100) and not live.is_open(5180)
        assert snapshot(database)==before
        RESULTS[-1]['no_service_and_database_preserved']=True
    finally:
        lock.write_bytes(saved)
    # Restore normally through the same existing lock/source/cache, no installation bypass.
    code,text=execute('repair-with-original-lock',command(suite,'Basic','-InstallOnly'))
    assert code==0,text
    # A real Vite configuration failure after backend readiness must clean the backend.
    config=front/'vite.config.js'; saved_config=config.read_bytes()
    config.write_text("throw new Error('WP02 synthetic frontend startup failure');\n")
    try:
        before=snapshot(database)
        code,text=execute('frontend-startup-failure-cleans-owned-backend',command(suite,'Basic'))
        assert code!=0 and '前端 提前退出' in text and '退出码' in text,text
        assert not live.is_open(8100) and not live.is_open(5180)
        assert snapshot(database)==before
        RESULTS[-1]['backend_cleaned_database_preserved']=True
    finally:
        config.write_bytes(saved_config)
    # The demo script must restore caller environment even when invoked within one host.
    script=suite/'Kimi版/demo.ps1'
    escaped=str(script).replace("'", "''")
    ps="$env:DEMO_MODE='WP02-synthetic-original'; Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue; & '"+escaped+"' -Action Verify; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; if ($env:DEMO_MODE -ne 'WP02-synthetic-original' -or (Test-Path Env:DATABASE_URL)) { exit 7 }; Write-Output 'caller environment restored'"
    code,text=execute('kimi-restores-caller-environment',[PWSH,'-NoProfile','-Command',ps])
    assert code==0 and 'caller environment restored' in text,text
    # Launch both actual legacy Basic scripts from an unrelated cwd.
    owners=[]
    try:
        for part in ('backend','frontend'):
            script=suite/'基础版/scripts'/('start-'+part+'.ps1')
            output=OUT/('basic-split-'+part+'.log')
            file=output.open('wb')
            cmd=[PWSH,'-NoProfile','-File',str(script),'-NoBrowser','-NoPopup']
            proc=subprocess.Popen(cmd,cwd='/tmp',env=live.clean_environment(),stdout=file,stderr=subprocess.STDOUT,start_new_session=True)
            owners.append((proc,file,output,cmd))
            live.wait_ready(proc,output)
            RESULTS.append({'case':'basic-split-'+part,'command':cmd,'cwd':'/tmp','ready':True})
        assert live.check_api(8100,5180,'/api')['identity']==200
        code,text=execute('whole-stack-refuses-split-owner',command(suite,'Basic'))
        assert code==1 and '全栈入口与分离入口不能混用' in text,text
        before=snapshot(database)
        code,text=execute('reset-refuses-live-owner',[PWSH,'-NoProfile','-File',str(suite/'基础版/scripts/reset-demo.ps1'),'-Confirm:$false'])
        assert code!=0 and '请先停止本版服务' in text,text
        assert snapshot(database)==before
        assert all(proc.poll() is None for proc,_,_,_ in owners)
        RESULTS[-1]['owners_alive_database_preserved']=True
    finally:
        # Each split owner has one child; use its own stdout service log PID.
        for proc,file,output,cmd in reversed(owners):
            logs=sorted((suite/'logs').glob('basic-*/startup.log'),key=lambda p:p.stat().st_mtime)
            component='前端' if 'frontend' in output.name else '后端'
            relevant=next(p for p in reversed(logs) if ('service='+component+';') in p.read_text(encoding='utf-8-sig'))
            import re
            pids=[int(n) for n in re.findall(r'pid=(\d+)',relevant.read_text(encoding='utf-8-sig'))]
            live.stop(proc,file,pids)
        assert not live.is_open(8100) and not live.is_open(5180)
    # DeepSeek setup must create backend/.venv, ignore legacy backend/venv, and not seed.
    fresh=pathlib.Path(tempfile.mkdtemp(prefix='WP02 setup 中文 空格 ',dir='/tmp'))
    freshsuite=fresh/'PMS 系列'
    source=ROOT/'systems/pms-suite'
    tracked=subprocess.check_output(['git','ls-files','-z','systems/pms-suite'],cwd=ROOT).decode().strip('\0').split('\0')
    for path in tracked:
        if not (path.startswith('systems/pms-suite/DeepSeek版/') or path=='systems/pms-suite/start-helper.ps1'): continue
        src=ROOT/path; dst=freshsuite/src.relative_to(source)
        dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
    legacy=freshsuite/'DeepSeek版/backend/venv'
    legacy.mkdir();(legacy/'synthetic-marker.txt').write_text('keep-old-venv')
    partial=freshsuite/'DeepSeek版/backend/.venv'
    partial.mkdir();(partial/'synthetic-partial-marker.txt').write_text('keep-partial-venv')
    cmd=[PWSH,'-NoProfile','-File',str(freshsuite/'DeepSeek版/setup.ps1')]
    code,text=execute('deepseek-setup-fresh-installonly',cmd)
    assert code==0,text
    assert (freshsuite/'DeepSeek版/backend/.venv/bin/python').exists()
    assert not (freshsuite/'DeepSeek版/backend/.demo').exists()
    assert (legacy/'synthetic-marker.txt').read_text()=='keep-old-venv'
    assert (partial/'synthetic-partial-marker.txt').read_text()=='keep-partial-venv'
    RESULTS[-1].update(created_correct_venv=True,no_database_created=True,old_venv_preserved=True,partial_venv_repaired=True)
    # Show the real platform and preserve command-level outcomes, never claim Windows.
    (OUT/'results.json').write_text(json.dumps({'platform':'Linux PowerShell 7','reused_synthetic_suite':str(suite),'fresh_setup_suite':str(freshsuite),'results':RESULTS},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'directory':str(OUT),'cases':len(RESULTS),'status':'passed'},ensure_ascii=False))

if __name__=='__main__':
    try: main()
    except Exception:
        (OUT/'partial-results.json').write_text(json.dumps(RESULTS,ensure_ascii=False,indent=2))
        raise
