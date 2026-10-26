"""Real PowerShell 7/Linux bootstrap, API, process and preservation checks.

No Windows claim. No real database, attachment, environment file or repository
runtime directory is an input. Every backend/frontend is a fresh tracked copy.
"""
import concurrent.futures
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from run_command import ROOT, EVIDENCE as BASE_EVIDENCE, manifest, run
EVIDENCE = BASE_EVIDENCE / ('linux-' + time.strftime('%Y%m%d-%H%M%S', time.gmtime()))

PWSH = os.environ.get('WP02_PWSH', '/tmp/guanheng-wp02-tools/pwsh/pwsh')
EDITIONS = [('Basic', '基础版', 8100, 5180, '/api'), ('DeepSeek', 'DeepSeek版', 8102, 5182, '/api'), ('Kimi', 'Kimi版', 8101, 5181, '/api/v1')]


def http(url, body=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()


def is_open(port):
    with socket.socket() as client:
        client.settimeout(.2)
        return client.connect_ex(('127.0.0.1', port)) == 0


def clean_environment():
    result = os.environ.copy()
    for name in ('DATABASE_URL', 'DEMO_MODE', 'ENVIRONMENT'):
        result.pop(name, None)
    return result


def launch(suite, edition, suffix):
    output = EVIDENCE / f'linux-{edition.lower()}-{suffix}-console.log'
    file = output.open('wb')
    command = [PWSH, '-NoProfile', '-File', str(suite/'start-helper.ps1'), '-Edition', edition, '-NoBrowser', '-NoPopup']
    proc = subprocess.Popen(command, cwd='/tmp', env=clean_environment(), stdout=file, stderr=subprocess.STDOUT, start_new_session=True)
    return proc, file, output, command


def wait_ready(proc, output, seconds=240):
    deadline = time.monotonic()+seconds
    while time.monotonic()<deadline:
        content = output.read_text(errors='replace')
        if '[就绪]' in content:
            assert proc.poll() is None, content
            return
        if proc.poll() is not None:
            raise AssertionError(f'helper exited {proc.returncode}: {content}')
        time.sleep(.5)
    raise AssertionError('bootstrap timeout: '+output.read_text(errors='replace'))


def owned_pids(suite, edition):
    rows = sorted((suite/'logs').glob(f'{edition.lower()}-*/startup.log'), key=lambda p:p.stat().st_mtime)
    if not rows:
        return []
    return [int(n) for n in re.findall(r'pid=(\d+)', rows[-1].read_text(encoding='utf-8-sig'))]


def stop(proc, file, pids):
    if proc.poll() is None:
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=12)
        except subprocess.TimeoutExpired:
            # Report failure; still clean up only processes spawned by this fixture.
            proc.terminate()
            proc.wait(timeout=5)
            raise AssertionError('helper did not stop on SIGINT')
    file.close()
    for pid in pids:
        assert not pathlib.Path(f'/proc/{pid}').exists(), f'owned service {pid} survived owner shutdown'


def check_api(bp, fp, prefix):
    expected = []
    for port in (bp, fp):
        base = f'http://127.0.0.1:{port}{prefix}'
        code, body = http(base+'/health')
        assert code==200 and json.loads(body)['status']=='ok'
        expected.append({'port':port,'health':code})
    code, html = http(f'http://127.0.0.1:{fp}/')
    assert code==200 and '<html' in html
    # Exercise actual frontend proxy and actual database-backed identity lookup.
    base = f'http://127.0.0.1:{fp}{prefix}'
    code, _ = http(base+'/auth/me')
    assert code==401
    code, _ = http(base+'/auth/login', {'username':'admin','password':'WP02-incorrect-synthetic'})
    assert code==401
    code, body = http(base+'/auth/login', {'username':'admin','password':'Admin@123456'})
    assert code==200
    token = json.loads(body)['access_token']
    code, body = http(base+'/auth/me', token=token)
    assert code==200 and json.loads(body)['username']=='admin'
    return {'health':expected,'frontend':200,'anonymous_identity':401,'wrong_password':401,'login':200,'identity':200}


