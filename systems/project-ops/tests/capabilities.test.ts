import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server.js";
import { GET } from "../app/api/capabilities/route.ts";
import { createSession, type Role, type SessionUser } from "../lib/auth.ts";
import { openDatabase } from "../lib/db.ts";
import { getCapabilities } from "../lib/capabilities/service.ts";
import catalog from "../lib/capabilities/catalog.json" with { type: "json" };

const root = fileURLToPath(new URL("../../../", import.meta.url));
const generator = join(root, "tools/capability-inventory/generate.mjs");
const actor: SessionUser = { id: "synthetic", username: "synthetic", name: "合成盘点管理员", role: "ADMIN", email: null, departmentId: null };
function fixture(t: TestContext) {
  const db = openDatabase(":memory:");
  globalThis.__pmsDatabase = db;
  t.after(() => { globalThis.__pmsDatabase = undefined; if (db.isOpen) db.close(); });
  const tokens: Record<string, string> = {};
  for (const role of ["ADMIN", "FINANCE", "DEPARTMENT_MANAGER", "PROJECT_MEMBER"] as Role[]) {
    db.prepare("INSERT INTO users (id,username,name,password_hash,role) VALUES (?,?,?,?,?)")
      .run(role, `wp04_${role}`, "合成盘点人员", "synthetic-not-login-password", role);
    tokens[role] = createSession(db, role).token;
  }
  const request = (token?: string, query = "") => new NextRequest(`http://localhost/api/capabilities${query}`, { headers: token ? { cookie: `pms_session=${token}` } : {} });
  const changes = () => Number((db.prepare("SELECT total_changes() count").get() as { count: number }).count);
  return { db, tokens, request, changes };
}

test("能力目录服务拒绝未登录和非管理员，不能只靠页面隐藏", () => {
  assert.throws(() => getCapabilities(null), { status: 401, message: "请先登录" });
  for (const role of ["FINANCE", "DEPARTMENT_MANAGER", "PROJECT_MEMBER"] as Role[]) {
    assert.throws(() => getCapabilities({ ...actor, role }), { status: 403, message: "仅管理员可查看能力目录" });
  }
});

test("真实API会话鉴权拒绝匿名、伪造及三个非管理员角色，读取无数据库写入", async t => {
  const { request, tokens, changes } = fixture(t), before = changes();
  for (const token of [undefined, "forged-synthetic", tokens.FINANCE, tokens.DEPARTMENT_MANAGER, tokens.PROJECT_MEMBER]) {
    const response = GET(request(token));
    assert.equal(response.status, !token || token === "forged-synthetic" ? 401 : 403);
    assert.deepEqual(await response.json(), { error: response.status === 401 ? "请先登录" : "仅管理员可查看能力目录" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
  }
  assert.equal(changes(), before);
});

test("管理员API在query_only合成库返回可追溯来源与未知运行状态，重复读取幂等", async t => {
  const { db, tokens, request, changes } = fixture(t), before = changes();
  db.exec("PRAGMA query_only=ON");
  const response = GET(request(tokens.ADMIN, "?system=DeepSeek%E7%89%88&q=%E9%A2%84%E7%AE%97"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dataKind, "静态源码盘点，非实时经营数据");
  assert.ok(body.total > 0);
  assert.ok(body.entries.every((e: { system: string; domain: string; runtimeStatus: string }) => e.system === "DeepSeek版" && e.runtimeStatus === "未逐项运行"));
  const budget = body.entries.find((e: { route: string }) => e.route === "/budget");
  assert.equal(budget?.decision, "移植");
  assert.equal(budget?.owner, "WP14");
  assert.equal(budget?.path, "systems/pms-suite/DeepSeek版/frontend/src/pages/Budget.tsx");
  assert.deepEqual(await GET(request(tokens.ADMIN, "?system=DeepSeek%E7%89%88&q=%E9%A2%84%E7%AE%97")).json(), body);
  assert.equal(changes(), before);
  assert.doesNotMatch(JSON.stringify(body), /password_hash|token_hash|SESSION_SECRET|\/workspace|\/tmp/);
});

test("筛选、空结果、页边界和待确认功能真实返回，不能假报完成", async t => {
  const { tokens, request } = fixture(t);
  const unknown = await GET(request(tokens.ADMIN, `?decision=${encodeURIComponent("待用户决定")}`)).json();
  assert.ok(unknown.total > 0);
  assert.ok(unknown.entries.every((e: { decision: string }) => e.decision === "待用户决定"));
  const empty = getCapabilities(actor, { q: "WP04_不存在的合成能力" });
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.total, 0); assert.equal(empty.pageCount, 1);
  const last = getCapabilities(actor, { page: "999999" });
  assert.equal(last.page, last.pageCount); assert.ok(last.entries.length > 0 && last.entries.length <= 25);
  const pages = Array.from({ length: last.pageCount }, (_, i) => getCapabilities(actor, { page: String(i + 1) }).entries).flat();
  assert.equal(pages.length, catalog.entries.length);
  assert.equal(new Set(pages.map(e => [e.system, e.kind, e.route, e.method].join("|"))).size, catalog.entries.length);
});

test("无效筛选和重复参数以中文400返回，不回显内部错误", async t => {
  const { tokens, request } = fixture(t);
  for (const query of ["?system=unknown", "?decision=discard", "?page=", "?page=0", "?page=-1", "?page=1.5", "?page=1000000", "?page=1&page=2", "?q=a&q=b", "?extra=1", `?q=${"x".repeat(101)}`]) {
    const response = GET(request(tokens.ADMIN, query));
    assert.equal(response.status, 400, query);
    const body = await response.json(); assert.match(body.error, /筛选|页码|搜索/);
    assert.deepEqual(Object.keys(body), ["error"]);
  }
  assert.equal(GET(request(tokens.FINANCE, "?extra=1")).status, 403, "先鉴权再处理筛选，非管理员不能绕过角色门");
});

test("管理员停用、降权及会话过期后API立即拒绝", async t => {
  const { db, tokens, request } = fixture(t);
  db.prepare("UPDATE users SET role='FINANCE' WHERE id='ADMIN'").run();
  assert.equal(GET(request(tokens.ADMIN)).status, 403);
  db.prepare("UPDATE users SET role='ADMIN',active=0 WHERE id='ADMIN'").run();
  assert.equal(GET(request(tokens.ADMIN)).status, 401);
  db.prepare("UPDATE users SET active=1 WHERE id='ADMIN'").run();
  db.prepare("UPDATE sessions SET expires_at='2000-01-01' WHERE user_id='ADMIN'").run();
  assert.equal(GET(request(tokens.ADMIN)).status, 401);
});

test("数据库异常返回通用中文500且不暴露连接错误", async t => {
  const { db, tokens, request } = fixture(t); db.close();
  const response = GET(request(tokens.ADMIN));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "能力目录暂时无法读取，请稍后重试或联系管理员" });
});

