/* Run with an existing Playwright installation and this package's isolated venv:
 * node docs/work-packages/WP-26/browser-smoke.cjs /tmp/guanheng-WP-26-kimi/venv/bin/python
 * Starts only loopback servers; all database/workbook/attachment paths are new /tmp paths.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../..');
const source = path.join(root, 'systems/pms-suite/Kimi版');
const python = process.argv[2];
assert(python, 'Pass the isolated Python interpreter as the first argument');
const processes = [];
let browser;
const evidence = { checks: [], page_errors: [], failed_requests: [], console_errors: [], http_errors: [] };

async function absent(url) {
  let connected = false;
  try { await fetch(url); connected = true; } catch {}
  assert(!connected, `Refusing to reuse an existing listener: ${url}`);
}
function start(command, args, cwd, env, log) {
  const fd = fs.openSync(log, 'w');
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  processes.push(child);
  return child;
}
async function ready(url, child) {
  for (let n = 0; n < 100; n++) {
    assert(child.exitCode === null, `Server exited before readiness: ${url}`);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready: ${url}`);
}
(async () => {
  await absent('http://127.0.0.1:8101/api/v1/health');
  await absent('http://127.0.0.1:5181/');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'guanheng-WP-26-browser-'));
  const backend = path.join(temp, 'backend');
  fs.cpSync(path.join(source, 'backend'), backend, { recursive: true, filter: p => {
    const name = path.basename(p);
    return !['.venv', '.demo', '__pycache__', '.pytest_cache', 'storage', 'logs'].includes(name)
      && !name.startsWith('.env') && !/\.db(?:-|$)/.test(name);
  }});
  const env = { ...process.env, ENVIRONMENT: 'test', DEMO_MODE: '0',
    DATABASE_URL: `sqlite:///${temp}/synthetic.db`, STORAGE_DIR: `${temp}/storage`, PYTHONPATH: backend };
  const setup = spawnSync(python, ['-'], { cwd: backend, env, encoding: 'utf8', input: `
from app import models
from app.db import Base, SessionLocal, engine
from app.main import seed_baseline_data
import openpyxl
Base.metadata.create_all(engine)
with SessionLocal() as db:
    seed_baseline_data(db)
    db.commit()
    admin = db.query(models.User).filter_by(username="admin").one()
    project = models.Project(code="BROWSER", name="浏览器合成项目", owner_id=admin.id)
    db.add(project); db.flush()
    db.add(models.Risk(project_id=project.id, title="浏览器合成风险", probability="低", impact="低", level="低"))
    db.commit()
workbook = openpyxl.Workbook()
sheet = workbook.active
sheet.append(["项目编号", "项目名称", "客户", "合同金额", "已收", "应收", "月份"])
sheet.append(["UI-GOOD", "浏览器导入项目", "合成客户", 100, 20, 80, "2024.06"])
sheet.append([None, "合计", None, 100, 20, 80, None])
sheet.append(["UI-BAD", None, "不应创建客户", 100, 0, 0, None])
workbook.save("${temp}/synthetic.xlsx")
workbook.close()
` });
  assert.equal(setup.status, 0, setup.stdout + setup.stderr);
  const api = start(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8101'],
    backend, env, path.join(temp, 'backend.log'));
  const frontend = start('npm', ['run', 'dev'], path.join(source, 'frontend'), process.env,
    path.join(temp, 'frontend.log'));
  await Promise.all([ready('http://127.0.0.1:8101/api/v1/health', api), ready('http://127.0.0.1:5181/', frontend)]);
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('response', response => { if (response.status() >= 400) evidence.http_errors.push({ status: response.status(), url: response.url() }); });
  page.on('pageerror', error => evidence.page_errors.push(error.message));
  page.on('requestfailed', request => evidence.failed_requests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('console', message => { if (message.type() === 'error') evidence.console_errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5181/login');
  const notice = page.getByTestId('archive-notice');
  await notice.waitFor({ state: 'visible' });
  assert.match(await notice.innerText(), /历史版本 · Kimi 版/);
  const links = await notice.locator('a').evaluateAll(nodes => nodes.map(n => ({ text: n.textContent, href: n.href, rel: n.rel })));
  assert.equal(links.length, 2);
  assert(links[0].href.endsWith('/systems/project-ops/README.md'));
  assert(links[1].href.includes('/docs/'));
  assert(links.every(link => link.rel.includes('noopener')));
  evidence.checks.push('Desktop login shows archive notice and verified mainline/documentation destinations');
  await page.setViewportSize({ width: 375, height: 812 });
  assert(await notice.isVisible());
  const noticeWidth = await notice.evaluate(node => ({ width: node.scrollWidth, viewport: document.documentElement.clientWidth }));
  assert(noticeWidth.width <= noticeWidth.viewport, JSON.stringify(noticeWidth));
  await page.screenshot({ path: path.join(temp, 'mobile-login.png'), fullPage: true });
  evidence.checks.push('375px login archive notice wraps within viewport');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel('密码', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await page.getByText('用户名或密码错误', { exact: true }).waitFor();
  evidence.checks.push('Wrong password is rejected in the existing login UI');
  await page.getByLabel('密码', { exact: true }).fill('Admin@123456');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await page.waitForURL('http://127.0.0.1:5181/');
  await notice.waitFor({ state: 'visible' });
  await page.getByRole('menuitem', { name: /风险/ }).click();
  await page.getByText('浏览器合成风险', { exact: true }).waitFor();
  await page.getByRole('button', { name: /跟\s*进/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('textarea').fill('浏览器合成跟进');
  await dialog.locator('input[type=date]').fill('2030-01-02');
  const saved = page.waitForResponse(response => response.url().endsWith('/followups') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: /确\s*定/ }).click();
  assert.equal((await saved).status(), 201);
  await page.getByText('已跟进', { exact: true }).waitFor();
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const risks = await page.request.get('http://127.0.0.1:8101/api/v1/risks', { headers: { Authorization: `Bearer ${token}` } });
  const risk = (await risks.json()).find(r => r.title === '浏览器合成风险');
  assert.equal(risk.status, '跟进中');
  assert.equal(risk.followups[0].promise_date, '2030-01-02');
  evidence.checks.push('Real browser risk followup saves and roundtrips its ISO promise date');
  await page.getByRole('menuitem', { name: /数据导入/ }).click();
  await page.locator('input[type=file]').setInputFiles(path.join(temp, 'synthetic.xlsx'));
  await page.getByText('新增 1 / 更新 0 / 跳过合计行 1 / 错误 1', { exact: true }).waitFor();
  await page.getByText('编号 UI-BAD 缺少项目名称', { exact: true }).waitFor();
  await page.locator('input[type=file]').setInputFiles(path.join(temp, 'synthetic.xlsx'));
  await page.getByText('新增 0 / 更新 1 / 跳过合计行 1 / 错误 1', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(temp, 'desktop-import.png'), fullPage: true });
  evidence.checks.push('Real browser import reports one valid, one summary and one missing-name row; retry updates without duplicate creation');
  assert(await notice.isVisible());
  assert.deepEqual(evidence.page_errors, []);
  assert.deepEqual(evidence.failed_requests, []);
  evidence.temp_artifacts = temp;
  evidence.status = 'passed';
})().catch(error => { evidence.status = 'failed'; evidence.failure = error.stack; process.exitCode = 1; })
  .finally(async () => {
    if (browser) await browser.close();
    for (const child of processes) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
    await Promise.all(processes.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => {
      const timer = setTimeout(resolve, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    })));
    console.log(JSON.stringify(evidence, null, 2));
  });
