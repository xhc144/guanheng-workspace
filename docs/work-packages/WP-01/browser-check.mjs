// 补充浏览器验收工具；只使用合成账号和临时数据库，不连接已有运行实例。
// node --experimental-strip-types docs/work-packages/WP-01/browser-check.mjs <playwright/index.mjs> <chromium路径> [构建时的basePath]
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDatabase } from "../../../systems/project-ops/lib/db.ts";
import { hashPassword } from "../../../systems/project-ops/lib/auth.ts";

assert.ok(process.argv.length === 4 || process.argv.length === 5, "请指定本机已安装的Playwright模块和Chromium路径，可选构建时的basePath");
const basePath = process.argv[4] ?? "";
assert.match(basePath, /^(?:\/[a-zA-Z0-9_-]+)*$/, "basePath只能使用本机测试路径段且不以斜杠结尾");
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const project = fileURLToPath(new URL("../../../systems/project-ops/", import.meta.url));
const runtime = mkdtempSync(join(tmpdir(), "guanheng-wp01-browser-"));
cpSync(join(project, ".next/standalone"), runtime, { recursive: true, verbatimSymlinks: true });
cpSync(join(project, ".next/static"), join(runtime, ".next/static"), { recursive: true });
if (existsSync(join(project, "public"))) cpSync(join(project, "public"), join(runtime, "public"), { recursive: true });
mkdirSync(join(runtime, "screenshots"));
const password = "Wp01-Synthetic-Only-2026!";
const sentinel = "WP01_SYNTHETIC_CONFIG_NEVER_RETURN";
const database = openDatabase(join(runtime, "data/wp01-synthetic.db"));
for (const role of ["ADMIN", "FINANCE", "DEPARTMENT_MANAGER", "PROJECT_MEMBER"]) {
  database.prepare("INSERT INTO users (id,username,name,password_hash,role) VALUES (?,?,?,?,?)")
    .run(role, `wp01_${role.toLowerCase()}`, "WP01合成验收人员", hashPassword(password), role);
}
database.close();
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}${basePath}`;
const server = spawn(process.execPath, [join(runtime, "server.js")], {
  cwd: runtime, env: {
    PATH: process.env.PATH, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1",
    DATABASE_FILENAME: "wp01-synthetic.db", SESSION_SECRET: sentinel,
    SMTP_PASSWORD: sentinel, WP01_SYNTHETIC_SECRET: sentinel,
  }, stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "", browser;
server.stdout.on("data", chunk => { serverOutput += chunk; });
server.stderr.on("data", chunk => { serverOutput += chunk; });
const results = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { ready = (await fetch(`${base}/login`)).ok; } catch { /* 等待本机服务启动。 */ }
    if (ready) break;
    if (server.exitCode !== null) throw new Error("临时生产服务启动失败");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "临时生产服务未在20秒内就绪");
  browser = await chromium.launch({ executablePath: process.argv[3], headless: true });
  const errors = [];
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push({ message: message.text(), location: message.location().url }); });
  page.on("response", response => { if (response.status() >= 400) console.log(JSON.stringify({ resourceStatus: response.status(), path: new URL(response.url()).pathname })); });

  const anonymous = await context.request.get(`${base}/api/runtime-health`);
  assert.equal(anonymous.status(), 401);
  assert.deepEqual(await anonymous.json(), { error: "请先登录" });
  assert.equal((await context.request.head(`${base}/api/runtime-health`)).status(), 401);
  await page.goto(`${base}/runtime-health`);
  assert.equal(new URL(page.url()).pathname, `${basePath}/login`);
  results.push({ check: "未登录页面转登录、GET和HEAD均401", status: "通过" });

  async function login(role) {
    await context.clearCookies();
    await page.goto(`${base}/login`);
    await page.getByLabel("用户名或邮箱").fill(`wp01_${role.toLowerCase()}`);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.waitForURL(url => url.origin === new URL(base).origin
      && (url.pathname === (basePath || "/") || url.pathname === `${basePath}/`));
    await page.locator(".app-shell").waitFor();
  }

  // 生产cookie保持Secure/HttpOnly。Chromium允许本机HTTP回环，APIRequestContext不自动发送该Secure cookie。
  // 独立HTTP API检查显式使用刚刚真实登录签发的会话，既不修改cookie标志，也不输出会话值。
  async function sessionHeaders() {
    const cookie = (await context.cookies()).find(cookie => cookie.name === "pms_session");
    assert.ok(cookie?.httpOnly && cookie.secure, "生产登录应签发Secure/HttpOnly会话");
    return { cookie: `${cookie.name}=${cookie.value}` };
  }

  await login("ADMIN");
  const adminHeaders = await sessionHeaders();
  const allowed = await context.request.get(`${base}/api/runtime-health`, { headers: adminHeaders });
  assert.equal(allowed.status(), 200);
  assert.equal(allowed.headers()["cache-control"], "private, no-store");
  const body = await allowed.json();
  assert.equal(body.status, "ok");
  assert.equal(body.checks.length, 5);
  assert.ok(body.checks.every(check => check.actual === check.expected && check.status === "ok"));
  assert.doesNotMatch(JSON.stringify(body), /WP01_SYNTHETIC|password|token|SMTP|SESSION_SECRET|\/tmp|\/workspace/);
  assert.equal((await context.request.head(`${base}/api/runtime-health`, { headers: adminHeaders })).status(), 200);
  assert.equal((await context.request.post(`${base}/api/runtime-health`, { headers: adminHeaders, data: {} })).status(), 405);
  results.push({ check: "管理员真实登录后GET/HEAD通过、POST拒绝、响应白名单与合成secret隔离", status: "通过" });

  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const response = await page.goto(`${base}/runtime-health`);
    assert.equal(response.status(), 200);
    await page.getByRole("heading", { name: "运行版本检查通过", exact: true }).waitFor();
    assert.equal(await page.locator('section[aria-labelledby="runtime-versions"] li').count(), 5);
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth,
    }));
    assert.ok(dimensions.body <= width && dimensions.document <= width, `${width}px页面横向溢出`);
    const refresh = page.getByRole("button", { name: "重新检查", exact: true });
    const box = await refresh.boundingBox();
    assert.ok(box.height >= 44 && box.width >= 44, "刷新按钮触控尺寸不足");
    await refresh.focus();
    assert.equal(await refresh.evaluate(element => document.activeElement === element), true);
    const before = await page.locator("time").getAttribute("datetime");
    await refresh.click();
    await page.waitForFunction(value => document.querySelector("time")?.getAttribute("datetime") !== value, before);
    assert.equal(await page.getByRole("heading", { name: "运行版本检查通过", exact: true }).count(), 1);
    const html = await page.content();
    assert.doesNotMatch(html, /WP01_SYNTHETIC_CONFIG_NEVER_RETURN/);
    await page.screenshot({ path: join(runtime, `screenshots/runtime-${width}.png`), fullPage: true });
    results.push({ check: `${width}px真实布局、键盘焦点、44px触控、重新检查更新服务端时间`, status: "通过", dimensions });
  }

  for (const role of ["FINANCE", "DEPARTMENT_MANAGER", "PROJECT_MEMBER"]) {
    await login(role);
    const denied = await context.request.get(`${base}/api/runtime-health`, { headers: await sessionHeaders() });
    assert.equal(denied.status(), 403);
    assert.deepEqual(await denied.json(), { error: "仅管理员可查看运行诊断" });
    await page.goto(`${base}/runtime-health`);
    await page.getByRole("heading", { name: "仅管理员可查看运行诊断", exact: true }).waitFor();
    assert.equal(await page.locator("time").count(), 0);
    assert.doesNotMatch(await page.locator("main").innerText(), /Next.js|React|24.19.0/);
    results.push({ check: `${role}真实登录后API403且页面不显示版本`, status: "通过" });
  }
  results.push({ check: "浏览器控制台与页面异常", status: errors.length ? "失败" : "通过", errors });
  console.log(JSON.stringify({ runtime, base, results }, null, 2));
  assert.deepEqual(errors, [], "浏览器存在控制台错误或页面异常");
} finally {
  if (browser) await browser.close();
  const stopped = new Promise(resolve => server.once("exit", resolve));
  if (server.exitCode === null) { server.kill("SIGTERM"); await stopped; }
  writeFileSync(join(runtime, "server.log"), serverOutput.replaceAll(sentinel, "[合成配置已隐藏]"));
  console.log(`临时服务已停止；合成数据库与截图：${runtime}`);
}