test("无会话API在空临时cwd不初始化data或数据库", t => {
  const cwd = mkdtempSync(join(tmpdir(), "guanheng-wp04-anon-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const route = new URL("../app/api/capabilities/route.ts", import.meta.url).href;
  const next = new URL("../node_modules/next/server.js", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import {GET} from ${JSON.stringify(route)};
    import {NextRequest} from ${JSON.stringify(next)};
    import {existsSync} from 'node:fs';
    const response=GET(new NextRequest('http://localhost/api/capabilities'));
    console.log(JSON.stringify({status:response.status,created:existsSync('data')}));
  `], { cwd, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { status: 401, created: false });
});

test("真实仓库提取、逐来源摘要及映射全部一致，测试文件仅作线索", () => {
  const result = spawnSync(process.execPath, [generator, "--check"], { cwd: root, encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  for (const entry of catalog.entries) {
    const content = readFileSync(join(root, entry.path), "utf8");
    assert.equal(createHash("sha256").update(content).digest("hex"), entry.sha256, entry.path);
    assert.ok(entry.line >= 1 && entry.line <= content.split("\n").length, entry.path);
    for (const ref of [...entry.primarySources, ...entry.relatedTests]) assert.ok(readFileSync(join(root, ref), "utf8").length > 0);
    for (const ref of entry.referenceTests) {
      const content = readFileSync(join(root, ref.path), "utf8");
      assert.equal(createHash("sha256").update(content).digest("hex"), ref.sha256);
      assert.ok(ref.symbol.startsWith("test_"));
    }
    assert.equal(entry.runtimeStatus, "未逐项运行");
    assert.ok(["主线已有", "移植", "待用户决定"].includes(entry.decision));
  }
  assert.ok(catalog.entries.some(e => e.system === "基础版" && e.route === "/api/tasks/{task_id}/dependencies"));
  assert.ok(catalog.entries.some(e => e.system === "DeepSeek版" && e.route === "/api/documents/{doc_id}/versions" && e.decision === "待用户决定"));
  for (const system of ["基础版", "Kimi版", "DeepSeek版"]) {
    const auth = catalog.entries.filter(entry => entry.system === system && entry.domain === "auth");
    assert.ok(auth.some(entry => entry.referenceTests.some(ref => ref.path === `systems/pms-suite/${system}/backend/tests/test_auth_config.py`)), `${system}应保留新合入的认证配置测试线索`);
  }
});

test("变量形式新HTTP方法不会被静默漏扫，未挂载前端页面也失败", t => {
  const { directory, put } = sourceFixture(t);
  put("systems/project-ops/app/api/customers/route.ts", "export function POST(){return new Response()}\nexport const GET=()=>new Response();");
  const variable = extract(directory); assert.equal(variable.status, 1); assert.match(variable.stderr, /变量形式/);
  unlinkSync(join(directory, "systems/project-ops/app/api/customers/route.ts"));
  put("systems/pms-suite/Kimi版/frontend/src/pages/Orphan.tsx", "export default function Orphan(){return <p>合成未挂载页面</p>}");
  const orphan = extract(directory); assert.equal(orphan.status, 1); assert.match(orphan.stderr, /未挂载页面/);
});

test("同一路径的不同真实HTTP方法均保留，源码注释不能伪造接口", t => {
  const { directory, put } = sourceFixture(t);
  put("systems/project-ops/app/api/customers/route.ts", "// export function DELETE(){}\nexport function GET(){return new Response()}\nexport async function POST(){return new Response()}");
  const result = extract(directory); assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout).filter((r: { system: string; route: string }) => r.system === "主线" && r.route === "/api/customers");
  assert.deepEqual(rows.map((r: { method: string }) => r.method).sort(), ["GET", "POST"]);
});

function sourceFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "guanheng-wp04-source-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  function put(path: string, source: string) { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), source); }
  put("systems/project-ops/app/page.tsx", "export default function Home(){return <p>合成</p>}");
  for (const system of ["基础版", "Kimi版", "DeepSeek版"]) {
    put(`systems/pms-suite/${system}/backend/app/main.py`, "from fastapi import FastAPI\napp=FastAPI()\n@app.get('/health')\ndef health(): return {'status':'synthetic'}\n");
    put(`systems/pms-suite/${system}/frontend/src/App.${system === "基础版" ? "jsx" : "tsx"}`, "export default function App(){return <p>合成</p>}");
  }
  return { directory, put };
}
function extract(directory: string, mode = "scan") {
  const script = `import {scan,classify} from ${JSON.stringify(new URL("../../../tools/capability-inventory/generate.mjs", import.meta.url).href)};
    import {readFileSync} from 'node:fs';
    const records=scan(process.argv[1]);
    if(process.argv[2]==='classify') { const rules=JSON.parse(readFileSync(process.argv[3],'utf8'));for(const r of records)classify(r,rules); }
    console.log(JSON.stringify(records));`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script, directory, mode, join(root, "tools/capability-inventory/mapping.json")], { encoding: "utf8", timeout: 30000 });
}

test("新增/删除临时源路由真实改变提取结果，未知能力使分类失败", t => {
  const { directory, put } = sourceFixture(t);
  const before = extract(directory); assert.equal(before.status, 0, before.stderr);
  put("systems/project-ops/app/api/synthetic-unclassified/route.ts", "export function POST(){return Response.json({synthetic:true})}");
  const after = extract(directory); assert.equal(after.status, 0, after.stderr);
  const added = JSON.parse(after.stdout);
  assert.equal(added.length, JSON.parse(before.stdout).length + 1);
  assert.ok(added.some((r: { method: string; route: string }) => r.method === "POST" && r.route === "/api/synthetic-unclassified"));
  const failed = extract(directory, "classify"); assert.equal(failed.status, 1); assert.match(failed.stderr, /未分类/);
  unlinkSync(join(directory, "systems/project-ops/app/api/synthetic-unclassified/route.ts"));
  const deleted = extract(directory); assert.equal(deleted.status, 0, deleted.stderr); assert.equal(deleted.stdout, before.stdout);
});

test("临时重复动态路由被拒绝，不把不同参数名当不同接口", t => {
  const { directory, put } = sourceFixture(t);
  for (const param of ["id", "other"]) put(`systems/project-ops/app/api/customers/[${param}]/route.ts`, "export function GET(){return new Response('synthetic')}");
  const result = extract(directory); assert.equal(result.status, 1); assert.match(result.stderr, /重复路由/);
});

test("Python路由静态解析不会执行副作用，未挂载路由直接失败", t => {
  const { directory, put } = sourceFixture(t);
  put("systems/pms-suite/基础版/backend/app/main.py", "raise RuntimeError('NEVER_EXECUTE')\nfrom fastapi import FastAPI\napp=FastAPI()\n@app.get('/api/health')\ndef health(): return {}\n");
  const safe = extract(directory); assert.equal(safe.status, 0, safe.stderr);
  assert.ok(JSON.parse(safe.stdout).some((r: { system: string; route: string }) => r.system === "基础版" && r.route === "/api/health"));
  put("systems/pms-suite/基础版/backend/app/modules/orphan.py", "from fastapi import APIRouter\nrouter=APIRouter(prefix='/api/orphan')\n@router.get('')\ndef orphan():return {}\n");
  const failed = extract(directory); assert.equal(failed.status, 1); assert.match(failed.stderr, /路由未挂载/);
});
