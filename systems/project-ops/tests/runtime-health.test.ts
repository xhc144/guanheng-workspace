import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server.js";
import manifest from "../package.json" with { type: "json" };
import { GET } from "../app/api/runtime-health/route.ts";
import { createSession } from "../lib/auth.ts";
import { openDatabase } from "../lib/db.ts";
import { checkNodeVersion, checkVersion, getRuntimeHealth, inspectRuntime } from "../lib/runtime-health.ts";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);

function installedVersion(name: string): string {
  try { return require(`${name}/package.json`).version; }
  catch {
    // 部分包不导出 package.json，从实际入口向上查找同名 manifest。
    let directory = dirname(require.resolve(name));
    while (directory !== parse(directory).root) {
      try {
        const metadata = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
        if (metadata.name === name) return metadata.version;
      } catch { /* 入口父目录未必含 manifest。 */ }
      directory = dirname(directory);
    }
    throw new Error(`无法读取已安装依赖版本：${name}`);
  }
}

test("全部直接依赖使用精确版本，实际安装与清单一致", () => {
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    assert.match(version, /^\d+\.\d+\.\d+$/, name);
    assert.equal(installedVersion(name), version, name);
  }
  assert.equal(readFileSync(join(projectRoot, ".node-version"), "utf8").trim(), process.versions.node);
  assert.equal(manifest.engines.node, process.versions.node);
  const command = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "pnpm --pm-on-fail=error --offline --version"]
    : ["--pm-on-fail=error", "--offline", "--version"];
  const actualPnpm = execFileSync(command, args, { cwd: projectRoot, encoding: "utf8", timeout: 5_000 }).trim();
  assert.equal(manifest.packageManager, `pnpm@${actualPnpm}`);
  assert.equal(manifest.engines.pnpm, actualPnpm);
});

test("真实运行诊断报告当前Node、pnpm、Next和React，检查时间有效", t => {
  const before = Date.now();
  const health = inspectRuntime();
  assert.equal(health.status, "ok");
  assert.ok(Date.parse(health.checkedAt) >= before && Date.parse(health.checkedAt) <= Date.now());
  assert.deepEqual(health.checks.map(check => [check.component, check.actual]), [
    ["Node.js", process.versions.node], ["pnpm", manifest.engines.pnpm],
    ["Next.js", installedVersion("next")], ["React", installedVersion("react")],
    ["React DOM", installedVersion("react-dom")],
  ]);
  assert.ok(health.checks.every(check => check.status === "ok"));
  t.diagnostic(`真实运行诊断耗时 ${Date.now() - before}ms；pnpm启动器信息${process.env.npm_execpath ? "存在" : "不存在"}`);
});

test("启动器版本每次从实际文件读取；不兼容、损坏或删除不能沿用健康结果", t => {
  const directory = mkdtempSync(join(tmpdir(), "guanheng-wp01-launcher-"));
  const bin = join(directory, "bin"), entry = join(bin, "pnpm.mjs"), metadata = join(directory, "package.json");
  mkdirSync(bin);
  writeFileSync(entry, "throw new Error('synthetic launcher must not execute');\n");
  const original = process.env.npm_execpath, userAgent = process.env.npm_config_user_agent;
  t.after(() => {
    if (original === undefined) delete process.env.npm_execpath; else process.env.npm_execpath = original;
    if (userAgent === undefined) delete process.env.npm_config_user_agent; else process.env.npm_config_user_agent = userAgent;
    rmSync(directory, { recursive: true, force: true });
  });
  process.env.npm_execpath = entry;
  process.env.npm_config_user_agent = `pnpm/${manifest.engines.pnpm}`;
  const pnpm = () => inspectRuntime().checks.find(check => check.component === "pnpm")!;
  for (const version of ["0.0.1", "0.0.2"]) {
    writeFileSync(metadata, JSON.stringify({ name: "pnpm", version, bin: { pnpm: "bin/pnpm.mjs" } }));
    const check = pnpm();
    assert.equal(check.actual, version); assert.equal(check.status, "error");
    assert.match(check.message, /版本不兼容/);
  }
  for (const version of [null, [manifest.engines.pnpm], "WP01_SYNTHETIC_PRIVATE_VALUE"]) {
    writeFileSync(metadata, JSON.stringify({ name: "pnpm", version, bin: { pnpm: "bin/pnpm.mjs" } }));
    assert.equal(pnpm().status, "unknown");
    assert.doesNotMatch(JSON.stringify(pnpm()), /WP01_SYNTHETIC_PRIVATE_VALUE|\/tmp|launcher-/);
  }
  writeFileSync(metadata, JSON.stringify({ name: "pnpm", version: manifest.engines.pnpm, bin: { pnpm: "bin/missing.mjs" } }));
  assert.equal(pnpm().status, "unknown", "bin必须对应当前真实启动器");
  writeFileSync(metadata, "WP01_SYNTHETIC_PRIVATE_VALUE");
  assert.equal(pnpm().status, "unknown");
  rmSync(entry);
  assert.equal(pnpm().status, "unknown", "启动器移除后不能使用旧版本");
});

