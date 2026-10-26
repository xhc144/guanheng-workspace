"""Real Chromium checks against the isolated Node QA server; no external requests."""
import json
import subprocess
import argparse
from contextlib import nullcontext
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
SERVICE = ROOT / 'company/投标方案生成服务/方案生成服务'


def run(screens_dir=None):
    process = subprocess.Popen(['node', 'test/browser-server.js'], cwd=SERVICE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = process.stdout.readline()
        if not line:
            raise RuntimeError('本地测试服务启动失败：' + process.stderr.read())
        base = json.loads(line)['base']
        results = []
        if screens_dir:
            Path(screens_dir).mkdir(parents=True, exist_ok=True)
        screenshots = nullcontext(screens_dir) if screens_dir else tempfile.TemporaryDirectory(prefix='gh-wp18-screens-')
        with sync_playwright() as playwright, screenshots as screens:
            browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
            for width in [375, 768, 1440]:
                context = browser.new_context(viewport={'width': width, 'height': 1000})
                page = context.new_page()
                errors, absent, blocked, posts = [], [], [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('response', lambda response: absent.append(urlparse(response.url).path) if response.status >= 400 else None)
                page.on('request', lambda request: posts.append(urlparse(request.url).path) if request.method == 'POST' else None)

                def route_request(route):
                    if route.request.url.startswith(base + '/'):
                        route.continue_()
                    else:
                        blocked.append(route.request.url)
                        route.abort()

                page.route('**/*', route_request)
                page.goto(base + '/proposal.html', wait_until='networkidle')
                page.wait_for_function("document.querySelector('#availability').textContent.includes('缺少方案母版清单')")
                assert page.locator('#purchase').is_disabled()
                assert page.locator('#purchase').inner_text() == '下单与支付暂未开放'
                assert page.locator('#orders .proposal-order').count() == 2
                assert page.locator('#orders button').count() == 0
                page.locator('#company').fill('虚构浏览器测试公司')
                page.locator('#industry').fill('虚构制造')
                page.locator('#needs').fill('虚构测试需求，仅验证草稿与缺母版时的交互反馈。')
                page.locator('#save-draft').click()
                assert '草稿已保存' in page.locator('#form-status').inner_text()
                saved = page.evaluate("JSON.parse(localStorage.getItem('gh-proposal-draft-v1'))")
                assert saved['company'] == '虚构浏览器测试公司'
                page.reload(wait_until='networkidle')
                assert page.locator('#company').input_value() == saved['company']
                page.locator('#proposal-form').evaluate("form => form.dispatchEvent(new Event('submit', {cancelable: true}))")
                assert '当前不接受下单' in page.locator('#form-status').inner_text()
                assert not posts, posts
                assert not errors, errors
                assert not blocked, blocked
                assert set(absent) <= {'/guanheng-media/logo/logo.png'}, absent
                dimensions = page.evaluate("""() => ({viewport: innerWidth,
                    page: document.documentElement.scrollWidth,
                    form: document.querySelector('#proposal-form').getBoundingClientRect().width,
                    fields: [...document.querySelectorAll('.proposal-fields input,.proposal-fields textarea')]
                        .map(el => ({left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right})),
                    controls: [...document.querySelectorAll('.proposal-actions button')]
                        .map(el => ({width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height}))})""")
                assert dimensions['page'] <= width, dimensions
                if width == 768:
                    assert dimensions['form'] >= 600, '平板表单不应被侧栏挤成窄列'
                assert all(field['left'] >= 0 and field['right'] <= width for field in dimensions['fields']), dimensions
                assert all(control['height'] >= 44 for control in dimensions['controls']), dimensions
                page.locator('#save-draft').focus()
                assert page.locator('#save-draft').evaluate('element => element === document.activeElement')
                page.evaluate("document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0)")
                page.wait_for_function('window.scrollY === 0')
                page.screenshot(path=str(Path(screens) / f'{width}.png'), full_page=True)
                results.append({'width': width, 'pageWidth': dimensions['page'], 'orders': 2,
                                'posts': len(posts), 'pageErrors': errors,
                                'expectedMissingAssets': sorted(set(absent)), 'draftRestored': True})
                context.close()
            browser.close()
        print(json.dumps({'ok': True, 'browser': 'Chromium', 'syntheticOnly': True, 'results': results}, ensure_ascii=False, indent=2))
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--screens-dir', help='可选的本地截图目录；截图不得提交到仓库。')
    run(parser.parse_args().screens_dir)
