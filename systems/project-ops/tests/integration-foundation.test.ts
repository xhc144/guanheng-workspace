import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { cpSync, mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { openDatabase, inTransaction } from "../lib/db.ts";
import { initializeSchema } from "../lib/schema.ts";
import { writeAudit } from "../lib/audit.ts";
import { createSession, type SessionUser } from "../lib/auth.ts";
import { assertMigrations, type Migration } from "../lib/extension-contracts.ts";
import { extensionRegistry, initializeExtensionMigrations, migrationRunner, navigationFor, resolveApprovalSubject, loadBudgetSnapshot, getIntegrationHealth } from "../lib/extension-registry.ts";
import { applyMigrations, migrationChecksum } from "../lib/migrations/index.ts";
import { GET } from "../app/api/integration-health/route.ts";
const require = createRequire(import.meta.url);
const { NextRequest } = await import(pathToFileURL(require.resolve("next/server.js")).href);

function fixture() {
  const db = openDatabase(":memory:");
  db.exec(`INSERT INTO departments(id,name) VALUES ('d1','合成交付部'),('d2','合成研发部');
    INSERT INTO users(id,username,name,password_hash,role,department_id) VALUES
    ('a','admin','合成管理员','synthetic','ADMIN','d1'),('f','finance','合成财务','synthetic','FINANCE','d1'),
    ('m','manager','合成主管','synthetic','DEPARTMENT_MANAGER','d1'),('u','member','合成成员','synthetic','PROJECT_MEMBER','d1'),
    ('x','outsider','合成外部成员','synthetic','PROJECT_MEMBER','d2');
    INSERT INTO customers(id,name) VALUES ('c','虚构地基客户');
    INSERT INTO projects(id,name,customer_id,manager_user_id,department_id) VALUES ('p','虚构地基项目','c','m','d1');
    INSERT INTO project_members(project_id,user_id) VALUES ('p','u');
    INSERT INTO work_items(id,type,title,project_id,reporter_user_id) VALUES ('w','TASK','虚构待审事项','p','m');`);
  const actor = (id: string): SessionUser => {
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(id)!;
    return { id, username: String(u.username), name: String(u.name), email: null, role: u.role as SessionUser["role"], departmentId: String(u.department_id) };
  };
  return { db, actor };
}
const count = (db: DatabaseSync, table: string) => Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n);

type WorkerResult = { success: boolean; error?: string; closed?: boolean };
function waitForWorkerResult(worker: Worker, onReady: () => void = () => {}): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    let result: WorkerResult | undefined, ready = false;
    worker.once("error", reject);
    worker.once("exit", code => {
      if (code !== 0) reject(new Error(`worker退出${code}`));
      else if (!result) reject(new Error("worker正常退出但未返回结果"));
      else resolve(result);
    });
    worker.on("message", (message: unknown) => {
      if (message && typeof message === "object" && "ready" in message && message.ready === true) {
        if (ready || result) reject(new Error("worker重复或迟到的ready消息"));
        else { ready = true; onReady(); }
      } else if (message && typeof message === "object" && "success" in message
        && typeof message.success === "boolean"
        && (message.success || ("error" in message && typeof message.error === "string"))) {
        if (result) reject(new Error("worker重复返回结果"));
        else result = message as WorkerResult;
      } else reject(new Error("worker返回了无效结果"));
    });
  });
}

function insert(db: DatabaseSync, id: string) {
  db.prepare("INSERT INTO customers(id,name) VALUES (?,?)").run(id, `合成-${id}`);
  writeAudit(db, { action: "CREATE", entityType: "CUSTOMER", entityId: id });
}

test("顶层与三层嵌套成功：返回值、业务和审计一起提交", t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  const result = inTransaction(db, () => { insert(db, "one"); return inTransaction(db, () => {
    insert(db, "two"); return inTransaction(db, () => { insert(db, "three"); return 42; });
  }); });
  assert.equal(result, 42); assert.equal(count(db, "customers"), 3); assert.equal(count(db, "audit_logs"), 3);
  assert.equal(db.isTransaction, false);
});

test("内层失败传播或外层失败均回滚业务和审计；连接可再次使用", t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  for (const innerFails of [true, false]) {
    assert.throws(() => inTransaction(db, () => {
      insert(db, "outer");
      inTransaction(db, () => { insert(db, "inner"); if (innerFails) throw new Error("内层合成失败"); });
      throw new Error("外层合成失败");
    }), /合成失败/);
    assert.equal(count(db, "customers"), 0); assert.equal(count(db, "audit_logs"), 0);
    assert.equal(db.isTransaction, false);
  }
  inTransaction(db, () => insert(db, "retry")); assert.equal(count(db, "audit_logs"), 1);
});