test("直接Node启动仍真实查询本机pnpm，不把user-agent当安装证据", () => {
  const env: NodeJS.ProcessEnv = { ...process.env, npm_config_user_agent: "pnpm/0.0.1" };
  delete env.npm_execpath;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    import { inspectRuntime } from ${JSON.stringify(new URL("../lib/runtime-health.ts", import.meta.url).href)};
    const health=inspectRuntime(); console.log(JSON.stringify(health));
    process.exitCode=health.status==='ok'?0:1;
  `], { cwd: projectRoot, env, encoding: "utf8", timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).checks.find((check: { component: string }) => check.component === "pnpm").actual, manifest.engines.pnpm);
});

test("真实版本命令失败、无效输出及原5秒超时都保留unknown和中文原因", { timeout: 15_000 }, t => {
  const directory = mkdtempSync(join(tmpdir(), "guanheng-wp01-probe-failure-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const command = join(directory, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
  const script = join(directory, "probe.cjs");
  if (process.platform === "win32") writeFileSync(command, `@echo off\r\n"${process.execPath}" "${script}"\r\n`);
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: directory };
  delete env.npm_execpath;
  for (const [body, reason] of [
    ["console.error('WP01_SYNTHETIC_PRIVATE_VALUE');process.exitCode=7", /命令执行失败/],
    ["console.log('WP01_SYNTHETIC_PRIVATE_VALUE')", /未返回有效版本/],
    ["Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,6500)", /查询超时/],
  ] as const) {
    writeFileSync(script, body);
    if (process.platform !== "win32") writeFileSync(command, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
      import { inspectRuntime } from ${JSON.stringify(new URL("../lib/runtime-health.ts", import.meta.url).href)};
      console.log(JSON.stringify(inspectRuntime()));
    `], { cwd: projectRoot, env, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    const health = JSON.parse(result.stdout), check = health.checks.find((value: { component: string }) => value.component === "pnpm");
    assert.equal(health.status, "attention"); assert.equal(check.actual, null); assert.equal(check.status, "unknown");
    assert.match(check.message, reason);
    assert.doesNotMatch(result.stdout, /WP01_SYNTHETIC_PRIVATE_VALUE|probe-failure-/);
  }
});

test("不兼容Node版本和预发布版得到中文拒绝，合法基线通过", () => {
  for (const version of ["20.9.0", "22.13.0", "24.18.0", "24.19.0-rc.1", "25.0.0"]) {
    const result = checkNodeVersion(version);
    assert.equal(result.status, "error");
    assert.match(result.message, /Node.js 版本不兼容/);
    assert.ok(result.message.includes(manifest.engines.node));
  }
  assert.equal(checkNodeVersion().status, "ok");
});

test("不可识别版本不回显原始命令内容，也不能被当成检查通过", () => {
  for (const value of [undefined, "", "synthetic-private-value", "24.19.0\nsynthetic-private-value"]) {
    const check = checkVersion("pnpm", value, manifest.engines.pnpm);
    assert.equal(check.actual, null);
    assert.equal(check.status, "unknown");
    assert.match(check.message, /无法读取/);
    assert.doesNotMatch(JSON.stringify(check), /synthetic-private-value/);
  }
});

test("启动入口在加载TypeScript前以中文拒绝不兼容Node", () => {
  const guard = manifest.scripts["runtime:check"].match(/^node -e "([^"]+)"/);
  assert.ok(guard);
  const result = spawnSync(process.execPath, ["-e",
    `Object.defineProperty(process.versions,'node',{value:'20.0.0'});${guard[1]}`,
  ], { cwd: projectRoot, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Node.js 版本不兼容：当前 20.0.0/);
  assert.match(result.stderr, /请安装 24.19.0/);
  assert.equal(result.stdout, "");
});

