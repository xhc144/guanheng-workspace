import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { applyMigrations, migrationChecksum } from "../lib/migrations/index.ts";
import type { AdditiveOperation, Migration } from "../lib/migrations/index.ts";
import { initializeSchema } from "../lib/schema.ts";
import { inTransaction } from "../lib/db.ts";
import { oldSchemaSql, rowsSql, snapshot } from "./fixtures/migrations/helpers.ts";

function fixture(t: test.TestContext, old = true) {
  const root = mkdtempSync(join(tmpdir(), "gh-wp23-runner-")), filename = join(root, "synthetic.db");
  const db = new DatabaseSync(filename);
  if (old) { db.exec(oldSchemaSql); db.exec(rowsSql); }
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  return db;
}
function migration(id: string, operations: readonly AdditiveOperation[]): Migration {
  return { id, checksum: migrationChecksum(id, operations), operations };
}
const addition: AdditiveOperation = { kind: "addColumn", table: "receivables", column: { name: "synthetic_note", type: "TEXT", nullable: true } };
const schema = (db: DatabaseSync) => db.prepare("SELECT * FROM sqlite_schema ORDER BY name").all();

test("合成旧账、当前结构、空库：补列后索引、重复执行和历史逐列快照不变", t => {
  for (const state of ["old", "current", "empty"]) {
    const db = fixture(t, state !== "empty");
    if (state === "current") initializeSchema(db);
    const before = snapshot(db);
    const ops: AdditiveOperation[] = state === "empty" ? [{ kind: "createTable", table: "receivables", columns: [{ name: "id", type: "TEXT", nullable: false }], primaryKey: ["id"] }] : [];
    ops.push(addition, { kind: "createIndex", table: "receivables", name: "idx_synthetic_note", columns: ["synthetic_note"] });
    const item = migration(`synthetic.${state}.001`, ops);
    assert.deepEqual(applyMigrations(db, [item]), { applied: [item.id], skipped: [] });
    const after = schema(db);
    assert.deepEqual(applyMigrations(db, [item]), { applied: [], skipped: [item.id] });
    assert.deepEqual(schema(db), after); assert.deepEqual(snapshot(db, before), before);
    assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM schema_migrations").get()!.n, 1);
    assert.deepEqual(db.prepare("PRAGMA index_info(idx_synthetic_note)").all().map(r => r.name), ["synthetic_note"]);
  }
});