test("明确捕获内层失败只撤回保存点；兼容调用者已开启的事务", t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.exec("BEGIN IMMEDIATE");
  inTransaction(db, () => {
    insert(db, "keep");
    assert.throws(() => inTransaction(db, () => { insert(db, "discard"); throw new Error("撤回内层"); }), /撤回内层/);
    insert(db, "keep2");
  });
  assert.equal(db.isTransaction, true); assert.equal(count(db, "customers"), 2); assert.equal(count(db, "audit_logs"), 2);
  db.exec("ROLLBACK"); assert.equal(count(db, "customers"), 0); assert.equal(count(db, "audit_logs"), 0);
});

test("拒绝异步形状返回值并回滚同步写入", t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  assert.throws(() => inTransaction(db, () => { insert(db, "async"); return Promise.resolve(1); }), /只接受同步回调/);
  assert.equal(count(db, "customers"), 0); assert.equal(count(db, "audit_logs"), 0);
});

test("async函数在执行前拒绝，不留下await后的越界写入", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close()); let called = false;
  assert.throws(() => inTransaction(db, async () => {
    called = true; insert(db, "before-await"); await Promise.resolve(); insert(db, "after-await");
  }), /只接受同步回调/);
  await Promise.resolve(); assert.equal(called, false);
  assert.equal(count(db, "customers"), 0); assert.equal(count(db, "audit_logs"), 0); assert.equal(db.isTransaction, false);
});

test("旧表缺列先补再建索引；保留原CHECK、作废历史和四角色", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(`CREATE TABLE receivables(id TEXT PRIMARY KEY,contract_id TEXT NOT NULL,project_id TEXT,
    name TEXT NOT NULL,category TEXT NOT NULL CHECK(category IN ('历史指定款')),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
    due_date TEXT NOT NULL,owner_user_id TEXT,notes TEXT,created_at TEXT,updated_at TEXT);
    INSERT INTO receivables VALUES('old','old-contract',NULL,'合成旧账','历史指定款',12345,'2020-01-01',NULL,NULL,'old','old');`);
  initializeSchema(db); initializeSchema(db);
  assert.equal(db.prepare("SELECT amount_cents FROM receivables WHERE id='old'").get()!.amount_cents, 12345);
  assert.equal(db.prepare("SELECT due_date_is_estimated FROM receivables WHERE id='old'").get()!.due_date_is_estimated, 0);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='idx_receivables_contract_due'").get());
  assert.throws(() => db.exec("UPDATE receivables SET category='不允许的新口径' WHERE id='old'"), /CHECK/);
  db.exec("UPDATE receivables SET voided_at='2020-02-01',void_reason='合成历史作废' WHERE id='old'");
  initializeSchema(db);
  assert.equal(db.prepare("SELECT void_reason FROM receivables WHERE id='old'").get()!.void_reason, "合成历史作废");
  assert.throws(() => db.exec("INSERT INTO users(id,username,name,password_hash,role) VALUES('portal','portal','门户','x','CUSTOMER')"), /CHECK/);
  assert.equal(getIntegrationHealth(db, { id: "a", username: "a", name: "合成", email: null, role: "ADMIN", departmentId: null }).schema.tableCount, 36);
});

test("旧服务表缺续费关联列时兼容补齐，已作废数据和旧CHECK不改写", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(`CREATE TABLE service_periods(id TEXT PRIMARY KEY,project_id TEXT,start_date TEXT,end_date TEXT,amount_cents INTEGER,
    owner_user_id TEXT,receivable_id TEXT,status TEXT CHECK(status IN ('VOID','LEGACY_REVIEW')),created_at TEXT);
    INSERT INTO service_periods VALUES('old',NULL,'2020-01-01','2020-12-31',100,NULL,NULL,'VOID','old');`);
  initializeSchema(db);
  assert.equal(db.prepare("SELECT status FROM service_periods WHERE id='old'").get()!.status, "VOID");
  assert.equal(db.prepare("SELECT previous_period_id FROM service_periods WHERE id='old'").get()!.previous_period_id, null);
  assert.throws(() => db.exec("UPDATE service_periods SET status='PAID' WHERE id='old'"), /CHECK/);
});

test("旧唯一索引冲突时整个初始化回滚，不改旧行或遗留半套新增结构", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(`CREATE TABLE service_periods(id TEXT PRIMARY KEY,project_id TEXT,start_date TEXT,end_date TEXT,amount_cents INTEGER,
    owner_user_id TEXT,receivable_id TEXT,previous_period_id TEXT,status TEXT,created_at TEXT);
    INSERT INTO service_periods VALUES('one',NULL,'2020-01-01','2020-12-31',100,NULL,NULL,'legacy','VOID','old'),
      ('two',NULL,'2020-01-01','2020-12-31',100,NULL,NULL,'legacy','VOID','old');`);
  const before = db.prepare("SELECT * FROM service_periods ORDER BY id").all();
  const oldSql = db.prepare("SELECT sql FROM sqlite_schema WHERE name='service_periods'").get()!.sql;
  assert.throws(() => initializeSchema(db), /UNIQUE/);
  assert.deepEqual(db.prepare("SELECT * FROM service_periods ORDER BY id").all(), before);
  assert.equal(db.prepare("SELECT sql FROM sqlite_schema WHERE name='service_periods'").get()!.sql, oldSql);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='departments'").get(), undefined);
  assert.equal(db.isTransaction, false);
});

