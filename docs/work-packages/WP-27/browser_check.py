"""Local-only browser checks. Run against an isolated synthetic demo backend."""
import json
import os
import re
from pathlib import Path
from uuid import uuid4
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = os.environ.get('WP27_BROWSER_BASE', 'http://127.0.0.1:5182')
assert urlparse(BASE).hostname in {'localhost', '127.0.0.1'}, 'Only a local synthetic server is allowed'
OUTPUT = Path(os.environ.get('WP27_BROWSER_OUTPUT', '/tmp/guanheng-WP-27-browser/evidence'))
OUTPUT.mkdir(parents=True, exist_ok=True)
results = {'origin': BASE, 'pages': [], 'errors': [], 'requests_failed': [], 'console': []}
results['expected_rejections'] = []


def persist():
    results['horizontal_overflow'] = [p for p in results['pages'] if p['document_width'] > p['viewport']]
    results['error_boundaries'] = [p for p in results['pages'] if p['errorBoundary']]
    (OUTPUT / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = context.new_page()
    page.set_default_timeout(15000)
    def on_error(error):
        results['errors'].append(str(error))
        persist()

    def on_response(response):
        if response.status >= 400:
            results['requests_failed'].append({'url': response.url.replace(BASE, ''), 'status': response.status})
            persist()

    page.on('pageerror', on_error)
    page.on('response', on_response)

    def on_console(event):
        if event.type in {'error', 'warning'}:
            known = next((item for item in results['console'] if item['type'] == event.type and item['text'] == event.text), None)
            if known:
                known['count'] += 1
            else:
                results['console'].append({'type': event.type, 'text': event.text, 'count': 1})
            persist()

    page.on('console', on_console)

    page.goto(BASE + '/login')
    page.get_by_label('用户名', exact=True).fill('admin')
    page.get_by_label('密码', exact=True).fill('Admin@123456')
    page.get_by_role('button', name=re.compile(r'^登\s*录$')).click()
    page.wait_for_url('**/workbench')
    page.wait_for_load_state('networkidle')
    assert page.get_by_role('complementary', name='DeepSeek 版归档说明').is_visible()
    results['internal_login'] = 'passed'

    paths = ['/workbench', '/dashboard', '/projects', '/projects/p001', '/tasks', '/gantt',
             '/calendar', '/timesheets', '/resources', '/receivables', '/budget', '/cost-profit',
             '/risks', '/approvals', '/customers', '/documents', '/import', '/audit', '/notifications', '/settings']
    if os.environ.get('WP27_SKIP_PAGE_SWEEP') == '1':
        paths = []
        results['page_sweep'] = 'skipped for flow debugging; not a full browser pass'
    for width in [375, 768, 1440]:
        page.set_viewport_size({'width': width, 'height': 1000})
        for path in paths:
            page.goto(BASE + path)
            page.wait_for_load_state('networkidle')
            metrics = page.evaluate('''() => ({
                viewport: document.documentElement.clientWidth,
                document_width: document.documentElement.scrollWidth,
                title: document.title,
                errorBoundary: document.body.innerText.includes('页面出现错误'),
            })''')
            results['pages'].append({'path': path, 'width': width, **metrics})
            persist()
            assert page.get_by_role('complementary', name='DeepSeek 版归档说明').is_visible()
            if path in ['/workbench', '/receivables'] and width in [375, 1440]:
                page.screenshot(path=str(OUTPUT / f'{path[1:]}-{width}.png'), full_page=True)

    internal_token = page.evaluate("localStorage.getItem('token')")
    headers = {'Authorization': f'Bearer {internal_token}'}
    suffix = uuid4().hex[:12]
    customer = context.request.post(BASE + '/api/customers', headers=headers, data={'name': f'虚构浏览器客户-{suffix}'})
    assert customer.status == 200
    project_code = f'BROWSER-{suffix}'
    project = context.request.post(BASE + '/api/projects', headers=headers, data={
        'code': project_code, 'name': '虚构浏览器实施项目', 'customer_id': customer.json()['id'], 'manager_id': 'u001',
    })
    assert project.status == 200
    project_id = project.json()['id']
    contract = context.request.post(BASE + '/api/contracts', headers=headers, data={
        'code': f'CT-{suffix}', 'name': '虚构浏览器合同', 'project_id': project_id, 'amount': '100.00',
    })
    assert contract.status == 200
    bank_ref = f'BROWSER-DUP-{suffix}'
    prime = context.request.post(BASE + '/api/receipts', headers=headers, data={
        'project_id': project_id, 'amount': '1.00', 'received_date': '2026-10-01T00:00:00', 'bank_ref': bank_ref,
    })
    assert prime.status == 200
    page.goto(BASE + '/receivables')
    page.get_by_role('button', name='登记回款').click()
    dialog = page.get_by_role('dialog')
    dialog.get_by_label('所属项目').click()
    page.get_by_title(f'{project_code} 虚构浏览器实施项目', exact=True).click()
    dialog.get_by_label('回款金额').fill('25.25')
    dialog.get_by_label('回款日期').fill('2026-10-28')
    dialog.get_by_label('回款日期').press('Enter')
    payer = f'虚构付款方-{suffix}'
    dialog.get_by_label('付款方', exact=True).fill(payer)
    dialog.get_by_label('银行流水号').fill(bank_ref)
    with page.expect_response(lambda response: response.url.endswith('/api/finance/receipts') and response.request.method == 'POST') as rejected:
        dialog.get_by_role('button', name=re.compile(r'^确\s*定$')).click()
    assert rejected.value.status == 400
    results['expected_rejections'].append({'url': '/api/finance/receipts', 'status': 400})
    page.get_by_text('银行流水号已存在', exact=True).wait_for()
    assert dialog.get_by_label('付款方', exact=True).input_value() == payer
    assert dialog.get_by_label('回款金额').input_value() == '25.25'
    dialog.get_by_label('银行流水号').fill(f'BROWSER-OK-{suffix}')
    with page.expect_response(lambda response: response.url.endswith('/api/finance/receipts') and response.request.method == 'POST') as created:
        dialog.get_by_role('button', name=re.compile(r'^确\s*定$')).click()
    assert created.value.status == 201
    receipt_id = created.value.json()['id']
    dialog.wait_for(state='hidden')
    row = page.get_by_role('row').filter(has_text=payer)
    row.get_by_role('button', name=re.compile(r'确\s*认')).click()
    with page.expect_response(lambda response: response.url.endswith(f'/{receipt_id}/confirm')) as confirmed:
        page.get_by_role('button', name=re.compile(r'^确\s*定$')).click()
    assert confirmed.value.status == 200
    row.get_by_text('已确认', exact=True).wait_for()
    stats_url = BASE + f'/api/receipts/project/{project_id}/stats'
    assert context.request.get(stats_url, headers=headers).json()['total_received'] == 25.25
    row.get_by_role('button', name=re.compile(r'冲\s*销')).click()
    with page.expect_response(lambda response: response.url.endswith(f'/{receipt_id}/reverse')) as reversed_response:
        page.get_by_role('button', name=re.compile(r'^确\s*定$')).click()
    assert reversed_response.value.status == 200
    row.get_by_text('已冲销', exact=True).wait_for()
    stats = context.request.get(stats_url, headers=headers).json()
    assert stats['total_received'] == 0 and stats['receivable'] == 100
    results['receipt_form_error_retains_values'] = 'passed'
    results['receipt_ui_create_confirm_reverse'] = 'passed'
    results['receipt_ui_amount'] = '25.25'
    persist()
    page.set_viewport_size({'width': 375, 'height': 1000})
    page.get_by_role('button', name='展开导航').click()
    page.get_by_role('menuitem', name='应收回款').click()
    page.get_by_role('button', name='展开导航').wait_for()
    # The zero-width Sider retains its 1px border; wait for the animation to end.
    page.wait_for_function("document.querySelector('.ant-layout-sider').getBoundingClientRect().width <= 1.1")
    page.screenshot(path=str(OUTPUT / 'receipt-flow-375.png'), full_page=True)
    results['mobile_navigation_collapses_after_selection'] = 'passed'
    persist()

    # A genuine member login from the browser origin must not bypass the server
    # by calling a known foreign ID or replaying an existing idempotency key.
    member_login = context.request.post(BASE + '/api/auth/login', data={'username': 'dev_li', 'password': 'dev123'})
    assert member_login.status == 200
    member_token = member_login.json()['access_token']
    audit_before = context.request.get(BASE + '/api/audit-logs', headers=headers).json()
    requests = [
        {'method': 'GET', 'url': f'/api/projects/{project_id}', 'expected': 404},
        {'method': 'PUT', 'url': f'/api/projects/{project_id}', 'body': {'description': '不应写入'}, 'expected': 404},
        {'method': 'POST', 'url': f'/api/finance/receipts/{receipt_id}/write-off', 'body': {'reason': '不应冲销'}, 'expected': 403},
        {'method': 'POST', 'url': '/api/finance/receipts', 'body': created.value.request.post_data_json, 'expected': 404},
    ]
    checks = page.evaluate('''async ({token, requests}) => {
        const result = [];
        for (const request of requests) {
            const response = await fetch(request.url, {
                method: request.method,
                headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
                body: request.body ? JSON.stringify(request.body) : undefined,
            });
            result.push({url: request.url, status: response.status});
        }
        return result;
    }''', {'token': member_token, 'requests': requests})
    for request, actual in zip(requests, checks):
        assert actual['status'] == request['expected'], actual
        results['expected_rejections'].append(actual)
    member_headers = {'Authorization': f'Bearer {member_token}'}
    assert context.request.get(BASE + '/api/projects/p001', headers=member_headers).status == 200
    assert context.request.get(BASE + '/api/audit-logs', headers=headers).json() == audit_before
    assert context.request.get(stats_url, headers=headers).json() == stats
    results['browser_member_foreign_read_write_and_idempotency_denied'] = 'passed'
    results['browser_member_legitimate_project_read'] = 'passed'
    results['browser_denials_preserve_money_and_audit'] = 'passed'
    persist()

    # A portal session must coexist with the internal session in one browser.
    page.goto(BASE + '/portal')
    page.get_by_label('客户门户用户名').fill('client_sz')
    page.get_by_label('客户门户密码').fill('wrong')
    with page.expect_response(lambda response: response.url.endswith('/api/portal/login')) as wrong_password:
        page.get_by_role('button', name=re.compile(r'^登\s*录$')).click()
    assert wrong_password.value.status == 401
    results['expected_rejections'].append({'url': '/api/portal/login', 'status': 401})
    page.get_by_text('用户名或密码错误', exact=True).wait_for()
    page.get_by_label('客户门户密码').fill('client123')
    page.get_by_role('button', name=re.compile(r'^登\s*录$')).click()
    page.get_by_text('企业ERP系统实施', exact=True).wait_for()
    assert page.evaluate("localStorage.getItem('token')") == internal_token
    assert page.evaluate("!!localStorage.getItem('portal_token')")
    results['portal_coexistence'] = 'passed'
    assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    page.screenshot(path=str(OUTPUT / 'portal-375.png'), full_page=True)
    page.get_by_text('企业ERP系统实施', exact=True).click()
    page.wait_for_load_state('networkidle')
    page.get_by_text('项目详情：企业ERP系统实施', exact=True).wait_for()
    assert page.get_by_text('实施', exact=True).is_visible()
    assert page.get_by_text('状态：待处理', exact=True).is_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    page.screenshot(path=str(OUTPUT / 'portal-detail-375.png'), full_page=True)
    results['portal_detail'] = 'passed'
    page.get_by_role('button', name='返回列表').click()
    page.evaluate("localStorage.setItem('portal_token', 'synthetic-expired-token')")
    with page.expect_response(lambda response: response.url.endswith('/api/portal/projects') and response.status == 401):
        page.reload()
    results['expected_rejections'].append({'url': '/api/portal/projects', 'status': 401})
    page.get_by_label('客户门户用户名').wait_for()
    assert page.evaluate("localStorage.getItem('token')") == internal_token
    results['portal_expiry_preserves_internal'] = 'passed'
    page.get_by_label('客户门户用户名').fill('client_sz')
    page.get_by_label('客户门户密码').fill('client123')
    page.get_by_role('button', name=re.compile(r'^登\s*录$')).click()
    page.get_by_text('企业ERP系统实施', exact=True).wait_for()
    page.get_by_role('button', name='退出登录').click()
    page.get_by_label('客户门户用户名').wait_for()
    assert page.evaluate("localStorage.getItem('token')") == internal_token
    results['portal_logout_preserves_internal'] = 'passed'
    page.goto(BASE + '/workbench')
    page.wait_for_load_state('networkidle')
    assert page.get_by_role('complementary', name='DeepSeek 版归档说明').is_visible()
    assert page.get_by_label('用户名', exact=True).count() == 0
    context.close()
    browser.close()

persist()
print(json.dumps({k: v for k, v in results.items() if k != 'pages'}, ensure_ascii=False, indent=2))
print(f"Checked {len(results['pages'])} page/viewport combinations; output: {OUTPUT}")
assert not results['errors'], results['errors']
assert not results['error_boundaries'], results['error_boundaries']
unexpected = results['requests_failed'].copy()
for expected in results['expected_rejections']:
    unexpected.remove(expected)
assert not unexpected, unexpected
