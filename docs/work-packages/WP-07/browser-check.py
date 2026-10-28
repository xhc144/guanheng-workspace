"""Production Chromium checks. Uses only a new temporary app and synthetic SQLite data.
Run after pnpm build: python3 docs/work-packages/WP-07/browser-check.py
Requires the environment's existing Python Playwright and Chromium; installs nothing.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--project', type=Path, default=Path(__file__).resolve().parents[3] / 'systems/project-ops')
parser.add_argument('--chromium', default='/usr/bin/chromium')
parser.add_argument('--output', type=Path)
parser.add_argument('--keep', action='store_true', help='Keep only the synthetic temporary workspace for diagnosis')
args = parser.parse_args()
started_at = datetime.now(timezone.utc).isoformat()
project = args.project.resolve()
root = Path(tempfile.mkdtemp(prefix='wp07-browser-'))
checks = []
server = None
setup = r'''
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root,source]=process.argv.slice(1);
const {openDatabase}=await import(pathToFileURL(join(source,'lib/db.ts')));
const {createSession}=await import(pathToFileURL(join(source,'lib/auth.ts')));
const db=openDatabase(join(root,'data/synthetic.db'));
db.exec(`INSERT INTO departments (id,name) VALUES ('d1','合成交付部'),('d2','外部门');
 INSERT INTO users (id,username,name,password_hash,role,department_id) VALUES
 ('u-admin','wp07-admin','合成管理员','test','ADMIN','d1'),('u-finance','wp07-finance','合成财务','test','FINANCE','d1'),('u-manager','wp07-manager','合成经理','test','DEPARTMENT_MANAGER','d1'),('u-member','wp07-member','合成员工','test','PROJECT_MEMBER','d1');
 INSERT INTO customers (id,name,department_id,owner_user_id) VALUES ('c1','WP07合成客户','d1','u-manager'),('c2','外部合成客户','d2','u-admin');
 INSERT INTO contracts (id,number,name,customer_id,amount_cents) VALUES ('ct1','WP07-001','WP07合成合同','c1',200000),('ct2','WP07-002','WP07外部合同','c2',100000);
 INSERT INTO projects (id,name,customer_id,department_id,manager_user_id) VALUES ('p1','WP07合成项目','c1','d1','u-manager');
 INSERT INTO project_members (project_id,user_id) VALUES ('p1','u-member');
 INSERT INTO contract_projects (contract_id,project_id) VALUES ('ct1','p1');
 INSERT INTO receivables (id,contract_id,project_id,name,category,amount_cents,due_date) VALUES
 ('r1','ct1','p1','WP07首期款','历史未知类型',100000,'2026-10-01'),('r2','ct1','p1','WP07验收款','验收款',100000,'2026-12-31'),('r3','ct2',NULL,'外部门应收','其他',100000,'2026-12-31');`);
const tokens={};for(const role of ['admin','finance','manager','member'])tokens[role]=createSession(db,`u-${role}`).token;
db.close();console.log(JSON.stringify(tokens));
'''

def check(name, detail=None):
    checks.append({'name': name, 'status': 'PASS', **({'detail': detail} if detail is not None else {})})

def sql(query, params=()):
    with sqlite3.connect(root / 'data/synthetic.db') as db:
        return db.execute(query, params).fetchall()

def snapshot():
    return {table: sql(f'SELECT COUNT(*) FROM {table}')[0][0] for table in ['receipts', 'receipt_allocations', 'idempotency_keys', 'audit_logs']}

try:
    shutil.copytree(project / '.next/standalone', root, dirs_exist_ok=True, symlinks=True)
    shutil.copytree(project / '.next/static', root / '.next/static', dirs_exist_ok=True)
    tokens = json.loads(subprocess.check_output(['node', '--experimental-strip-types', '--input-type=module', '-e', setup, str(root), str(project)], text=True))
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    env = dict(os.environ, DATABASE_FILENAME='synthetic.db', HOSTNAME='127.0.0.1', PORT=str(port), NODE_ENV='production')
    with (root / 'server.log').open('w') as log:
        server = subprocess.Popen(['node', 'server.js'], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
    deadline = time.monotonic() + 20
    while True:
        try:
            with urllib.request.urlopen(base + '/login', timeout=1) as response:
                assert response.status == 200
            break
        except OSError:
            if server.poll() is not None or time.monotonic() >= deadline: raise RuntimeError('Synthetic production server did not start')
            time.sleep(.1)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chromium, headless=True)
        browser_version = browser.version
        contexts = {}
        for role in ['admin', 'finance', 'manager', 'member', 'anonymous', 'forged']:
            c = browser.new_context(viewport={'width': 375, 'height': 812}, locale='zh-CN', base_url=base)
            if role != 'anonymous':
                c.add_cookies([{'name': 'pms_session', 'value': tokens.get(role, 'synthetic-forged-token'), 'url': base}])
            contexts[role] = c
        admin = contexts['admin']
        payload = {'idempotencyKey': 'http-cross-receipt', 'customerId': 'c1', 'receivedDate': '2026-10-28', 'amountCents': 10000, 'allocations': [{'receivableId': 'r1', 'amountCents': 5000}, {'receivableId': 'r2', 'amountCents': 5000}]}
        before = snapshot()
        for role, status in [('anonymous', 401), ('forged', 401), ('manager', 403), ('member', 403)]:
            response = contexts[role].request.post('/api/finance/receipts', data=payload)
            assert response.status == status, (role, response.status, response.text())
        response = admin.request.post('/api/finance/receipts', data=payload, headers={'Origin': 'https://untrusted.invalid'})
        assert response.status == 403
        assert snapshot() == before
        check('真实HTTP鉴权、四角色及跨源拒绝均无写入')
        malformed = admin.request.post('/api/finance/receipts', data=b'{broken-json', headers={'Content-Type': 'application/json'})
        assert malformed.status == 400 and '有效JSON' in malformed.json()['error'], (malformed.status, malformed.text())
        assert admin.request.post('/api/finance/unknown', data=payload).status == 404
        assert admin.request.post('/api/finance/receipts', data={**payload, 'customerId': 'c2'}).status == 400
        check('非法JSON、未知类型、跨客户应收返回中文错误')
        response = contexts['finance'].request.post('/api/finance/receipts', data=payload)
        assert response.status == 201, response.text()
        receipt_id = response.json()['id']
        repeated = admin.request.post('/api/finance/receipts', data={**payload, 'allocations': list(reversed(payload['allocations']))})
        assert repeated.status == 200 and repeated.json() == {'id': receipt_id, 'replayed': True}
        assert admin.request.post('/api/finance/receipts', data={**payload, 'notes': 'changed'}).status == 409
        assert sql('SELECT COUNT(*) FROM audit_logs WHERE entity_id=?', (receipt_id,))[0][0] == 1
        assert sql('SELECT SUM(amount_cents) FROM receipt_allocations WHERE receipt_id=?', (receipt_id,))[0][0] == 10000
        check('真实HTTP跨应收整数分摊、重排重放及同键异请求')
        for _ in range(2):
            assert admin.request.patch('/api/finance/receipts', data={'id': receipt_id, 'reason': '合成更正'}).status == 200
        assert admin.request.patch('/api/finance/receipts', data={'id': receipt_id, 'reason': '更改历史'}).status == 409
        assert sql('SELECT COUNT(*) FROM audit_logs WHERE entity_id=?', (receipt_id,))[0][0] == 2
        assert sql('SELECT void_reason FROM receipts WHERE id=?', (receipt_id,))[0][0] == '合成更正'
        assert sql('SELECT COUNT(*) FROM receipt_allocations WHERE receipt_id=?', (receipt_id,))[0][0] == 2
        check('真实HTTP作废重试保留原原因及关联，不重复审计')
        sql("CREATE TRIGGER audit_fault BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'private synthetic SQL fault'); END")
        before = snapshot()
        fault_payload = {**payload, 'idempotencyKey': 'http-audit-failure'}
        response = admin.request.post('/api/finance/receipts', data=fault_payload)
        assert response.status == 500 and response.json()['error'] == '财务保存失败，数据已回滚，请稍后重试'
        assert 'private' not in response.text() and snapshot() == before
        sql('DROP TRIGGER audit_fault')
        assert admin.request.post('/api/finance/receipts', data=fault_payload).status == 201
        check('真实HTTP审计故障500，源记录、分摊、幂等和审计全回滚，同键可重试')

        page = admin.new_page(); page_errors = []; console_errors = []; failed_requests = []; failed_responses = []
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
        def record_failed_request(request):
            response = request.response()
            failed_requests.append({'url': request.url, 'failure': request.failure, 'method': request.method,
                                    'rsc': request.headers.get('rsc'), 'prefetch': request.headers.get('next-router-prefetch'),
                                    'action': bool(request.headers.get('next-action')), 'responseStatus': response.status if response else None})
        page.on('requestfailed', record_failed_request)
        page.on('response', lambda response: failed_responses.append({'url': response.url, 'status': response.status}) if response.status >= 400 else None)
        page.goto('/finance?entry=1', wait_until='networkidle')
        form = page.locator('form').filter(has=page.get_by_role('heading', name='新增回款', exact=True))
        form.locator('input[list]').fill('WP07合成客户')
        form.locator('[name=number]').fill('UI-LOST-RECEIPT')
        form.locator('[name=date]').fill('2026-10-28')
        form.locator('[name=amount]').fill('100.00')
        form.get_by_label('第1笔分摊应收', exact=True).select_option('r1')
        form.get_by_label('第1笔分摊金额', exact=True).fill('99.00')
        form.get_by_role('button', name='确认登记').click()
        form.get_by_role('alert').filter(has_text='分摊合计必须等于总金额').wait_for()
        assert form.locator('[name=number]').input_value() == 'UI-LOST-RECEIPT'
        assert form.locator('[name=amount]').input_value() == '100.00'
        form.locator('[name=amount]').fill('1000.01'); form.get_by_label('第1笔分摊金额', exact=True).fill('1000.01')
        form.get_by_role('button', name='确认登记').click()
        form.get_by_role('alert').filter(has_text='超过应收余额').wait_for()
        assert form.locator('[name=amount]').input_value() == '1000.01'
        assert form.get_by_label('第1笔分摊金额', exact=True).input_value() == '1000.01'
        check('375px票款本地校验和服务器超额拒绝后保留全部输入')
        form.locator('[name=amount]').fill('100.00'); form.get_by_label('第1笔分摊金额', exact=True).fill('100.00')
        def lose_response(route):
            upstream = route.fetch()
            assert upstream.status == 201, upstream.text()
            route.abort('failed')
        page.route('**/api/finance/receipts', lose_response)
        form.get_by_role('button', name='确认登记').click()
        form.get_by_role('alert').wait_for()
        assert form.locator('[name=number]').input_value() == 'UI-LOST-RECEIPT'
        page.unroute('**/api/finance/receipts', lose_response)
        form.get_by_role('button', name='确认登记').click()
        form.get_by_role('status').filter(has_text='该笔已登记').wait_for()
        assert sql("SELECT COUNT(*) FROM receipts WHERE reference_number='UI-LOST-RECEIPT'")[0][0] == 1
        assert sql("SELECT COUNT(*) FROM audit_logs WHERE entity_id=(SELECT id FROM receipts WHERE reference_number='UI-LOST-RECEIPT')")[0][0] == 1
        check('真实响应丢失后保留原幂等键，界面重试只一笔入账及审计')
        invoice = page.locator('form').filter(has=page.get_by_role('heading', name='新增发票', exact=True))
        invoice.locator('input[list]').fill('WP07合成客户'); invoice.locator('[name=number]').fill('UI-ZERO-TAX')
        invoice.locator('[name=date]').fill('2026-10-28'); invoice.locator('[name=amount]').fill('100.00'); invoice.locator('[name=tax]').fill('0.00')
        invoice.get_by_label('第1笔分摊应收', exact=True).select_option('r1'); invoice.get_by_label('第1笔分摊金额', exact=True).fill('100.00')
        invoice.get_by_role('button', name='确认登记').click()
        invoice.get_by_role('status').filter(has_text='发票已登记').wait_for()
        assert sql("SELECT amount_cents,tax_rate_basis_points,tax_cents FROM invoices WHERE invoice_number='UI-ZERO-TAX'")[0] == (10000, 0, 0)
        check('375px发票默认零税率与显式零税额可登记')
        page.goto('/contracts', wait_until='networkidle'); page.locator('.form-disclosure > summary').click()
        contract = page.locator('form').filter(has=page.get_by_role('heading', name='合同信息', exact=True))
        contract.locator('[name=number]').fill('WP07-001'); contract.locator('[name=name]').fill('重复编号保留输入')
        contract.locator('input[list]').fill('WP07合成客户'); contract.locator('[name=amount]').fill('123.45')
        contract.get_by_role('button', name='保存合同').click(); contract.get_by_role('alert').filter(has_text='合同编号已存在').wait_for()
        assert contract.locator('[name=name]').input_value() == '重复编号保留输入'
        assert contract.locator('[name=amount]').input_value() == '123.45' and contract.locator('[name=customerId]').input_value() == 'c1'
        contract.locator('[name=number]').fill('WP07-UI-NEW'); contract.get_by_role('button', name='保存合同').click()
        contract.get_by_role('status').filter(has_text='合同已创建').wait_for()
        assert sql("SELECT amount_cents FROM contracts WHERE number='WP07-UI-NEW'")[0][0] == 12345
        assert '0 笔' in page.get_by_role('row').filter(has_text='WP07-UI-NEW').inner_text()
        check('375px合同冲突保留输入，修正后创建及审计成功')
        receivable = page.locator('form').filter(has=page.get_by_role('heading', name='应收计划', exact=True))
        contract_choice = receivable.locator('datalist option').evaluate_all('(els)=>els.map(e=>e.value).find(v=>v.includes("WP07-001"))')
        receivable.locator('input[list]').first.fill(contract_choice)
        receivable.locator('[name=name]').fill('WP07界面自定义款'); receivable.locator('[name=category]').fill('历史自由类型')
        receivable.locator('[name=amount]').fill('0'); receivable.locator('[name=dueDate]').fill('2026-12-31')
        receivable.get_by_role('button', name='创建应收').click(); receivable.get_by_role('alert').filter(has_text='金额必须大于0').wait_for()
        assert receivable.locator('[name=name]').input_value() == 'WP07界面自定义款'
        receivable.locator('[name=amount]').fill('12.34'); receivable.get_by_role('button', name='创建应收').click()
        receivable.get_by_role('status').filter(has_text='应收计划已创建').wait_for()
        assert sql("SELECT amount_cents,category FROM receivables WHERE name='WP07界面自定义款'")[0] == (1234, '历史自由类型')
        check('375px应收错误保留输入，自定义类别可真实保存')
        page.set_viewport_size({'width':1440,'height':900});page.goto('/contracts',wait_until='networkidle')
        page.get_by_label('作废WP07合成合同',exact=True).click()
        popover=page.locator('details.row-editor[open] form')
        popover.get_by_label('作废原因').fill('有分摊应先更正');popover.get_by_role('button',name='确认作废').click()
        popover.get_by_role('alert').filter(has_text='存在有效票款分摊').wait_for()
        assert popover.get_by_label('作废原因').input_value()=='有分摊应先更正'
        check('已有分摊合同作废被拒绝，原因保留且无页面异常')
        for width in [375,768,1440]:
            page.set_viewport_size({'width':width,'height':900})
            for path in ['/finance?entry=1','/contracts']:
                page.goto(path,wait_until='networkidle')
                disclosure=page.locator('.form-disclosure')
                if disclosure.get_attribute('open') is None: disclosure.locator('summary').click()
                dimensions=page.evaluate('({viewport:innerWidth,scroll:document.documentElement.scrollWidth})')
                assert dimensions['scroll'] <= width, (width,path,dimensions)
                controls=page.locator('form.record-form input:not([type=hidden]),form.record-form select,form.record-form button').evaluate_all('(els)=>els.map(e=>{let r=e.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height,width:r.width}}).filter(r=>r.width>0)')
                assert controls and all(r['left']>=-.5 and r['right']<=width+.5 and r['height']>=44 for r in controls),(width,path,controls)
                page.screenshot(path=str(root/f'{width}-{path.split("?")[0][1:]}.png'),full_page=True)
                check(f'{width}px {path.split("?")[0]}无横溢，表单控件在屏内且至少44px',dimensions)
        for role in ['manager','member']:
            restricted=contexts[role].new_page();restricted.goto('/contracts',wait_until='networkidle')
            assert restricted.get_by_label('作废WP07合成合同',exact=True).count()==0
            if role=='member': assert restricted.get_by_role('button',name='创建应收').count()==0
            assert '外部合成客户' not in restricted.locator('main').inner_text()
            restricted.goto('/finance?entry=1',wait_until='networkidle')
            assert restricted.get_by_role('heading',name='新增发票',exact=True).count()==0
            restricted.close()
        check('部门经理及项目成员的列表范围和财务写入控件正确')
        anonymous=contexts['anonymous'].new_page();anonymous.goto('/finance',wait_until='networkidle');assert '/login' in anonymous.url
        check('匿名财务页面跳转登录')
        assert not page_errors, page_errors
        transport_failures = [request for request in failed_requests if request['failure'] != 'net::ERR_ABORTED']
        cancellations = [request for request in failed_requests if request['failure'] == 'net::ERR_ABORTED']
        assert len(transport_failures)==1 and transport_failures[0]['url'].endswith('/api/finance/receipts'),transport_failures
        assert all(request['url'].startswith(base) and '/api/' not in request['url'] and
                   ((request['method']=='GET' and (request['rsc']=='1' or request['prefetch']=='1')) or
                    (request['method']=='POST' and request['action'] and request['responseStatus']==200))
                   for request in cancellations), cancellations
        assert len(failed_responses)==1 and failed_responses[0]['status']==400 and failed_responses[0]['url'].endswith('/api/finance/receipts'),failed_responses
        assert all(message.startswith('Failed to load resource:') for message in console_errors),console_errors
        assert len(console_errors)==2,console_errors
        check('浏览器无pageerror；仅预期的超额400及模拟响应丢失产生网络错误',{'pageErrors':0,'expectedHttp400':1,'expectedAbortedResponse':1,'expectedConsoleErrors':2,'navigationCancellations':len(cancellations)})
        browser.close()
    result={'status':'PASS','startedAt':started_at,'finishedAt':datetime.now(timezone.utc).isoformat(),'browserVersion':browser_version,'checks':checks,'count':len(checks),'project':str(project),'temporaryRoot':str(root),'syntheticOnly':True,'server':'Next standalone production','screenshotsCommitted':False}
    if args.output: args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False,indent=2))
finally:
    if server:
        server.terminate()
        try:server.wait(timeout=10)
        except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
    if not args.keep:shutil.rmtree(root)