const safeMigration: Migration = { id: "synthetic.001", checksum: "a".repeat(64), operations: [
  { kind: "createTable", table: "synthetic_items", columns: [
    { name: "id", type: "TEXT", nullable: false },
    { name: "amount_cents", type: "INTEGER", nullable: false, minimum: 0, default: { kind: "value", value: 0 } },
    { name: "created_at", type: "TEXT", nullable: false, default: { kind: "currentTimestamp" } },
  ], primaryKey: ["id"] },
  { kind: "addColumn", table: "customers", column: { name: "synthetic_note", type: "TEXT", nullable: true, default: { kind: "value", value: "'); DROP TABLE users; --" } } },
  { kind: "createIndex", table: "synthetic_items", name: "idx_synthetic_items", columns: ["amount_cents"] },
] };

test("迁移声明仅接受安全结构；文本默认值仍是数据，G0不会执行SQL", t => {
  const { db } = fixture(); t.after(() => db.close());
  assert.doesNotThrow(() => assertMigrations([safeMigration])); assert.doesNotThrow(() => assertMigrations([]));
  assert.equal(count(db, "users"), 5);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='synthetic_items'").get(), undefined);
});

test("迁移白名单拒绝任意函数/未知键/DDL伪装/非JSON/非法默认值，旧行不变", t => {
  const { db } = fixture(); t.after(() => db.close());
  const mutations: unknown[] = [
    { ...safeMigration, up() {} }, { ...safeMigration, exec: "DROP TABLE users" },
    { ...safeMigration, operations: [{ kind: "dropTable", table: "users" }] },
    { ...safeMigration, operations: [{ kind: "createIndex", table: "users;DELETE", name: "x", columns: ["id"] }] },
    { ...safeMigration, operations: [{ kind: "createIndex", table: "users", name: "x", columns: ["id"], prepare: "x" }] },
    ...[NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, () => 1, undefined].map(value => ({ ...safeMigration,
      operations: [{ kind: "addColumn", table: "users", column: { name: "x", type: "INTEGER", nullable: false, default: { kind: "value", value } } }] })),
    ...[{ kind: "raw", sql: "CURRENT_TIMESTAMP" }, { kind: "currentTimestamp", value: "DROP" },
      { kind: "currentTimestamp" }, { kind: "value", value: null }].map(value => ({ ...safeMigration,
      operations: [{ kind: "addColumn", table: "users", column: { name: "x", type: "INTEGER", nullable: false, default: value } }] })),
    { ...safeMigration, operations: [{ kind: "addColumn", table: "users", column: { name: "x", type: "TEXT", nullable: false } }] },
    { ...safeMigration, operations: [{ kind: "createTable", table: "x", columns: [{ name: "id", type: "TEXT", nullable: false }], primaryKey: ["missing"] }] },
    Object.assign(Object.create({ hidden: true }), safeMigration),
    { ...safeMigration, checksum: "not-a-checksum" },
    { ...safeMigration, operations: [{ get kind() { throw new Error("getter不得执行"); }, table: "users" }] },
    { ...safeMigration, [Symbol("extra")]: true },
  ];
  const before = db.prepare("SELECT * FROM users ORDER BY id").all();
  for (const item of mutations) assert.throws(() => assertMigrations([item]), /受限白名单/);
  assert.throws(() => assertMigrations([safeMigration, safeMigration]), /受限白名单/);
  assert.deepEqual(db.prepare("SELECT * FROM users ORDER BY id").all(), before);
});

test("严格JSON契约拒绝稀疏数组、访问器、隐藏键和嵌套函数且不调用访问器", () => {
  let getterCalls = 0;
  const getterColumn = { name: "x", type: "TEXT", nullable: true, get default() { getterCalls++; return { kind: "value", value: "x" }; } };
  const hidden = Object.defineProperty({ ...safeMigration }, "hidden", { value: true, enumerable: false });
  const sparse: unknown[] = []; sparse.length = 1;
  const extra: unknown[] = []; Object.defineProperty(extra, "unexpected", { value: true });
  const cases: unknown[] = [sparse, extra, [hidden], [Object.assign(Object.create(null), safeMigration)],
    [{ ...safeMigration, operations: [{ kind: "addColumn", table: "users", column: getterColumn }] }],
    [{ ...safeMigration, operations: [{ kind: "addColumn", table: "users", column: { name: "x", type: "TEXT", nullable: true, default: { kind: "value", value() {} } } }] }],
  ];
  for (const item of cases) assert.throws(() => assertMigrations(item), /受限白名单/);
  assert.equal(getterCalls, 0);
});