def database_snapshot(path):
    with sqlite3.connect(path) as db:
        tables = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
        user_table = 'users' if 'users' in tables else 'user'
        columns = {r[1] for r in db.execute(f'pragma table_info("{user_table}")')}
        password = 'hashed_password' if 'hashed_password' in columns else 'password_hash'
        count = db.execute(f'select count(*) from "{user_table}"').fetchone()[0]
        value = db.execute(f'select "{password}" from "{user_table}" where username=?', ('admin',)).fetchone()[0]
        return {'users':count, 'password_digest':hashlib.sha256(value.encode()).hexdigest(), 'integrity':db.execute('pragma integrity_check').fetchone()[0]}


def verify_edition(suite, spec):
    edition, name, bp, fp, prefix = spec
    assert not is_open(bp) and not is_open(fp), 'pre-existing port is occupied; refuse fixture'
    target = suite/name
    database = target/'backend/.demo/demo.db'
    venv = target/'.venv' if edition=='Basic' else target/'backend/.venv'
    assert not venv.exists() and not database.exists()
    package_files = [target/'frontend/package.json', target/'frontend/package-lock.json', target/'backend/requirements.txt']
    original = {str(p):p.read_bytes() for p in package_files}
    protected = target/'backend' / ('pms.db' if edition=='DeepSeek' else 'app.db')
    protected.write_bytes(b'WP02 synthetic protected database sentinel; never open')
    proc = file = None
    started = time.time()
    rows = {'edition':edition,'fixture':str(target),'start_epoch':started}
    try:
        proc,file,output,command = launch(suite, edition, 'fresh')
        rows['fresh_command'] = command
        rows['fresh_cwd'] = '/tmp'
        wait_ready(proc,output)
        rows['fresh_api'] = check_api(bp,fp,prefix)
        assert venv.is_dir() and (venv/'bin/python').is_file()
        rows['created_venv'] = True
        assert protected.read_bytes()==b'WP02 synthetic protected database sentinel; never open'
        rows['protected_file_unchanged'] = True
        pids = owned_pids(suite,edition)
        assert len(pids)==2
        for pid in pids:
            cwd = pathlib.Path(f'/proc/{pid}/cwd').resolve()
            assert cwd in (target/'backend',target/'frontend'), str(cwd)
        rows['actual_child_cwds']=[str(pathlib.Path(f'/proc/{pid}/cwd').resolve()) for pid in pids]
        # Repeat while running must refuse; it may not adopt a healthy stranger.
        duplicate = subprocess.run(command, cwd='/tmp', env=clean_environment(), capture_output=True, timeout=20)
        text = (duplicate.stdout+duplicate.stderr).decode(errors='replace')
        assert duplicate.returncode==1 and ('已有启动' in text or '端口' in text), text
        assert proc.poll() is None and all(pathlib.Path(f'/proc/{pid}').exists() for pid in pids)
        rows['duplicate_refused_and_owner_alive'] = True
        stop(proc,file,pids); proc=file=None
        assert not is_open(bp) and not is_open(fp)
        rows['ctrl_c_cleanup'] = True
        snap = database_snapshot(database)
        with sqlite3.connect(database) as db:
            db.execute('create table wp02_preserve_marker (value text primary key)')
            db.execute('insert into wp02_preserve_marker values (?)',('synthetic-keep-on-restart',))
        proc,file,output,command = launch(suite,edition,'restart')
        wait_ready(proc,output)
        rows['restart_api'] = check_api(bp,fp,prefix)
        assert database_snapshot(database)==snap
        with sqlite3.connect(database) as db:
            assert db.execute('select value from wp02_preserve_marker').fetchall()==[('synthetic-keep-on-restart',)]
        rows['restart_preserves_users_password_marker'] = True
        pids = owned_pids(suite,edition)
        # Kill only this fixture's known child to test the owner's failure cleanup.
        os.kill(pids[0],signal.SIGTERM)
        proc.wait(timeout=15)
        file.close(); file=None
        assert proc.returncode != 0
        assert not is_open(bp) and not is_open(fp)
        rows['owned_child_failure_exit'] = proc.returncode
        rows['owned_child_failure_cleans_peer'] = True
        proc=None
        assert protected.read_bytes()==b'WP02 synthetic protected database sentinel; never open'
        assert all(p.read_bytes()==original[str(p)] for p in package_files)
        rows['frozen_manifests_unchanged'] = True
        # Preserve native pip failure without creating a service or changing the DB.
        requirements=target/'backend/requirements.txt'
        saved=requirements.read_bytes()
        requirements.write_text('WP02 INVALID REQUIREMENT !!!\n')
        try:
            result = subprocess.run(command, cwd='/tmp', env=clean_environment(), capture_output=True, timeout=60)
            text=(result.stdout+result.stderr).decode(errors='replace')
            (EVIDENCE/f'linux-{edition.lower()}-pip-failure.log').write_text(text)
            assert result.returncode != 0 and '安装Python依赖' in text and '退出码' in text
            assert not is_open(bp) and not is_open(fp)
            assert database_snapshot(database)==snap
            rows['native_install_failure_exit']=result.returncode
        finally:
            requirements.write_bytes(saved)
        rows['end_epoch']=time.time()
        rows['status']='passed'
        return rows
    finally:
        if proc is not None and proc.poll() is None:
            pids=owned_pids(suite,edition)
            try:
                stop(proc,file,pids)
            except Exception:
                # Owned PID list only; never discover/kill a port's process.
                for pid in pids:
                    try: os.kill(pid,signal.SIGTERM)
                    except ProcessLookupError: pass
                raise
        elif file is not None:
            file.close()
        logs=sorted((suite/'logs').glob(f'{edition.lower()}-*')) if (suite/'logs').exists() else []
        for directory in logs:
            if directory.is_dir():
                for log in directory.glob('*.log'):
                    value=log.read_text(encoding='utf-8-sig',errors='replace')
                    value=re.sub(r'(https?://)[^\s/@]+:[^\s/@]+@',r'\1[REDACTED]@',value)
                    (EVIDENCE/f'{directory.name}-{log.name}').write_text(value,encoding='utf-8')


