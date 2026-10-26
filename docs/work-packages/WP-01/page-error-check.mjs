// 真实数据库故障/恢复回归。只启动本次构建的临时副本，不连接已有应用或真实数据库。
// node --experimental-strip-types docs/work-packages/WP-01/page-error-check.mjs <playwright/index.mjs> <chromium路径>
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDatabase } from "../../../systems/project-ops/lib/db.ts";
import { hashPassword } from "../../../systems/project-ops/lib/auth.ts";

assert.equal(process.argv.length, 4, "请指定已安装的Playwright模块和Chromium路径");
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const project = fileURLToPath(new URL("../../../systems/project-ops/", import.meta.url));
const runtime = mkdtempSync(join(tmpdir(), "guanheng-wp01-private-synthetic-"));
cpSync(join(project, ".next/standalone"), runtime, { recursive: true, verbatimSymlinks: true });
cpSync(join(project, ".next/static"), join(runtime, ".next/static"), { recursive: true });
mkdirSync(join(runtime, "screenshots"));
const filename = "wp01-page-fault-synthetic.db";
const databasePath = join(runtime, "data", filename);
const databaseBackup = join(runtime, "data/wp01-page-valid-synthetic.db");
const db = openDatabase(databasePath);
const password = "Wp01-Page-Synthetic-Only-2026!";
const sentinel = "WP01_PAGE_SYNTHETIC_SECRET_NEVER_RETURN";
db.prepare("INSERT INTO users (id,username,name,password_hash,role) VALUES (?,?,?,?,?)")
  .run("wp01-admin", "wp01_fault_admin", "页面故障合成管理员", hashPassword(password), "ADMIN");
db.close();
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
let server, browser;
let serverOutput = "";
const results = [];

async function startServer() {
  server = spawn(process.execPath, [join(runtime, "server.js")], {
    cwd: runtime, env: {
      PATH: process.env.PATH, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1",
      DATABASE_FILENAME: filename, SESSION_SECRET: sentinel, SMTP_PASSWORD: sentinel,
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", chunk => { serverOutput += chunk; });
  server.stderr.on("data", chunk => { serverOutput += chunk; });
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(`${base}/login`)).ok) return; } catch { /* 等待本机服务。 */ }
    assert.equal(server.exitCode, null, "临时服务意外退出");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("临时服务未在20秒内就绪");
}

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise(resolve => server.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
}

function assertPrivateValuesAbsent(content) {
  for (const value of [sentinel, password, runtime, "unable to open database file", "node:sqlite", "at getDb", "at initializeSchema"]) {
    assert.equal(content.includes(value), false, "客户端不得出现合成配置、私有目录或原始数据库错误/堆栈");
  }
}

