"""启动临时演示后端与真实 Vite 页面，验证登录和响应式布局。"""
from contextlib import ExitStack
from datetime import datetime, timezone
import json
import os
import re
import signal
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen

from playwright.sync_api import expect, sync_playwright
from verify import ROOT, EVIDENCE, run

EDITION = [('basic', '基础版', 8100, 5180, '/api'),
           ('deepseek', 'DeepSeek版', 8102, 5182, '/api'),
           ('kimi', 'Kimi版', 8101, 5181, '/api/v1')]


def wait_url(url, process):
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'服务提前退出：{url}，退出码 {process.returncode}')
        try:
            with urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError(f'等待本地服务超时：{url}')


def evidence_file(name, suffix):
    target = EVIDENCE / f"{name}{suffix}"
    attempt = 1
    while target.exists():
        attempt += 1
        target = EVIDENCE / f"{name}-attempt-{attempt}{suffix}"
    return target


def stop_process(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=15)


def main():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    records = []
    with ExitStack() as stack:
        for short, edition, backend_port, frontend_port, prefix in EDITION:
            base = Path(f'/tmp/guanheng-WP-03-{short}')
            backend = base / 'backend'
            python = base / 'venv/bin/python'
            frontend = ROOT / 'systems/pms-suite' / edition / 'frontend'
            env = {k: v for k, v in os.environ.items() if k.upper() not in {
                'SECRET_KEY', 'ENVIRONMENT', 'DATABASE_URL', 'DEMO_MODE', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'}}
            env.update(ENVIRONMENT='test', DEMO_MODE='1', PYTHONPATH=str(backend),
                       VITE_API_BASE=prefix, VITE_API_BASE_URL=prefix)
            if short == 'deepseek':
                env['DATABASE_URL'] = f"sqlite:///{(backend / '.demo/demo.db').as_posix()}"
            if short == 'kimi':
                (backend / '.demo').mkdir(exist_ok=True)
                for index, command in enumerate([f'{python} -m alembic upgrade head', f'{python} -m app.demo_cli seed']):
                    if run(command, backend, f'kimi-browser-prepare-{index + 1}', env):
                        raise RuntimeError('Kimi 演示迁移或播种失败')
            for name, command, cwd in [
                ('backend', [str(python), '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(backend_port)], backend),
                ('frontend', ['npm', 'run', 'dev'], frontend),
            ]:
                handle = stack.enter_context(evidence_file(f'{short}-browser-{name}', '.log').open('w'))
                handle.write(json.dumps({'cwd': str(cwd), 'command': command, 'time': datetime.now(timezone.utc).isoformat()}, ensure_ascii=False) + '\n')
                handle.flush()
                process = subprocess.Popen(command, cwd=cwd, env=env, stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
                stack.callback(stop_process, process)
                wait_url(f'http://127.0.0.1:{backend_port}{prefix}/health' if name == 'backend' else f'http://127.0.0.1:{frontend_port}/', process)
        with sync_playwright() as playwright, ExitStack() as browser_stack:
            browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
            browser_stack.callback(browser.close)
            for short, edition, backend_port, frontend_port, prefix in EDITION:
                for width in [375, 768, 1440]:
                    context = browser.new_context(viewport={'width': width, 'height': 900})
                    page = context.new_page()
                    errors = []
                    responses = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.on('response', lambda response: responses.append({'url': response.url, 'status': response.status}) if '/auth/login' in response.url else None)
                    with urlopen(f'http://127.0.0.1:{backend_port}/openapi.json') as response:
                        runtime_paths = json.load(response)['paths']
                    assert prefix + '/auth/login' in runtime_paths
                    doc = (ROOT / 'docs/PMS账号与配置.md').read_text()
                    assert f'| {edition} | admin | Admin@123456 | {prefix} | {prefix}/auth/login | {prefix}/health |' in doc
                    page.goto(f'http://127.0.0.1:{frontend_port}/login')
                    user = page.locator('input[name="username"]') if short == 'basic' else page.get_by_label('用户名', exact=True)
                    password = page.locator('input[name="password"]') if short == 'basic' else page.get_by_label('密码', exact=True)
                    user.fill('admin')
                    password.fill('wrong-password')
                    for attempt in range(2):
                        previous = len(responses)
                        with page.expect_response(lambda r: r.url.endswith(prefix + '/auth/login')) as completed:
                            page.get_by_role('button', name=re.compile(r'^登\s*录$')).click()
                        assert completed.value.status == 401
                        page.wait_for_function("() => document.body.innerText.includes('用户名或密码错误')")
                        expect(page.get_by_role('button', name=re.compile(r'^登\s*录$'))).to_be_enabled()
                        assert password.input_value() == 'wrong-password'
                        assert len(responses) == previous + 1
                        assert responses[-1]['status'] == 401
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'{edition}/{width} 页面横向溢出'
                    assert page.get_by_role('button', name=re.compile(r'^登\s*录$')).bounding_box()['height'] >= 32
                    page.screenshot(path=f'/tmp/WP-03-{short}-{width}-login.png', full_page=True)
                    password.fill('Admin@123456')
                    with page.expect_response(lambda r: r.url.endswith(prefix + '/auth/login')) as completed:
                        page.get_by_role('button', name=re.compile(r'^登\s*录$')).click()
                    assert completed.value.status == 200
                    if short == 'kimi':
                        page.wait_for_url(f'http://127.0.0.1:{frontend_port}/', wait_until='load')
                    elif short == 'deepseek':
                        page.wait_for_url(f'http://127.0.0.1:{frontend_port}/workbench')
                    page.wait_for_function("() => !!localStorage.getItem('token') || !!localStorage.getItem('pms.access_token')")
                    assert responses[-1]['url'].endswith(prefix + '/auth/login')
                    assert responses[-1]['status'] == 200
                    me = page.evaluate("""async (prefix) => {
                      const token = localStorage.getItem('token') || localStorage.getItem('pms.access_token');
                      const result = await fetch(prefix + '/auth/me', {headers: {Authorization: 'Bearer ' + token}});
                      const user = await result.json();
                      return {status: result.status, username: user.username};
                    }""", prefix)
                    assert me == {'status': 200, 'username': 'admin'}, me
                    assert not errors, errors
                    records.append({'edition': edition, 'width': width, 'login_path': prefix + '/auth/login',
                                    'login_statuses': [r['status'] for r in responses], 'me': me,
                                    'runtime_openapi_and_document_match': True,
                                    'login_horizontal_overflow': False, 'page_errors': errors,
                                    'screenshot': f'/tmp/WP-03-{short}-{width}-login.png'})
                    context.close()
    result = {'time': datetime.now(timezone.utc).isoformat(), 'checks': records}
    evidence_file('browser-results', '.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