test("G0旧结构升级保留未知历史状态、CHECK、推定日期、作废原因与分摊", t => {
  const db = fixture(t);
  db.exec("UPDATE projects SET status='LEGACY_HOLD'; UPDATE service_periods SET status='LEGACY_REVIEW'");
  const before = snapshot(db), oldSql = db.prepare("SELECT sql FROM sqlite_schema WHERE name='projects'").get()!.sql;
  initializeSchema(db); initializeSchema(db);
  assert.deepEqual(snapshot(db, before), before);
  assert.equal(db.prepare("SELECT status FROM projects").get()!.status, "LEGACY_HOLD");
  assert.match(String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='projects'").get()!.sql), /LEGACY_HOLD/);
  assert.ok(String(oldSql).includes("CHECK"));
  assert.throws(() => db.exec("UPDATE projects SET status='UNDECLARED'"), /CHECK/);
  assert.equal(db.prepare("SELECT due_date_is_estimated FROM receivables WHERE id='synthetic-estimated'").get()!.due_date_is_estimated, 1);
  assert.equal(db.prepare("SELECT SUM(amount_cents) n FROM receipt_allocations").get()!.n, 100201);
  assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='idx_service_previous'").get()!.name, "idx_service_previous");
});

test("SQL样式默认文本是字面量；PK/唯一/外键/枚举/最小值真实执行", t => {
  const db = fixture(t), text = "'); DROP TABLE users; UPDATE receivables SET amount_cents=0; --\n中文";
  const item = migration("synthetic.constraints.001", [
    { ...addition, column: { name: "synthetic_note", type: "TEXT", nullable: false, default: { kind: "value", value: text } } },
    { kind: "createTable", table: "synthetic_records", columns: [
      { name: "id", type: "TEXT", nullable: false }, { name: "customer_id", type: "TEXT", nullable: false },
      { name: "amount_cents", type: "INTEGER", nullable: false, minimum: 0, default: { kind: "value", value: 0 } },
      { name: "state", type: "TEXT", nullable: false, oneOf: ["DRAFT", "DONE"], default: { kind: "value", value: "DRAFT" } },
      { name: "created_at", type: "TEXT", nullable: false, default: { kind: "currentTimestamp" } },
    ], primaryKey: ["id"], unique: [["customer_id", "state"]], foreignKeys: [{ columns: ["customer_id"], table: "customers", referencedColumns: ["id"] }] },
  ]);
  const before = snapshot(db); applyMigrations(db, [item]);
  assert.deepEqual(snapshot(db, before), before);
  assert.equal(db.prepare("SELECT synthetic_note FROM receivables LIMIT 1").get()!.synthetic_note, text);
  db.exec("INSERT INTO synthetic_records(id,customer_id) VALUES('one','synthetic-customer')");
  assert.equal(db.prepare("SELECT amount_cents FROM synthetic_records").get()!.amount_cents, 0);
  assert.match(String(db.prepare("SELECT created_at FROM synthetic_records").get()!.created_at), /^\d{4}-\d\d-\d\d /);
  for (const sql of [
    "INSERT INTO synthetic_records(id,customer_id,state) VALUES('one','synthetic-customer','DONE')",
    "INSERT INTO synthetic_records(id,customer_id) VALUES('two','synthetic-customer')",
    "INSERT INTO synthetic_records(id,customer_id) VALUES('two','missing')",
    "UPDATE synthetic_records SET state='DROP TABLE users'",
    "UPDATE synthetic_records SET amount_cents=-1",
  ]) assert.throws(() => db.exec(sql), /constraint/i);
});

test("完整批次先验证：未知键、SQL/回调/伪装操作及非JSON被拒绝，DDL和旧行不变", t => {
  const db = fixture(t), item = migration("synthetic.invalid.001", [addition]), before = snapshot(db), beforeSchema = schema(db);
  const invalid: unknown[] = [
    { ...item, up() {} }, { ...item, raw: "DELETE FROM users" }, { ...item, sql: "DROP TABLE users" },
    { ...item, exec: () => {} }, { ...item, prepare: "SELECT 1" },
    ...["dropTable", "exec", "raw", "up", "prepare", "delete"].map(kind => ({ ...item, operations: [{ kind, table: "users" }] })),
    { ...item, operations: [{ ...addition, sql: "DROP TABLE users" }] },
    { ...item, operations: [{ kind: "createIndex", table: "users", name: "x", columns: ["id"], where: "1=1" }] },
    ...["users;DROP TABLE users", "sqlite_internal", "x\"", "", "x".repeat(64)].map(table => ({ ...item, operations: [{ ...addition, table }] })),
    ...[NaN, Infinity, 1.5, 9007199254740992, undefined, () => 1, "CURRENT_TIMESTAMP"].map(value => ({ ...item, operations: [{ ...addition, column: { name: "bad", type: "INTEGER", nullable: false, default: { kind: "value", value } } }] })),
    ...[{ kind: "raw", value: "random()" }, { kind: "currentTimestamp" }, { kind: "value", value: null }, { kind: "value", value: "x", exec: "DROP" }].map(value => ({ ...item, operations: [{ ...addition, column: { name: "bad", type: "TEXT", nullable: false, default: value } }] })),
    { ...item, operations: [{ ...addition, column: { name: "bad", type: "TEXT", nullable: false } }] },
    { ...item, operations: [{ ...addition, column: { name: "bad", type: "TEXT", nullable: true, default: { kind: "value", value: "a\0b" } } }] },
    { ...item, operations: [{ ...addition, column: { name: "bad", type: "INTEGER", nullable: false, minimum: 3, default: { kind: "value", value: 2 } } }] },
    { ...item, operations: [{ ...addition, column: { name: "bad", type: "TEXT", nullable: false, oneOf: ["a"], default: { kind: "value", value: "b" } } }] },
    Object.assign(Object.create(null), item), new Proxy(item, {}),
    Object.defineProperty({ ...item }, "hidden", { value: true }),
  ];
  let getterCalls = 0;
  invalid.push({ ...item, operations: [{ get kind() { getterCalls++; return "addColumn"; }, table: "users" }] });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle; invalid.push(cycle);
  for (const bad of invalid) {
    // A valid prefix must not run if the later declaration is malformed.
    assert.throws(() => applyMigrations(db, [migration("valid.prefix", [addition]), bad as Migration]));
    assert.deepEqual(schema(db), beforeSchema); assert.deepEqual(snapshot(db, before), before);
  }
  assert.equal(getterCalls, 0);
});

test("校验和覆盖ID/operations；对象键序无关，数组序有意义，重复ID拒绝", t => {
  const db = fixture(t), item = migration("synthetic.hash.001", [addition]);
  const reordered = { column: { nullable: true, type: "TEXT", name: "synthetic_note" }, table: "receivables", kind: "addColumn" } as AdditiveOperation;
  assert.equal(migrationChecksum(item.id, [reordered]), item.checksum);
  const forged = { ...item, checksum: "0".repeat(64) };
  assert.throws(() => applyMigrations(db, [forged]), /校验和/);
  assert.throws(() => applyMigrations(db, [item, item]), /白名单/);
  const second: AdditiveOperation = { ...addition, column: { name: "second", type: "TEXT", nullable: true } };
  assert.notEqual(migrationChecksum(item.id, [addition, second]), migrationChecksum(item.id, [second, addition]));
  applyMigrations(db, [item]);
  const before = schema(db);
  assert.throws(() => applyMigrations(db, [{ ...item, id: "new.id" }]), /校验和/);
  assert.throws(() => applyMigrations(db, [migration(item.id, [second])]), /发生变化/);
  assert.deepEqual(schema(db), before);
});

test("唯一索引失败撤回整批DDL/账本，保留原账本，修正声明后可重试", t => {
  const db = fixture(t);
  const initial = migration("synthetic.initial", [{ kind: "createTable", table: "synthetic_duplicates", columns: [{ name: "value", type: "TEXT", nullable: false }] }]);
  applyMigrations(db, [initial]); db.exec("INSERT INTO synthetic_duplicates VALUES('same'),('same')");
  const before = snapshot(db), beforeSchema = schema(db);
  const first = migration("synthetic.rollback.001", [addition]);
  const bad = migration("synthetic.rollback.002", [{ kind: "createIndex", table: "synthetic_duplicates", name: "idx_duplicates", columns: ["value"], unique: true }]);
  assert.throws(() => applyMigrations(db, [first, bad]), /UNIQUE/);
  assert.deepEqual(schema(db), beforeSchema); assert.deepEqual(snapshot(db, before), before); assert.equal(db.isTransaction, false);
  const corrected = migration(bad.id, [{ kind: "createIndex", table: "synthetic_duplicates", name: "idx_duplicates", columns: ["value"] }]);
  assert.deepEqual(applyMigrations(db, [first, corrected]).applied, [first.id, bad.id]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM schema_migrations").get()!.n, 3);
});

test("首次失败不留下账本；不重建已有表、不忽略列/索引冲突", t => {
  const db = fixture(t), before = schema(db);
  const bad = migration("synthetic.first.failure", [addition, { kind: "createTable", table: "users", columns: [{ name: "id", type: "TEXT", nullable: false }] }]);
  assert.throws(() => applyMigrations(db, [bad]), /already exists/); assert.deepEqual(schema(db), before);
  assert.throws(() => applyMigrations(db, [migration("existing.column", [{ ...addition, column: { name: "name", type: "TEXT", nullable: true } }])]), /duplicate column/);
  assert.deepEqual(schema(db), before);
  assert.deepEqual(applyMigrations(db, []), { applied: [], skipped: [] }); assert.deepEqual(schema(db), before);
});

test("保留账本保护与账本漂移拒绝；禁用外键时拒绝迁移", t => {
  const db = fixture(t);
  for (const table of ["schema_migrations", "SCHEMA_MIGRATIONS"]) assert.throws(() => applyMigrations(db, [migration("reserved", [{ ...addition, table }])]), /内部账本/);
  db.exec("PRAGMA foreign_keys=OFF");
  assert.throws(() => applyMigrations(db, [migration("foreign.off", [addition])]), /外键/);
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(id TEXT)");
  assert.throws(() => applyMigrations(db, [migration("ledger.drift", [addition])]), /账本结构/);
});

test("嵌套事务外层失败一起撤回迁移；捕获内层失败只回滚保存点", t => {
  const db = fixture(t), before = schema(db), item = migration("nested.001", [addition]);
  assert.throws(() => inTransaction(db, () => { applyMigrations(db, [item]); throw new Error("outer failed"); }), /outer failed/);
  assert.deepEqual(schema(db), before);
  inTransaction(db, () => {
    db.exec("INSERT INTO departments VALUES('keep','虚构保留部门')");
    assert.throws(() => applyMigrations(db, [migration("nested.bad", [addition, { kind: "createIndex", table: "missing", name: "missing_index", columns: ["id"] }])]));
  });
  assert.equal(db.prepare("SELECT name FROM departments WHERE id='keep'").get()!.name, "虚构保留部门");
  assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='schema_migrations'").get(), undefined);
});

test("两个实际并发连接同库执行：一份DDL/账本，另一连接幂等跳过并等关闭", { timeout: 15000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "gh-wp23-concurrent-")), filename = join(root, "synthetic.db");
  new DatabaseSync(filename).close();
  const gate = new SharedArrayBuffer(4), workers: Worker[] = [];
  t.after(async () => { Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0); await Promise.all(workers.map(w => w.terminate())); rmSync(root, { recursive: true, force: true }); });
  let ready = 0;
  const item = migration("concurrent.001", [{ kind: "createTable", table: "synthetic_concurrent", columns: [{ name: "id", type: "TEXT", nullable: false }], primaryKey: ["id"] }]);
  const results = await Promise.all([1, 2].map(() => new Promise<{ applied: string[]; skipped: string[] }>((resolve, reject) => {
    let result: { applied: string[]; skipped: string[] } | undefined;
    const w = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
      (async()=>{const {DatabaseSync}=await import('node:sqlite');const {applyMigrations}=await import(workerData.module);
      const db=new DatabaseSync(workerData.filename);db.exec('PRAGMA busy_timeout=5000');parentPort.postMessage({ready:true});
      Atomics.wait(new Int32Array(workerData.gate),0,0);let result;try{result=applyMigrations(db,[workerData.item]);}finally{db.close();}
      parentPort.postMessage(result);})().catch(e=>{throw e;});`, { eval: true, workerData: { filename, gate, item, module: new URL("../lib/migrations/index.ts", import.meta.url).href } });
    workers.push(w); w.once("error", reject); w.once("exit", code => { if (code || !result) reject(new Error(`worker退出${code}或无结果`)); else resolve(result); });
    w.on("message", message => { if (message.ready) { ready++; if (ready === 2) { Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0, 2); } } else result = message; });
  })));
  assert.equal(results.reduce((n, r) => n + r.applied.length, 0), 1); assert.equal(results.reduce((n, r) => n + r.skipped.length, 0), 1);
  assert.ok(workers.every(w => w.threadId === -1));
  const verify = new DatabaseSync(filename);
  try { assert.equal(verify.prepare("SELECT COUNT(*) n FROM schema_migrations").get()!.n, 1); assert.equal(verify.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok"); } finally { verify.close(); }
});
