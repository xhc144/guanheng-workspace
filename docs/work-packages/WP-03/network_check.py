"""真实停止合成后端，验证 owned 登录页的离线错误与表单行为。"""
from contextlib import ExitStack
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess

from playwright.sync_api import expect, sync_playwright

from browser_check import evidence_file, stop_process, wait_url
from verify import EVIDENCE, ROOT


def main():
    results = []
    for short, edition, backend_port, frontend_port, prefix in [
        ('deepseek', 'DeepSeek版', 8102, 5182, '/api'),
        ('kimi', 'Kimi版', 8101, 5181, '/api/v1'),
    ]:
        base = Path(f'/tmp/guanheng-WP-03-{short}')
        env = {k: v for k, v in os.environ.items() if k.upper() not in {
            'SECRET_KEY', 'ENVIRONMENT', 'DATABASE_URL', 'DEMO_MODE', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'}}
        env.update(ENVIRONMENT='test', DEMO_MODE='1', PYTHONPATH=str(base / 'backend'),
                   VITE_API_BASE=prefix, VITE_API_BASE_URL=prefix)
        if short == 'deepseek':
            env['DATABASE_URL'] = f"sqlite:///{(base / 'backend/.demo/demo.db').as_posix()}"
        with ExitStack() as processes:
            handles = {}
            for name, command, cwd, url in [
                ('backend', [str(base / 'venv/bin/python'), '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(backend_port)], base / 'backend', f'http://127.0.0.1:{backend_port}{prefix}/health'),
                ('frontend', ['npm', 'run', 'dev'], ROOT / 'systems/pms-suite' / edition / 'frontend', f'http://127.0.0.1:{frontend_port}/'),
            ]:
                log = processes.enter_context(evidence_file(f'{short}-network-{name}', '.log').open('w'))
                log.write(json.dumps({'cwd': str(cwd), 'command': command, 'time': datetime.now(timezone.utc).isoformat()}, ensure_ascii=False) + '\n')
                log.flush()
                process = subprocess.Popen(command, cwd=cwd, env=env, stdout=log,
                                           stderr=subprocess.STDOUT, start_new_session=True)
                processes.callback(stop_process, process)
                handles[name] = process
                wait_url(url, process)
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
                try:
                    context = browser.new_context(viewport={'width': 375, 'height': 900})
                    page = context.new_page()
                    login_requests = []
                    page.on('request', lambda request: login_requests.append(request.url) if request.url.endswith(prefix + '/auth/login') else None)
                    page.goto(f'http://127.0.0.1:{frontend_port}/login')
                    username = page.get_by_label('用户名', exact=True)
                    password = page.get_by_label('密码', exact=True)
                    button = page.get_by_role('button', name=re.compile(r'^登\s*录$'))
                    username.fill('')
                    password.fill('')
                    button.click()
                    expect(page.get_by_text('请输入用户名', exact=True)).to_be_visible()
                    expect(page.get_by_text('请输入密码', exact=True)).to_be_visible()
                    assert not login_requests
                    username.fill('admin')
                    password.fill('SyntheticOffline@234')
                    stop_process(handles['backend'])
                    with page.expect_response(lambda response: response.url.endswith(prefix + '/auth/login')) as response:
                        button.click()
                    assert response.value.status >= 500
                    error = page.get_by_role('alert').filter(has_text='登录失败，请检查本地服务是否启动后重试')
                    expect(error).to_be_visible()
                    expect(button).to_be_enabled()
                    assert username.input_value() == 'admin'
                    assert password.input_value() == 'SyntheticOffline@234'
                    assert page.evaluate('localStorage.getItem("token")') is None
                    assert button.bounding_box()['height'] >= 44
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                    page.screenshot(path=f'/tmp/WP-03-{short}-offline-375.png', full_page=True)
                    results.append({'edition': edition, 'width': 375, 'required_fields_prevent_request': True,
                                    'backend_stopped': True, 'actual_proxy_status': response.value.status,
                                    'chinese_error': error.inner_text(), 'inputs_preserved': True,
                                    'submit_enabled': True, 'button_height': button.bounding_box()['height'],
                                    'token_absent': True, 'horizontal_overflow': False})
                    context.close()
                finally:
                    browser.close()
    record = {'time': datetime.now(timezone.utc).isoformat(), 'checks': results}
    evidence_file('network-results', '.json').write_text(json.dumps(record, ensure_ascii=False, indent=2))
    print(json.dumps(record, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