test("基线PROJECT/WORK_ITEM解析存在性、未作废、服务端范围；未来主体未配置", t => {
  const { db, actor } = fixture(); t.after(() => db.close());
  assert.deepEqual(resolveApprovalSubject(db, actor("u"), "PROJECT", "p"), { status: "AVAILABLE", subject: { kind: "PROJECT", id: "p", projectId: "p", title: "虚构地基项目" } });
  assert.equal(resolveApprovalSubject(db, actor("u"), "WORK_ITEM", "w").status, "AVAILABLE");
  for (const kind of ["PROJECT", "WORK_ITEM"] as const) {
    assert.throws(() => resolveApprovalSubject(db, actor("x"), kind, kind === "PROJECT" ? "p" : "w"), { status: 403 });
    assert.throws(() => resolveApprovalSubject(db, actor("a"), kind, "missing"), { status: 404 });
  }
  for (const kind of ["RISK", "BUDGET_VERSION"] as const) assert.deepEqual(resolveApprovalSubject(db, actor("a"), kind, "future"), { status: "UNAVAILABLE", reason: "NOT_CONFIGURED" });
  db.exec("UPDATE work_items SET status='CANCELLED' WHERE id='w'");
  assert.throws(() => resolveApprovalSubject(db, actor("a"), "WORK_ITEM", "w"), { status: 404 });
  db.exec("UPDATE work_items SET status='OPEN' WHERE id='w'; UPDATE projects SET status='VOID' WHERE id='p'");
  assert.throws(() => resolveApprovalSubject(db, actor("a"), "WORK_ITEM", "w"), { status: 404 });
  assert.throws(() => resolveApprovalSubject(db, actor("a"), "PROJECT", "p"), { status: 404 });
});

test("无项目事项按研发范围解析，部门主管不能审批其他部门项目", t => {
  const { db, actor } = fixture(); t.after(() => db.close());
  db.exec("INSERT INTO work_items(id,type,title,reporter_user_id) VALUES('standalone','BUG','合成独立缺陷','u'); INSERT INTO projects(id,name,customer_id,department_id) VALUES('other','其他部门项目','c','d2')");
  assert.deepEqual(resolveApprovalSubject(db, actor("u"), "WORK_ITEM", "standalone"), { status: "AVAILABLE", subject: { kind: "WORK_ITEM", id: "standalone", projectId: null, title: "合成独立缺陷" } });
  assert.throws(() => resolveApprovalSubject(db, actor("x"), "WORK_ITEM", "standalone"), { status: 403 });
  assert.throws(() => resolveApprovalSubject(db, actor("m"), "PROJECT", "other"), { status: 403 });
  assert.equal(resolveApprovalSubject(db, actor("m"), "PROJECT", "p").status, "AVAILABLE");
});

test("预算未注册返回UNAVAILABLE/NOT_CONFIGURED，禁止假0与越权/不存在项目", t => {
  const { db, actor } = fixture(); t.after(() => db.close());
  assert.deepEqual(loadBudgetSnapshot(db, actor("u"), "p"), { status: "UNAVAILABLE", reason: "NOT_CONFIGURED" });
  assert.throws(() => loadBudgetSnapshot(db, actor("x"), "p"), { status: 403 });
  assert.throws(() => loadBudgetSnapshot(db, actor("a"), "missing"), { status: 404 });
});

test("注册表只列真实已实现路由，导航和管理员状态目录同源且无未来模块", t => {
  const { db, actor } = fixture(); t.after(() => db.close());
  for (const entry of extensionRegistry) for (const route of entry.routes) {
    assert.ok(existsSync(new URL(`../app${route.path === "/" ? "" : route.path}/${route.kind === "PAGE" ? "page.tsx" : "route.ts"}`, import.meta.url)), route.path);
  }
  const health = getIntegrationHealth(db, actor("a"));
  assert.equal(health.phase, "G1"); assert.equal(health.schema.tableCount, 36);
  assert.deepEqual(health.migrationRunner, { status: "REGISTERED", owner: "WP-23", applied: 0, registered: 0, ledgerPresent: false });
  assert.equal(health.modules.length, navigationFor(actor("a")).length);
  assert.ok(navigationFor(actor("a")).some(item => item.href === "/runtime-health"));
  for (const id of ["f", "m", "u"]) assert.ok(!navigationFor(actor(id)).some(item => /health|audit|organization/.test(item.href)));
  assert.ok(!extensionRegistry.some(module => /budget|risk|migration|portal/.test(module.id)));
  assert.throws(() => { (extensionRegistry as unknown[]).push({ id: "fake" }); }, TypeError);
  // SQL LIKE treats underscore as a wildcard; sqlitex_* is an ordinary table prefix.
  db.exec("CREATE TABLE sqlitex_synthetic (id TEXT)");
  assert.equal(getIntegrationHealth(db, actor("a")).schema.tableCount, 37);
});

