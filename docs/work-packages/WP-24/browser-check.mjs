// 真实浏览器验收：冻结构建、临时cwd、纯合成账号；不连接部署实例。
// node --experimental-strip-types docs/work-packages/WP-24/browser-check.mjs <playwright/index.mjs> <chromium> [basePath]
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDatabase } from "../../../systems/project-ops/lib/db.ts";
import { hashPassword } from "../../../systems/project-ops/lib/auth.ts";

assert.ok(process.argv.length === 4 || process.argv.length === 5, "请指定已安装的Playwright模块和Chromium，可选basePath");
const basePath = process.argv[4] ?? "";
assert.match(basePath, /^(?:\/[a-zA-Z0-9_-]+)*$/);
const playwrightModule = await import(pathToFileURL(process.argv[2]).href);
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
assert.ok(chromium, "指定的已安装Playwright模块未提供chromium");
const project = fileURLToPath(new URL("../../../systems/project-ops/", import.meta.url));
const runtime = mkdtempSync(join(tmpdir(), "guanheng-wp24-browser-"));
cpSync(join(project, ".next/standalone"), runtime, { recursive: true, verbatimSymlinks: true });
cpSync(join(project, ".next/static"), join(runtime, ".next/static"), { recursive: true });
if (existsSync(join(project, "public"))) cpSync(join(project, "public"), join(runtime, "public"), { recursive: true });
mkdirSync(join(runtime, "screenshots"));
const password = "Wp24-Synthetic-Only-2026!", sentinel = "WP24_SYNTHETIC_CONFIG_NEVER_RETURN";
const database = openDatabase(join(runtime, "data/wp24-synthetic.db"));
for (const role of ["ADMIN", "FINANCE", "DEPARTMENT_MANAGER", "PROJECT_MEMBER"]) {
  database.prepare("INSERT INTO users(id,username,name,password_hash,role) VALUES(?,?,?,?,?)")
    .run(role, `wp24_${role.toLowerCase()}`, "WP24纯合成验收人员", hashPassword(password), role);
}
database.close();
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = `http://127.0.0.1:${port}${basePath}`;
const server = spawn(process.execPath, [join(runtime, "server.js")], {
  cwd: runtime, env: { PATH: process.env.PATH, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1",
    DATABASE_FILENAME: "wp24-synthetic.db", SESSION_SECRET: sentinel, SMTP_PASSWORD: sentinel },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "", browser, context, page, diagnosticPage, phase = "startup", expectedStop = false;
const timeline = [], started = performance.now();
const safe = value => String(value).replaceAll(sentinel, "[合成配置已隐藏]").replace(/pms_session=[^\s;]+/g, "pms_session=[合成会话已隐藏]");
const mark = (event, details = {}) => timeline.push({ at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), phase, event, ...details });
const serverState = () => {
  let processStatus = [];
  try { processStatus = readFileSync(`/proc/${server.pid}/status`, "utf8").split("\n").filter(line => /^(State|VmRSS|VmPeak|Threads):/.test(line)); } catch { /* Exited process has no status file. */ }
  return { pid: server.pid, exitCode: server.exitCode, signalCode: server.signalCode, killed: server.killed, expectedStop, loadavg: loadavg(), processStatus };
};
server.on("exit", (code, signal) => mark("server-exit", { code, signal, expectedStop }));
server.on("error", error => mark("server-error", { message: safe(error.message) }));
async function api(ctx, method, url, options) {
  const path = new URL(url).pathname, at = performance.now(); mark("api-start", { method, path });
  try {
    const response = await ctx.request[method](url, options);
    mark("api-response", { method, path, status: response.status(), durationMs: Math.round(performance.now() - at), connection: response.headers().connection, keepAlive: response.headers()["keep-alive"] });
    return response;
  } catch (error) { mark("api-failed", { method, path, durationMs: Math.round(performance.now() - at), message: safe(error.message), server: serverState() }); throw error; }
}
function observePage(target, name) {
  target.on("request", request => mark("page-request", { page: name, method: request.method(), path: new URL(request.url()).pathname, resourceType: request.resourceType() }));
  target.on("response", response => mark("page-response", { page: name, path: new URL(response.url()).pathname, status: response.status() }));
  target.on("requestfailed", request => mark("page-request-failed", { page: name, path: new URL(request.url()).pathname, failure: request.failure()?.errorText }));
  target.on("framenavigated", frame => { if (frame === target.mainFrame()) mark("page-navigated", { page: name, url: frame.url() }); });
}
async function captureFailure(error) {
  const failure = { phase, message: safe(error.stack ?? error.message), server: serverState() };
  const target = diagnosticPage ?? page;
  try {
    if (target && !target.isClosed()) {
      failure.page = { url: target.url(), headings: await target.locator("h1,h2,h3").allTextContents(), mainText: (await target.locator("main").innerText({ timeout: 1000 })).slice(0,16000) };
      await target.screenshot({ path: join(runtime, "screenshots/failure.png"), fullPage: true, timeout: 2000 });
    }
  } catch (captureError) { failure.pageCaptureError = safe(captureError.message); }
  try {
    const cookie = context && (await context.cookies()).find(item => item.name === "pms_session");
    if (cookie) {
      const diagnostic = await context.request.get(`${base}/api/runtime-health`, { headers: { cookie: `${cookie.name}=${cookie.value}` }, timeout: 2000 });
      failure.runtimeApiAfterFailure = { status: diagnostic.status(), body: await diagnostic.json() };
    }
  } catch (diagnosticError) { failure.runtimeApiAfterFailure = { error: safe(diagnosticError.message) }; }
  mark("verification-failure", failure); console.log(JSON.stringify({ runtime, failure }, null, 2));
}
server.stdout.on("data", chunk => { serverOutput += chunk; });
server.stderr.on("data", chunk => { serverOutput += chunk; });
const results = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { ready = (await fetch(`${base}/login`)).ok; } catch { /* 仅等待临时进程。 */ }
    if (ready) break;
    if (server.exitCode !== null) throw new Error("临时服务启动失败");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "临时服务20秒内未就绪");
  browser = await chromium.launch({ executablePath: process.argv[3], headless: true });
  const errors = [], resources = [];
  context = await browser.newContext();
  page = await context.newPage(); diagnosticPage = page; observePage(page, "normal");
  browser.on("disconnected", () => mark("browser-disconnected", { expectedStop }));
  page.on("pageerror", error => errors.push({ message: error.message }));
  page.on("console", message => { if (message.type() === "error") errors.push({ message: message.text(), location: message.location().url }); });
  page.on("response", response => { if (response.status() >= 400) resources.push({ status: response.status(), path: new URL(response.url()).pathname }); });

  for (const path of ["integration-health", "runtime-health"]) {
    assert.equal((await api(context, "get", `${base}/api/${path}`)).status(), 401);
    assert.equal((await api(context, "head", `${base}/api/${path}`)).status(), 401);
    await page.goto(`${base}/${path}`); assert.equal(new URL(page.url()).pathname, `${basePath}/login`);
  }
  const favicon = await page.evaluate(async () => {
    const icon = document.querySelector('link[rel~="icon"]');
    if (!icon) throw new Error("页面缺少favicon元数据");
    const href = icon.getAttribute("href"), url = new URL(href, location.href);
    const response = await fetch(url, { cache: "no-store" });
    return { href, path: url.pathname, status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  });
  assert.equal(favicon.path, `${basePath}/favicon.ico`); assert.equal(favicon.status, 204); assert.equal(favicon.bytes, 0);
  assert.equal((await api(context, "head", `${base}/favicon.ico`)).status(), 204);
  results.push({ check: "页面元数据解析正确，真实浏览器请求favicon204且零字节，HEAD204", status: "通过", favicon });
  results.push({ check: "匿名页面转登录，两个诊断API GET/HEAD均401", status: "通过" });
  async function login(role) {
    phase = `login-${role}`; mark("phase-start");
    await context.clearCookies(); await page.goto(`${base}/login`);
    await page.getByLabel("用户名或邮箱").fill(`wp24_${role.toLowerCase()}`);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.waitForURL(url => url.origin === new URL(base).origin && [basePath || "/", `${basePath}/`].includes(url.pathname));
    await page.locator(".app-shell").waitFor();
  }
  async function sessionHeaders() {
    const cookie = (await context.cookies()).find(item => item.name === "pms_session");
    assert.ok(cookie?.httpOnly && cookie.secure); return { cookie: `${cookie.name}=${cookie.value}` };
  }
  await login("ADMIN");
  const headers = await sessionHeaders();
  const response = await api(context, "get", `${base}/api/integration-health`, { headers });
  assert.equal(response.status(), 200); assert.equal(response.headers()["cache-control"], "private, no-store");
  assert.ok(response.headers()["vary"].split(",").map(value => value.trim().toLowerCase()).includes("cookie"));
  const health = await response.json();
  assert.equal(health.phase, "G0"); assert.equal(health.schema.tableCount, 36);
  assert.deepEqual(health.migrationRunner, { status: "NOT_REGISTERED", applied: null });
  assert.equal(health.providers.budget, "NOT_CONFIGURED");
  assert.deepEqual(health.providers.approvalSubjects, ["PROJECT", "WORK_ITEM"]);
  assert.equal(health.modules.length, 18);
  assert.equal((await api(context, "post", `${base}/api/integration-health`, { headers })).status(), 405);
  for (const module of health.modules) {
    const pageResponse = await api(context, "get", `${base}${module.navigation.href}`, { headers });
    assert.equal(pageResponse.status(), 200, `登记模块实际页面不可达：${module.id}`);
  }
  results.push({ check: "管理员API实际返回G0、36表、未注册runner/预算，18个登记页面均HTTP200，POST405", status: "通过" });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`${base}/integration-health`);
    await page.getByRole("heading", { name: "G0 地基 · 基线模块已登记", exact: true }).waitFor();
    assert.equal(await page.locator("main li.work-panel").count(), health.modules.length);
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(dimensions.document <= width && dimensions.body <= width, JSON.stringify(dimensions));
    const refresh = page.getByRole("button", { name: "重新检查", exact: true });
    const box = await refresh.boundingBox(); assert.ok(box.height >= 44 && box.width >= 44);
    await refresh.focus(); assert.equal(await refresh.evaluate(element => document.activeElement === element), true);
    const before = await page.locator("time").getAttribute("datetime"); await refresh.click();
    await page.waitForFunction(value => document.querySelector("time")?.getAttribute("datetime") !== value, before);
    assert.doesNotMatch(await page.content(), new RegExp(sentinel));
    await page.screenshot({ path: join(runtime, `screenshots/integration-${width}.png`), fullPage: true });
    const nav = width <= 780 ? page.locator(".mobile-nav") : page.locator(".desktop-nav");
    if (width <= 780) await nav.locator("summary").click();
    phase = `runtime-navigation-${width}`; mark("phase-start");
    await nav.getByRole("link", { name: "运行诊断", exact: true }).click();
    await page.getByRole("heading", { name: "运行版本检查通过", exact: true }).waitFor();
    assert.ok(new URL(page.url()).pathname.endsWith("/runtime-health"));
    if (width <= 780 && !await nav.getAttribute("open")) await nav.locator("summary").click();
    await nav.getByRole("link", { name: "集成状态", exact: true }).click();
    await page.getByRole("heading", { name: "G0 地基 · 基线模块已登记", exact: true }).waitFor();
    results.push({ check: `${width}px真实布局、44px按钮、键盘焦点、刷新时间及两个管理员导航可操作`, status: "通过", dimensions });
  }
  for (const role of ["FINANCE", "DEPARTMENT_MANAGER", "PROJECT_MEMBER"]) {
    await login(role);
    assert.equal(await page.getByRole("link", { name: "集成状态", exact: true }).count(), 0);
    assert.equal(await page.getByRole("link", { name: "运行诊断", exact: true }).count(), 0);
    const denied = await api(context, "get", `${base}/api/integration-health`, { headers: await sessionHeaders() });
    assert.equal(denied.status(), 403); assert.deepEqual(await denied.json(), { error: "仅管理员可查看集成状态" });
    await page.goto(`${base}/integration-health`);
    await page.getByRole("heading", { name: "仅管理员可查看集成状态", exact: true }).waitFor();
    assert.equal(await page.locator("time").count(), 0);
    assert.doesNotMatch(await page.locator("main").innerText(), /36|NOT_REGISTERED|G0|PROJECT|WORK_ITEM/);
    await page.getByRole("link", { name: "返回经营总览", exact: true }).click(); await page.locator(".app-shell").waitFor();
    results.push({ check: `${role}实际登录后API403、页面拒绝、不泄露目录，返回总览可操作`, status: "通过" });
  }
  // Dedicated controlled fault: only this temporary synthetic database is changed.
  // The main page's strict console collector remains untouched.
  await login("ADMIN");
  const faultContext = await browser.newContext({ storageState: await context.storageState(), viewport: { width: 375, height: 1000 } });
  await page.close(); // Prevent normal navigation prefetch while the isolated fault is active.
  const faultPage = await faultContext.newPage(), faultErrors = [], faultPageErrors = [], faultResources = [];
  diagnosticPage = faultPage; observePage(faultPage, "controlled-fault"); phase = "controlled-fault";
  faultPage.on("console", message => { if (message.type() === "error") faultErrors.push(message.text()); });
  faultPage.on("pageerror", error => faultPageErrors.push(error.message));
  faultPage.on("response", response => { if (response.status() >= 400) faultResources.push({ status: response.status(), path: new URL(response.url()).pathname }); });
  const faultDb = new DatabaseSync(join(runtime, "data/wp24-synthetic.db"));
  try {
    faultDb.exec("ALTER TABLE users RENAME COLUMN role TO wp24_synthetic_role");
    const failed = await api(faultContext, "get", `${base}/api/integration-health`, { headers: await sessionHeaders() });
    assert.equal(failed.status(), 500);
    assert.deepEqual(await failed.json(), { error: "集成状态暂时无法读取，请稍后重试或联系管理员" });
    await faultPage.goto(`${base}/integration-health`);
    await faultPage.getByRole("heading", { name: "集成状态暂时无法读取", exact: true }).waitFor();
    assert.doesNotMatch(await faultPage.locator("main").innerText(), /wp24_synthetic_role|no such column|SELECT|Error|digest/);
    const dimensions = await faultPage.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(dimensions.document <= 375);
    const retryButton = faultPage.getByRole("button", { name: "重新检查", exact: true });
    const retryBox = await retryButton.boundingBox(); assert.ok(retryBox.height >= 44 && retryBox.width >= 44);
    await retryButton.focus(); assert.equal(await retryButton.evaluate(element => document.activeElement === element), true);
    await faultPage.screenshot({ path: join(runtime, "screenshots/error-375.png"), fullPage: true });
  } finally {
    faultDb.exec("ALTER TABLE users RENAME COLUMN wp24_synthetic_role TO role"); faultDb.close();
  }
  await faultPage.getByRole("button", { name: "重新检查", exact: true }).click();
  await faultPage.getByRole("heading", { name: "G0 地基 · 基线模块已登记", exact: true }).waitFor();
  assert.equal((await api(faultContext, "get", `${base}/api/integration-health`, { headers: await sessionHeaders() })).status(), 200);
  assert.doesNotMatch(faultErrors.join("\n"), /wp24_synthetic_role|no such column|SELECT|WP24_SYNTHETIC_CONFIG/);
  assert.deepEqual(faultPageErrors, [], "预期的服务端故障不应导致未处理客户端异常");
  assert.ok(faultResources.every(response => response.status === 500 && response.path === `${basePath}/integration-health`), JSON.stringify(faultResources));
  results.push({ check: "纯临时库故障注入：API固定中文500、375px中文错误页、恢复后真实retry重取成功", status: "通过", expectedFaultConsoleCount: faultErrors.length });
  await faultContext.close();
  results.push({ check: "严格浏览器控制台与页面异常", status: errors.length ? "失败" : "通过", errors, resources });
  console.log(JSON.stringify({ runtime, base, results }, null, 2));
  assert.deepEqual(errors, [], "浏览器存在控制台错误或页面异常；保留favicon失败，不忽略断言");
  assert.deepEqual(resources, [], "正常页面存在>=400网络响应");
} catch (error) {
  await captureFailure(error);
  error.message = safe(error.message); error.stack = safe(error.stack);
  if (Array.isArray(error.log)) error.log = error.log.map(safe);
  throw error;
} finally {
  expectedStop = true; mark("cleanup-start", { server: serverState() });
  if (browser) await browser.close();
  const stopped = new Promise(resolve => server.once("exit", resolve));
  if (server.exitCode === null) { server.kill("SIGTERM"); await stopped; }
  writeFileSync(join(runtime, "server.log"), safe(serverOutput));
  mark("cleanup-complete", { server: serverState() });
  writeFileSync(join(runtime, "request-chain.json"), JSON.stringify(timeline, null, 2));
  console.log(`临时服务已停止；纯合成数据库与截图：${runtime}`);
}