def main():
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    work=pathlib.Path(tempfile.mkdtemp(prefix='WP02 中文 空格 ',dir='/tmp'))
    suite=work/'PMS 系列'
    suite.mkdir()
    source=ROOT/'systems/pms-suite'
    names=subprocess.check_output(['git','ls-files','-z','systems/pms-suite'],cwd=ROOT,text=True).strip('\0').split('\0')
    bindings={}
    for name in names:
        src=ROOT/name
        dest=suite/src.relative_to(source)
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(src,dest)
        bindings[str(src.relative_to(ROOT))]=hashlib.sha256(dest.read_bytes()).hexdigest()
    (EVIDENCE/'linux-source-binding.json').write_text(json.dumps({'fixture':str(suite),'files':bindings},ensure_ascii=False,indent=2))
    rows=[]
    failures=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        jobs={executor.submit(verify_edition,suite,spec):spec[0] for spec in EDITIONS}
        for future in concurrent.futures.as_completed(jobs):
            try:
                row=future.result()
                rows.append(row)
                print(json.dumps(row,ensure_ascii=False),flush=True)
            except Exception as exc:
                failures.append({'edition':jobs[future],'error':str(exc)})
                print(json.dumps(failures[-1],ensure_ascii=False),flush=True)
    (EVIDENCE/'linux-results.json').write_text(json.dumps({'platform':sys.platform,'fixture':str(suite),'results':rows,'failures':failures},ensure_ascii=False,indent=2)+'\n')
    assert not failures, failures
    assert len(rows)==3

if __name__=='__main__':
    main()