function runnerMigration(id: string, table: string): Migration {
  const operations: Migration["operations"] = [{ kind: "createTable", table, columns: [
    { name: "id", type: "TEXT", nullable: false },
    { name: "amount_cents", type: "INTEGER", nullable: false, minimum: 0 },
  ], primaryKey: ["id"] }];
  return { id, checksum: migrationChecksum(id, operations), operations };
}

test("G1绑定WP23真实执行器，空注册批次重复启动不造账本或演示业务", t => {
  const directory = mkdtempSync(join(tmpdir(), "gh-wp24-g1-startup-")), filename = join(directory, "synthetic.db");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal(migrationRunner, applyMigrations, "必须直接绑定已合WP23执行器");
  for (let run = 0; run < 2; run++) {
    const db = openDatabase(filename);
    try {
      assert.deepEqual(initializeExtensionMigrations(db), { applied: [], skipped: [] });
      assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='schema_migrations'").get(), undefined);
      assert.equal(count(db, "users"), 0); assert.equal(count(db, "customers"), 0);
      assert.equal(db.isTransaction, false);
    } finally { db.close(); }
  }
});

test("G1公开runner可执行非空声明、幂等跳过，重开连接后从真实账本统计", t => {
  const directory = mkdtempSync(join(tmpdir(), "gh-wp24-g1-ledger-")), filename = join(directory, "synthetic.db");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const actor: SessionUser = { id: "a", username: "a", name: "合成", email: null, role: "ADMIN", departmentId: null };
  const migration = runnerMigration("wp24.synthetic.001", "synthetic_g1_items");
  const db = openDatabase(filename);
  try {
    assert.deepEqual(migrationRunner(db, [migration]), { applied: [migration.id], skipped: [] });
    db.prepare("INSERT INTO synthetic_g1_items(id,amount_cents) VALUES(?,?)").run("synthetic-row", 12345);
    assert.deepEqual(migrationRunner(db, [migration]), { applied: [], skipped: [migration.id] });
    assert.equal(count(db, "schema_migrations"), 1);
    assert.equal(db.prepare("SELECT checksum FROM schema_migrations WHERE id=?").get(migration.id)!.checksum, migration.checksum);
  } finally { db.close(); }
  const reopened = openDatabase(filename);
  try {
    const before = reopened.prepare("SELECT total_changes() n").get()!.n;
    reopened.exec("PRAGMA query_only=ON");
    const health = getIntegrationHealth(reopened, actor);
    assert.equal(health.schema.tableCount, 37, "内部账本不计入业务表");
    assert.deepEqual(health.migrationRunner, { status: "REGISTERED", owner: "WP-23", applied: 1, registered: 0, ledgerPresent: true });
    assert.equal(reopened.prepare("SELECT amount_cents FROM synthetic_g1_items WHERE id='synthetic-row'").get()!.amount_cents, 12345);
    assert.equal(reopened.prepare("SELECT total_changes() n").get()!.n, before);
    assert.doesNotMatch(JSON.stringify(health), /wp24.synthetic.001|synthetic-row|operations_json|12345/);
  } finally { reopened.close(); }
});