try {
  await startServer();
  browser = await chromium.launch({ executablePath: process.argv[3], headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", error => consoleErrors.push(error.message));
  let runtimeRequests = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/runtime-health") runtimeRequests++; });
  await page.goto(`${base}/login`);
  await page.getByLabel("用户名或邮箱").fill("wp01_fault_admin");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(`${base}/`);
  await page.locator(".app-shell").waitFor();
  await page.goto(`${base}/runtime-health`);
  await page.getByRole("heading", { name: "运行版本检查通过", exact: true }).waitFor();
  const cookie = (await context.cookies()).find(cookie => cookie.name === "pms_session");
  assert.ok(cookie?.httpOnly && cookie.secure);
  const headers = { cookie: `${cookie.name}=${cookie.value}` };
  results.push({ check: "真实合成账号登录和正常诊断页面", status: "通过" });

  // 停止临时服务后保存合成库，在同一路径放一个目录，让真实 SQLite 构造明确失败。
  await stopServer();
  renameSync(databasePath, databaseBackup);
  mkdirSync(databasePath);
  await startServer();
  const api = await context.request.get(`${base}/api/runtime-health`, { headers });
  assert.equal(api.status(), 500);
  assert.deepEqual(await api.json(), { error: "运行诊断暂时无法读取，请稍后重试或联系管理员" });
  results.push({ check: "真实SQLite打不开时API返回中文500", status: "通过" });

  const failure = await page.goto(`${base}/runtime-health`);
  assert.ok([200, 500].includes(failure.status()), "页面不得被错误跳转为登录或404");
  const fallback = page.getByRole("heading", { name: "运行诊断暂时无法读取", exact: true });
  let visible = false;
  try { await fallback.waitFor({ timeout: 5_000 }); visible = true; } catch { /* 在下面保留真实失败断言。 */ }
  const content = await page.content();
  const text = await page.locator("body").innerText();
  assertPrivateValuesAbsent(content);
  assertPrivateValuesAbsent(consoleErrors.join("\n"));
  console.log(JSON.stringify({ phase: "故障页面", runtime, pageStatus: failure.status(), chineseFallbackVisible: visible,
    frameworkGenericVisible: /Application error|server-side exception|This page couldn.t load|A server error occurred/.test(text), privateValuesObserved: false }, null, 2));
  await page.screenshot({ path: join(runtime, "screenshots/failure-before-recovery.png"), fullPage: true });
  assert.equal(visible, true, "真实数据库故障应显示本域中文错误边界");

  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await fallback.waitFor();
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
    assert.ok(dimensions.body <= width && dimensions.document <= width, `${width}px故障页横向溢出`);
    const retry = page.getByRole("button", { name: "重试诊断", exact: true });
    const box = await retry.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44);
    await retry.focus();
    assert.equal(await retry.evaluate(element => document.activeElement === element), true);
    await page.screenshot({ path: join(runtime, `screenshots/failure-${width}.png`), fullPage: true });
    results.push({ check: `${width}px真实故障页、无溢出、44px按钮及键盘焦点`, status: "通过", dimensions });
  }

  const retry = page.getByRole("button", { name: "重试诊断", exact: true });
  let before = runtimeRequests;
  const failedRetry = page.waitForResponse(response => new URL(response.url()).pathname === "/runtime-health"
    && response.request().method() === "GET");
  await retry.click();
  const failedResponse = await failedRetry;
  await failedResponse.finished();
  assert.ok([200, 500].includes(failedResponse.status()));
  assertPrivateValuesAbsent(await failedResponse.text());
  assert.ok(runtimeRequests > before, "重试必须重新请求服务器");
  await fallback.waitFor();
  assert.equal(await page.getByRole("heading", { name: "运行版本检查通过", exact: true }).count(), 0);
  results.push({ check: "故障仍存在时等待真实重取响应完成后保持中文失败，不伪报成功", status: "通过", responseStatus: failedResponse.status() });

  // 只恢复本工具自己创建并备份的合成库；不重启服务，验证 retry() 重新取数。
  rmdirSync(databasePath);
  renameSync(databaseBackup, databasePath);
  before = runtimeRequests;
  await retry.click();
  await page.getByRole("heading", { name: "运行版本检查通过", exact: true }).waitFor({ timeout: 15_000 });
  assert.ok(runtimeRequests > before);
  assert.equal(await fallback.count(), 0);
  assert.equal(await page.locator('section[aria-labelledby="runtime-versions"] li').count(), 5);
  assertPrivateValuesAbsent(await page.content());
  assertPrivateValuesAbsent(consoleErrors.join("\n"));
  const recoveredApi = await context.request.get(`${base}/api/runtime-health`, { headers });
  assert.equal(recoveredApi.status(), 200);
  assert.equal((await recoveredApi.json()).status, "ok");
  results.push({ check: "恢复合成库后不重启服务，点击重试真实恢复页面和API200", status: "通过" });
  console.log(JSON.stringify({ runtime, base, results, faultConsoleErrors: consoleErrors.length,
    note: "故障场景预期含500及框架错误；仅断言它们不包含私有信息，不替代原零错误严检" }, null, 2));
} finally {
  if (browser) await browser.close();
  await stopServer();
  writeFileSync(join(runtime, "server.log"), serverOutput.replaceAll(sentinel, "[合成配置已隐藏]"));
  console.log(`临时故障服务已停止；合成数据和截图：${runtime}`);
}