test("真实CLI返回成功退出码，错误参数返回2并给出中文用法", () => {
  const ok = spawnSync(process.execPath, ["--experimental-strip-types", "lib/runtime-health.ts", "--check"], {
    cwd: projectRoot, encoding: "utf8", timeout: 15_000,
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /通过：Node.js/);
  assert.match(ok.stdout, /通过：pnpm/);
  const invalid = spawnSync(process.execPath, ["--experimental-strip-types", "lib/runtime-health.ts", "--invalid"], {
    cwd: projectRoot, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /使用方法：pnpm runtime:check/);
});

function fixture(t: TestContext) {
  const db = openDatabase(":memory:");
  globalThis.__pmsDatabase = db;
  t.after(() => {
    if (globalThis.__pmsDatabase === db) globalThis.__pmsDatabase = undefined;
    if (db.isOpen) db.close();
  });
  const tokens: Record<string, string> = {};
  for (const role of ["ADMIN", "FINANCE", "DEPARTMENT_MANAGER", "PROJECT_MEMBER"]) {
    db.prepare("INSERT INTO users (id,username,name,password_hash,role) VALUES (?,?,?,?,?)")
      .run(role, `wp01_${role.toLowerCase()}`, "合成诊断测试人员", "synthetic-not-a-login-password", role);
    tokens[role] = createSession(db, role).token;
  }
  const request = (token?: string) => new NextRequest("http://localhost/api/runtime-health", {
    headers: token ? { cookie: `pms_session=${token}` } : undefined,
  });
  const changes = () => Number((db.prepare("SELECT total_changes() AS count").get() as { count: number }).count);
  return { db, tokens, request, changes };
}

test("诊断服务对未登录和非管理员拒绝授权", () => {
  assert.throws(() => getRuntimeHealth(null), { status: 401, message: "请先登录" });
  assert.throws(() => getRuntimeHealth({ id: "synthetic", username: "synthetic", name: "合成人员", email: null,
    role: "FINANCE", departmentId: null }), { status: 403, message: "仅管理员可查看运行诊断" });
});

test("真实诊断API对未登录、伪造会话拒绝且只返回中文错误", async t => {
  const { request, changes } = fixture(t), before = changes();
  for (const token of [undefined, "invalid-synthetic-session"]) {
    const response = GET(request(token));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
    assert.deepEqual(await response.json(), { error: "请先登录" });
  }
  assert.equal(changes(), before);
});

test("财务、部门负责人、项目人员不能读取诊断，数据库未被写入", async t => {
  const { tokens, request, changes } = fixture(t), before = changes();
  for (const role of ["FINANCE", "DEPARTMENT_MANAGER", "PROJECT_MEMBER"]) {
    const response = GET(request(tokens[role]));
    assert.equal(response.status, 403, role);
    assert.deepEqual(await response.json(), { error: "仅管理员可查看运行诊断" });
  }
  assert.equal(changes(), before);
});

test("管理员API使用真实会话，只读数据库也能返回版本白名单且不回显secret", async t => {
  const { db, tokens, request, changes } = fixture(t), before = changes();
  const sentinel = "WP01_SYNTHETIC_SECRET_NEVER_RETURN";
  process.env.WP01_SYNTHETIC_SECRET = sentinel;
  t.after(() => { delete process.env.WP01_SYNTHETIC_SECRET; });
  db.exec("PRAGMA query_only=ON");
  const response = GET(request(tokens.ADMIN));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["checkedAt", "checks", "status"]);
  assert.equal(body.status, "ok");
  assert.equal(body.checks.length, 5);
  for (const check of body.checks) {
    assert.deepEqual(Object.keys(check).sort(), ["actual", "component", "expected", "message", "status"]);
    assert.equal(check.actual, check.expected);
  }
  assert.doesNotMatch(JSON.stringify(body), /WP01_SYNTHETIC_SECRET|password|token|SMTP|SESSION_SECRET|DATABASE_FILENAME|\/workspace|\/home/);
  assert.equal(changes(), before);
});

test("管理员会话过期、停用或降权后立即拒绝诊断", async t => {
  const { db, tokens, request } = fixture(t);
  db.prepare("UPDATE users SET role='FINANCE' WHERE id='ADMIN'").run();
  assert.equal(GET(request(tokens.ADMIN)).status, 403);
  db.prepare("UPDATE users SET role='ADMIN',active=0 WHERE id='ADMIN'").run();
  assert.equal(GET(request(tokens.ADMIN)).status, 401);
  db.prepare("UPDATE users SET active=1 WHERE id='ADMIN'").run();
  db.prepare("UPDATE sessions SET expires_at='2000-01-01' WHERE user_id='ADMIN'").run();
  const response = GET(request(tokens.ADMIN));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "请先登录" });
});

test("真实数据库不可读时诊断API返回通用中文错误，不回显内部异常", async t => {
  const { db, tokens, request } = fixture(t);
  db.close();
  const response = GET(request(tokens.ADMIN));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "运行诊断暂时无法读取，请稍后重试或联系管理员" });
});

test("无会话请求在全新目录返回401且不会初始化数据库或创建data目录", () => {
  const directory = mkdtempSync(join(tmpdir(), "guanheng-wp01-no-session-"));
  const route = new URL("../app/api/runtime-health/route.ts", import.meta.url).href;
  const nextRequest = pathToFileURL(require.resolve("next/server.js")).href;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    import { GET } from ${JSON.stringify(route)};
    import { NextRequest } from ${JSON.stringify(nextRequest)};
    import { existsSync } from 'node:fs';
    const response=GET(new NextRequest('http://localhost/api/runtime-health'));
    console.log(JSON.stringify({status:response.status,body:await response.json(),created:existsSync('data')}));
    globalThis.__pmsDatabase?.close();
  `], { cwd: directory, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 401);
  assert.deepEqual(output.body, { error: "请先登录" });
  assert.equal(output.created, false, "未登录诊断不得初始化数据库");
});