test("G1生产启动消费模块声明：跨进程幂等、失败不缓存连接、修正声明后可重试", t => {
  const directory = mkdtempSync(join(tmpdir(), "gh-wp24-g1-module-")), filename = join(directory, "data/synthetic.db");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // Copy source only. A synthetic declaration in an isolated registry exercises
  // the real default getDb -> openDatabase -> WP23 path without a production
  // mutable registration API or a mocked executor.
  for (const path of ["db.ts", "schema.ts", "extension-registry.ts", "extension-contracts.ts", "entity-access.ts", "permissions.ts", "migrations/index.ts"]) {
    const target = join(directory, "lib", path);
    mkdirSync(join(directory, "lib", path.includes("/") ? "migrations" : ""), { recursive: true });
    cpSync(new URL(`../lib/${path}`, import.meta.url), target);
  }
  const registryPath = join(directory, "lib/extension-registry.ts"), source = readFileSync(registryPath, "utf8");
  const anchor = "export const extensionRegistry: readonly InstalledModule[] = Object.freeze([";
  assert.equal(source.split(anchor).length, 2, "临时合成注册必须插入唯一清单入口");
  const install = (migrations: readonly Migration[]) => {
    const entries = migrations.map((migration, index) => ({ id: `synthetic-g1-${index}`, label: "纯合成模块", owner: "SYNTHETIC", routes: [], migrations: [migration] }));
    writeFileSync(registryPath, source.replace(anchor, `${anchor}\n  ${entries.map(entry => JSON.stringify(entry)).join(",\n  ")},`));
  };
  const saved = openDatabase(filename);
  try { saved.exec("INSERT INTO customers(id,name) VALUES('saved','合成旧行')"); }
  finally { saved.close(); }
  const first = runnerMigration("wp24.startup.001", "synthetic_g1_startup");
  const second = runnerMigration("wp24.startup.002", "synthetic_g1_second");
  const operations: Migration["operations"] = [{ kind: "createIndex", table: "customers", name: "synthetic_g1_invalid", columns: ["missing_column"] }];
  const bad: Migration = { id: "wp24.startup.bad", checksum: migrationChecksum("wp24.startup.bad", operations), operations };
  const start = () => {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
      import {getDb} from ${JSON.stringify(pathToFileURL(join(directory, "lib/db.ts")).href)};
      import {getIntegrationHealth} from ${JSON.stringify(pathToFileURL(registryPath).href)};
      try {
        const db=getDb(); const health=getIntegrationHealth(db,{role:'ADMIN'});
        console.log(JSON.stringify({ok:true,cached:getDb()===db,health,users:db.prepare('SELECT COUNT(*) n FROM users').get().n}));
        db.close();
      } catch(error) { console.log(JSON.stringify({ok:false,cached:globalThis.__pmsDatabase!==undefined,error:error.message})); }
    `], { cwd: directory, env: { ...process.env, DATABASE_FILENAME: "synthetic.db" }, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  install([first]);
  for (let run = 0; run < 2; run++) {
    const result = start();
    assert.equal(result.ok, true); assert.equal(result.cached, true); assert.equal(result.users, 0);
    assert.deepEqual(result.health.migrationRunner, { status: "REGISTERED", owner: "WP-23", applied: 1, registered: 1, ledgerPresent: true });
    assert.equal(result.health.schema.tableCount, 37);
    const entry = result.health.modules.find((item: { id: string }) => item.id === "synthetic-g1-0");
    assert.deepEqual(entry.migrations, [{ id: first.id, checksum: first.checksum }]);
    assert.doesNotMatch(JSON.stringify(result.health), /operations|amount_cents/);
  }
  install([first, second, bad]);
  const failed = start();
  assert.equal(failed.ok, false); assert.equal(failed.cached, false); assert.match(failed.error, /no such column/);
  for (const [declarations, expected] of [
    [[first, first], /受限白名单/],
    [[first, { ...second, checksum: "0".repeat(64) }], /校验和不匹配/],
    [[{ ...second, id: first.id, checksum: migrationChecksum(first.id, second.operations) }], /已执行迁移发生变化/],
  ] as const) {
    install(declarations);
    const rejected = start();
    assert.equal(rejected.ok, false); assert.equal(rejected.cached, false); assert.match(rejected.error, expected);
  }
  const afterFailure = new DatabaseSync(filename);
  try {
    assert.equal(afterFailure.prepare("SELECT 1 FROM sqlite_schema WHERE name='synthetic_g1_second'").get(), undefined);
    assert.equal(count(afterFailure, "schema_migrations"), 1);
    assert.equal(afterFailure.prepare("SELECT name FROM customers WHERE id='saved'").get()!.name, "合成旧行");
  } finally { afterFailure.close(); }
  install([first, second]);
  const retried = start();
  assert.equal(retried.ok, true); assert.equal(retried.health.migrationRunner.applied, 2);
  assert.equal(retried.health.migrationRunner.registered, 2); assert.equal(retried.health.schema.tableCount, 38);
});

test("G1真实runner整批失败回滚DDL和账本，修正后重试并保留旧行", t => {
  const { db } = fixture(); t.after(() => db.close());
  const first = runnerMigration("wp24.synthetic.retry", "synthetic_g1_retry");
  const operations: Migration["operations"] = [{ kind: "createIndex", table: "customers", name: "synthetic_g1_bad_index", columns: ["missing_column"] }];
  const bad: Migration = { id: "wp24.synthetic.bad", checksum: migrationChecksum("wp24.synthetic.bad", operations), operations };
  const before = db.prepare("SELECT * FROM customers ORDER BY id").all();
  assert.throws(() => migrationRunner(db, [first, bad]), /no such column/);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='synthetic_g1_retry'").get(), undefined);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='schema_migrations'").get(), undefined);
  assert.deepEqual(db.prepare("SELECT * FROM customers ORDER BY id").all(), before);
  assert.equal(db.isTransaction, false);
  assert.deepEqual(migrationRunner(db, [first]), { applied: [first.id], skipped: [] });
  assert.equal(count(db, "schema_migrations"), 1);
  assert.deepEqual(db.prepare("SELECT * FROM customers ORDER BY id").all(), before);
});

test("G1真实runner与业务/审计共用外层事务，保存点成功后外层失败仍全部撤回", t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  const migration = runnerMigration("wp24.synthetic.atomic", "synthetic_g1_atomic");
  assert.throws(() => inTransaction(db, () => {
    assert.deepEqual(migrationRunner(db, [migration]), { applied: [migration.id], skipped: [] });
    insert(db, "atomic-customer");
    db.exec("INSERT INTO synthetic_g1_atomic(id,amount_cents) VALUES('atomic-row',100)");
    throw new Error("合成外层失败");
  }), /合成外层失败/);
  for (const name of ["schema_migrations", "synthetic_g1_atomic"]) {
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name=?").get(name), undefined);
  }
  assert.equal(count(db, "customers"), 0); assert.equal(count(db, "audit_logs"), 0);
  assert.deepEqual(migrationRunner(db, [migration]), { applied: [migration.id], skipped: [] });
});

test("G1真实runner拒绝伪SQL与错误校验和，不因注册接回放宽WP23校验", t => {
  const { db } = fixture(); t.after(() => db.close());
  const safe = runnerMigration("wp24.synthetic.reject", "synthetic_g1_reject");
  const before = db.prepare("SELECT * FROM users ORDER BY id").all();
  assert.throws(() => migrationRunner(db, [{ ...safe, checksum: "0".repeat(64) }]), /校验和不匹配/);
  assert.throws(() => migrationRunner(db, [{ ...safe, exec: "DELETE FROM users" } as Migration]), /受限白名单/);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='synthetic_g1_reject'").get(), undefined);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='schema_migrations'").get(), undefined);
  assert.deepEqual(db.prepare("SELECT * FROM users ORDER BY id").all(), before);
});

function apiFixture(t: test.TestContext) {
  const { db, actor } = fixture(); globalThis.__pmsDatabase = db;
  t.after(() => { globalThis.__pmsDatabase = undefined; if (db.isOpen) db.close(); });
  const tokens = Object.fromEntries(["a", "f", "m", "u"].map(id => [id, createSession(db, id).token]));
  const request = (token?: string) => new NextRequest("http://localhost/api/integration-health", { headers: token ? { cookie: `pms_session=${token}` } : undefined });
  return { db, actor, tokens, request };
}

test("真实API的401/403/200及无缓存、只读、会话撤销、500中文错误边界", async t => {
  const { db, actor, tokens, request } = apiFixture(t);
  const migration = runnerMigration("wp24.api.synthetic.001", "synthetic_g1_api");
  assert.deepEqual(migrationRunner(db, [migration]), { applied: [migration.id], skipped: [] });
  for (const token of [undefined, "forged"]) assert.equal(GET(request(token)).status, 401);
  for (const id of ["f", "m", "u"]) {
    const response = GET(request(tokens[id])); assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "仅管理员可查看集成状态" });
  }
  const before = db.prepare("SELECT total_changes() n").get()!.n;
  db.exec("PRAGMA query_only=ON");
  const response = GET(request(tokens.a)); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("vary"), "Cookie");
  const body = await response.json(), direct = getIntegrationHealth(db, actor("a"));
  assert.deepEqual(body.modules, direct.modules); assert.deepEqual(body.migrationRunner, direct.migrationRunner);
  assert.equal(body.phase, "G1"); assert.equal(body.migrationRunner.applied, 1); assert.equal(body.schema.tableCount, 37);
  assert.equal(db.prepare("SELECT total_changes() n").get()!.n, before);
  assert.doesNotMatch(JSON.stringify(body), /password|token|\/workspace|\/tmp|customer_id|SMTP/);
  db.exec("PRAGMA query_only=OFF; UPDATE users SET role='FINANCE' WHERE id='a'");
  assert.equal(GET(request(tokens.a)).status, 403);
  db.exec("UPDATE users SET role='ADMIN',active=0 WHERE id='a'"); assert.equal(GET(request(tokens.a)).status, 401);
  db.exec("UPDATE users SET active=1 WHERE id='a'; UPDATE sessions SET expires_at='2000-01-01' WHERE user_id='a'");
  assert.equal(GET(request(tokens.a)).status, 401);
  db.close(); const failed = GET(request(tokens.a)); assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "集成状态暂时无法读取，请稍后重试或联系管理员" });
});

test("匿名API在全新临时cwd拒绝且不创建数据库目录", () => {
  const directory = mkdtempSync(join(tmpdir(), "gh-wp24-anonymous-"));
  try {
    const route = new URL("../app/api/integration-health/route.ts", import.meta.url).href;
    const next = pathToFileURL(require.resolve("next/server.js")).href;
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
      import { GET } from ${JSON.stringify(route)}; import { NextRequest } from ${JSON.stringify(next)};
      import { existsSync } from 'node:fs'; const r=GET(new NextRequest('http://localhost/api/integration-health'));
      console.log(JSON.stringify({status:r.status,created:existsSync('data')}));
    `], { cwd: directory, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), { status: 401, created: false });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("worker结果先于关闭时必须等退出；真实锁释放后才能验证数据库", { timeout: 15_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "gh-wp24-worker-close-")), filename = join(directory, "synthetic.db");
  const barrier = new SharedArrayBuffer(4), gate = new Int32Array(barrier);
  const worker = new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(workerData.filename);
    db.exec('PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=WAL; CREATE TABLE example(value INTEGER); INSERT INTO example VALUES(1)');
    parentPort.postMessage({success:true});
    Atomics.wait(new Int32Array(workerData.barrier),0,0);
    db.close();
  `, { eval: true, workerData: { filename, barrier } });
  t.after(async () => {
    Atomics.store(gate, 0, 1); Atomics.notify(gate, 0);
    await worker.terminate(); rmSync(directory, { recursive: true, force: true });
  });
  let settled = false;
  const completion = waitForWorkerResult(worker);
  void completion.then(() => { settled = true; }, () => { settled = true; });
  await new Promise<void>((resolve, reject) => { worker.once("message", () => resolve()); worker.once("error", reject); });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false, "结果消息不代表worker已经关闭并退出");
  const early = new DatabaseSync(filename);
  try { assert.throws(() => early.prepare("SELECT * FROM example").all(), { errcode: 5 }); }
  finally { early.close(); }
  Atomics.store(gate, 0, 1); Atomics.notify(gate, 0);
  assert.equal((await completion).success, true);
  assert.equal(worker.threadId, -1);
  const verify = new DatabaseSync(filename);
  try { assert.equal(verify.prepare("SELECT value FROM example").get()!.value, 1); }
  finally { verify.close(); }
});

test("worker结果后的异常退出或未返回结果都不能被当成成功", { timeout: 15_000 }, async t => {
  for (const [source, expected] of [
    ["require('node:worker_threads').parentPort.postMessage({success:true}); process.exitCode=7", /worker退出7/],
    ["require('node:worker_threads').parentPort.postMessage({success:true}); throw new Error('合成关闭失败')", /合成关闭失败/],
    ["process.exitCode=0", /未返回结果/],
  ] as const) {
    const worker = new Worker(source, { eval: true });
    t.after(() => worker.terminate());
    await assert.rejects(waitForWorkerResult(worker), expected);
  }
});

test("同一临时库两个并发连接抢占回款：只成功一笔且业务/审计一起提交", { timeout: 15_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "gh-wp24-contention-")), filename = join(directory, "synthetic.db");
  const workers: Worker[] = []; let verify: DatabaseSync | undefined = undefined;
  t.after(async () => {
    await Promise.all(workers.filter(w => w.threadId !== -1).map(w => w.terminate()));
    verify?.close(); rmSync(directory, { recursive: true, force: true });
  });
  const db = openDatabase(filename);
  db.exec(`INSERT INTO customers(id,name) VALUES('c','虚构并发客户');
    INSERT INTO contracts(id,number,name,customer_id,amount_cents) VALUES('ct','SYNTH','虚构合同','c',100000);
    INSERT INTO receivables(id,contract_id,name,category,amount_cents,due_date) VALUES('r','ct','合成款','首款',100000,'2026-01-01');`);
  db.close();
  const barrier = new SharedArrayBuffer(4), gate = new Int32Array(barrier);
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    (async()=>{ const {DatabaseSync}=await import('node:sqlite');
      const {inTransaction}=await import(workerData.dbModule);
      const {createReceiptWithAllocations}=await import(workerData.financeModule);
      const {writeAudit}=await import(workerData.auditModule);
      const db=new DatabaseSync(workerData.filename); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
      parentPort.postMessage({ready:true}); const gate=new Int32Array(workerData.barrier); Atomics.wait(gate,0,0);
      let result;
      try { inTransaction(db,()=>{ const id=createReceiptWithAllocations(db,{idempotencyKey:workerData.key,customerId:'c',receivedDate:'2026-01-02',amountCents:60000,allocations:[{receivableId:'r',amountCents:60000}]}); writeAudit(db,{action:'CREATE',entityType:'RECEIPT',entityId:id}); }); result={success:true}; }
      catch(e){result={success:false,error:e.message};} finally{db.close();}
      parentPort.postMessage({...result,closed:!db.isOpen});
    })().catch(e=>{throw e});`;
  let ready = 0;
  const results = await Promise.all(["one", "two"].map(key => {
    const w = new Worker(source, { eval: true, workerData: { filename, key, barrier,
      dbModule: new URL("../lib/db.ts", import.meta.url).href,
      financeModule: new URL("../lib/finance.ts", import.meta.url).href,
      auditModule: new URL("../lib/audit.ts", import.meta.url).href } }); workers.push(w);
    return waitForWorkerResult(w, () => {
      ready++; if (ready === 2) { Atomics.store(gate, 0, 1); Atomics.notify(gate, 0, 2); }
    });
  }));
  assert.ok(results.every(result => result.closed === true));
  assert.ok(workers.every(worker => worker.threadId === -1));
  assert.equal(results.filter(r => r.success).length, 1);
  assert.match(results.find(r => !r.success)!.error!, /超过应收余额/);
  verify = new DatabaseSync(filename);
  assert.equal(count(verify, "receipts"), 1); assert.equal(count(verify, "audit_logs"), 1); assert.equal(count(verify, "idempotency_keys"), 1);
  assert.equal(verify.prepare("SELECT SUM(amount_cents) total FROM receipt_allocations").get()!.total, 60000);
});
