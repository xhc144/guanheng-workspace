import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { openDatabase } from "../../../systems/project-ops/lib/db.ts";
import { createSession, hashPassword } from "../../../systems/project-ops/lib/auth.ts";
import { accrueCommissions, createCommissionPayout } from "../../../systems/project-ops/lib/commissions.ts";
import { createReceiptWithAllocations, voidFinanceRecord } from "../../../systems/project-ops/lib/finance.ts";

const startedAt = new Date().toISOString();
const project = fileURLToPath(new URL("../../../systems/project-ops/", import.meta.url));
const playwright = process.env.WP09_PLAYWRIGHT_MODULE ?? "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const executablePath = process.env.WP09_CHROMIUM ?? "/usr/bin/chromium";
assert.ok(existsSync(playwright) && existsSync(executablePath), "缺少已安装的Playwright或Chromium，未运行浏览器验收");
assert.ok(existsSync(join(project, ".next/BUILD_ID")), "请先完成生产构建");
const { chromium } = await import(playwright), root = mkdtempSync(join(tmpdir(), "wp09-browser-"));
const originalData = existsSync(join(project, "data"));
let server, browser, db;
const failures = [], messages = [], checks = [], routerCancellations = [], resources = [], statuses = new WeakMap();
const record = (check, details = {}) => { checks.push({ check, ...details }); console.log(JSON.stringify({ check, ...details })); };
try {
  cpSync(join(project, ".next/standalone"), root, { recursive: true, verbatimSymlinks: true });
  cpSync(join(project, ".next/static"), join(root, ".next/static"), { recursive: true });
  mkdirSync(join(root, "data")); db = openDatabase(join(root, "data/wp09-synthetic.db"));
  const password = "Synthetic-WP09-Only-2026";
  db.exec(`INSERT INTO departments(id,name) VALUES('d1','纯合成交付部');
    INSERT INTO customers(id,name) VALUES('c1','纯合成浏览器客户');
    INSERT INTO projects(id,name,customer_id,department_id) VALUES('p1','纯合成提成验收项目','c1','d1');
    INSERT INTO contracts(id,number,name,customer_id,amount_cents) VALUES('ct1','SYNTHETIC-CT-09','纯合成合同','c1',1000000);
    INSERT INTO contract_projects(contract_id,project_id) VALUES('ct1','p1');
    INSERT INTO receivables(id,contract_id,project_id,name,category,amount_cents,due_date) VALUES('r1','ct1','p1','纯合成蓝图款','蓝图款',100000,'2026-10-01');`);
  for (const [id, name, role] of [["admin", "虚构管理员", "ADMIN"], ["u1", "虚构甲", "PROJECT_MEMBER"], ["u2", "虚构乙", "PROJECT_MEMBER"]])
    db.prepare("INSERT INTO users(id,username,name,password_hash,role,department_id) VALUES(?,?,?,?,?,'d1')").run(id, id, name, hashPassword(password), role);
  db.exec("INSERT INTO project_members(project_id,user_id,commission_basis_points) VALUES('p1','u1',300),('p1','u2',500)");
  const admin = { id: "admin", username: "admin", name: "虚构管理员", role: "ADMIN", departmentId: "d1", email: null };
  const paidIds = accrueCommissions(db, admin, { projectId: "p1", sourceType: "CONTRACT", sourceId: "ct1", grossCents: 0, releaseCondition: "蓝图款" });
  const receiptId = createReceiptWithAllocations(db, { customerId: "c1", amountCents: 100000, receivedDate: "2026-10-01", idempotencyKey: "synthetic-browser", allocations: [{ receivableId: "r1", amountCents: 100000 }] });
  const batch = createCommissionPayout(db, { accrualIds: paidIds, payoutDate: "2026-10-02", createdBy: "admin" });
  voidFinanceRecord(db, { kind: "receipts", id: receiptId, reason: "纯合成已发条件失效" });
  const unpaid = accrueCommissions(db, admin, { projectId: "p1", sourceType: "SETTLEMENT", sourceId: "SYNTHETIC-UNPAID-09", grossCents: 200000, taxCents: 10000, businessFeeCents: 5000 });
  accrueCommissions(db, admin, { projectId: "p1", sourceType: "SETTLEMENT", sourceId: "SYNTHETIC-BLOCKED-09", grossCents: 100000, releaseCondition: "蓝图款" });
  const cookie = createSession(db, "u1").token;
  const port = await new Promise((resolve, reject) => { const probe = createServer(); probe.on("error", reject); probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close(() => resolve(port)); }); });
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "", base = `http://127.0.0.1:${port}${basePath}`;
  server = spawn(process.execPath, [join(root, "server.js")], { cwd: root, env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", DATABASE_FILENAME: "wp09-synthetic.db", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", chunk => messages.push(String(chunk))); server.stderr.on("data", chunk => messages.push(String(chunk)));
  let ready = false;
  for (let i = 0; i < 100; i++) { try { const response = await fetch(`${base}/login`); if (response.ok) { ready = true; break; } } catch { /* local startup */ } await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, `临时服务器未启动：${messages.join("")}`);
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
  async function navigate(url) { await page.waitForLoadState("networkidle"); await page.goto(url); await page.waitForLoadState("networkidle"); }
  page.on("pageerror", error => failures.push(error.message));
  page.on("console", message => { if (message.type() === "error") failures.push(message.text()); });
  page.on("response", response => { statuses.set(response.request(), response.status()); if (response.status() >= 400) resources.push({ status: response.status(), path: new URL(response.url()).pathname }); });
  page.on("requestfailed", request => {
    const failure = request.failure()?.errorText, url = new URL(request.url()), status = statuses.get(request);
    // Next cancels speculative RSC reads and completed action streams. Keep these visible and narrowly classified.
    const prefetch = request.method() === "GET" && url.searchParams.has("_rsc") && !request.isNavigationRequest();
    const completedAction = request.method() === "POST" && Boolean(request.headers()["next-action"]) && status === 200;
    if (failure === "net::ERR_ABORTED" && (prefetch || completedAction)) routerCancellations.push({ method: request.method(), path: url.pathname, status: status ?? null, kind: prefetch ? "RSC预取取消" : "已返回200的Action流取消" });
    else failures.push(`${request.method()} ${url.pathname} ${failure}`);
  });
  await navigate(`${base}/login`); await page.getByLabel("用户名或邮箱").fill("admin"); await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click(); await page.waitForURL(base + "/"); await page.waitForLoadState("networkidle");
  await navigate(`${base}/commissions?month=`); await page.getByRole("heading", { name: "提成管理", exact: true }).waitFor();
  assert.equal(await page.locator("table tbody tr").count(), 6); assert.ok(await page.getByText("异常待复核：", { exact: false }).count() >= 2);
  await page.getByRole("link", { name: batch.payoutId, exact: true }).click(); await page.waitForURL(/payoutId=/); await page.waitForLoadState("networkidle"); assert.equal(await page.locator("table tbody tr").count(), 2);
  record("desktop-batch-drilldown", { visibleItems: 2 });
  for (const width of [375, 768, 1440]) {
    await navigate(`${base}/commissions?month=`); await page.setViewportSize({ width, height: 1000 }); await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `${width}px整页横向溢出`);
    if (width === 375) { assert.equal(await page.locator('div[aria-label="提成记录"] article:visible').count(), 6); assert.equal(await page.locator("table:visible").count(), 0); }
    record("viewport", { width, horizontalOverflow: overflow });
  }
  await page.setViewportSize({ width: 375, height: 1000 });
  const card = page.locator('div[aria-label="提成记录"] article').filter({ hasText: "SYNTHETIC-UNPAID-09" }).filter({ hasText: "虚构甲" });
  await card.getByRole("checkbox").check(); await page.getByLabel("批次备注", { exact: true }).fill("纯合成手机发放");
  await page.getByRole("button", { name: "生成发放批次", exact: true }).click(); await page.getByRole("status").filter({ hasText: "发放批次已生成" }).waitFor();
  assert.equal(db.prepare("SELECT status FROM commission_accruals WHERE id=?").get(unpaid.find(id => db.prepare("SELECT user_id FROM commission_accruals WHERE id=?").get(id).user_id === "u1")).status, "PAID");
  record("mobile-payout", { payoutCount: Number(db.prepare("SELECT COUNT(*) n FROM commission_payouts").get().n) });
  const remaining = page.locator('div[aria-label="提成记录"] article').filter({ hasText: "SYNTHETIC-UNPAID-09" }).filter({ hasText: "虚构乙" });
  await remaining.getByRole("checkbox").check(); await page.getByLabel("批次备注", { exact: true }).fill("失败后保留备注");
  db.exec("CREATE TRIGGER reject_browser_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'synthetic browser audit failure'); END");
  await page.getByRole("button", { name: "生成发放批次", exact: true }).click(); await page.getByRole("status").filter({ hasText: "提成操作失败" }).waitFor();
  assert.equal(await page.getByLabel("批次备注", { exact: true }).inputValue(), "失败后保留备注"); assert.equal(await remaining.getByRole("checkbox").isChecked(), true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM commission_payouts").get().n, 2); db.exec("DROP TRIGGER reject_browser_audit"); record("mobile-failure-retains-input-and-rolls-back");
  await remaining.getByRole("checkbox").uncheck(); await remaining.getByText("作废", { exact: true }).click();
  await remaining.getByLabel("作废原因").fill("纯合成手机作废"); await remaining.getByRole("button", { name: "确认作废", exact: true }).click();
  await remaining.getByText("已作废", { exact: true }).waitFor(); record("mobile-void-with-audit");
  await navigate(`${base}/commissions?month=&status=REVIEW`); assert.equal(await page.locator('div[aria-label="提成记录"] article').count(), 2);
  await navigate(`${base}/commissions?month=`);
  await page.locator("details.form-disclosure>summary").click();
  await page.getByLabel("计提项目", { exact: true }).fill("纯合成提成验收项目 · 纯合成浏览器客户");
  await page.getByLabel("计提来源", { exact: true }).selectOption("SETTLEMENT");
  await page.getByLabel("结算单号", { exact: true }).fill("SYNTHETIC-FORM-09");
  await page.getByLabel("结算金额（元）", { exact: true }).fill("100.01");
  await page.getByLabel("代理费（元）", { exact: true }).fill("-1");
  await page.getByLabel("结算单号和结算金额已经人工核对", { exact: true }).check();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "375px展开结算表单后不得横向溢出");
  await page.getByRole("button", { name: "计算并计提", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "金额格式不正确" }).waitFor();
  assert.equal(await page.getByLabel("结算单号", { exact: true }).inputValue(), "SYNTHETIC-FORM-09");
  assert.equal(await page.getByLabel("结算金额（元）", { exact: true }).inputValue(), "100.01");
  await page.getByLabel("代理费（元）", { exact: true }).fill("0");
  await page.getByRole("button", { name: "计算并计提", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已为 2 名成员计提" }).waitFor();
  assert.deepEqual(db.prepare("SELECT commission_cents FROM commission_accruals WHERE source_id='SYNTHETIC-FORM-09' ORDER BY user_id").all().map(row => row.commission_cents), [300,500]);
  assert.equal(await page.getByLabel("计提来源", { exact: true }).inputValue(), "SETTLEMENT");
  assert.equal(await page.getByLabel("结算单号和结算金额已经人工核对", { exact: true }).isChecked(), true);
  await page.getByRole("button", { name: "计算并计提", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "该来源已计提" }).waitFor();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM commission_accruals WHERE source_id='SYNTHETIC-FORM-09'").get().n, 2);
  record("mobile-accrual-invalid-money-retains-input-zero-deduction-and-duplicate-rejected");
  await navigate(`${base}/commissions?month=1900-01`); await page.getByText("当前筛选下没有提成记录，可调整月份或状态。").waitFor(); record("empty-month");
  const personal = await browser.newContext({ viewport: { width: 375, height: 900 } });
  await personal.addCookies([{ name: "pms_session", value: cookie, url: base + "/" }]); const memberPage = await personal.newPage();
  await memberPage.goto(`${base}/commissions?month=`); assert.equal(await memberPage.getByText("虚构乙", { exact: true }).count(), 0);
  assert.equal(await memberPage.getByRole("button", { name: "生成发放批次" }).count(), 0);
  const denied = await personal.request.get(`${base}/api/commission-payouts?month=&userId=u2`); assert.equal(denied.status(), 403);
  record("member-self-only-and-cross-user-denied"); await personal.close();
  await page.waitForLoadState("networkidle"); assert.deepEqual(failures, []); assert.deepEqual(resources, []);
  assert.ok(routerCancellations.every(event => event.kind === "RSC预取取消" || event.status === 200)); assert.equal(existsSync(join(project, "data")), originalData);
  const result = { status: "PASS", startedAt, finishedAt: new Date().toISOString(), startedFromBuild: readFileSync(join(project, ".next/BUILD_ID"), "utf8").trim(), basePath, cwd: root, database: join(root, "data/wp09-synthetic.db"), checks, consoleErrors: failures.length, httpErrors: resources.length, routerCancellations, sourceDataUntouched: true };
  const output = process.env.WP09_BROWSER_RESULT ?? "/tmp/wp09-browser-result.json"; writeFileSync(output, JSON.stringify(result, null, 2) + "\n"); record("strict-browser-pass", { checks: checks.length, resultPath: output });
} catch (error) { console.error(messages.join("")); throw error; }
finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await new Promise(resolve => server.once("exit", resolve)); }
  if (db?.isOpen) db.close(); rmSync(root, { recursive: true, force: true });
}
