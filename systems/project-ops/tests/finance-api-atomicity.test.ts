import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server.js";
import { createSession } from "../lib/auth.ts";
import { openDatabase } from "../lib/db.ts";
import { createProjectCommissions } from "../lib/commissions.ts";

// Resolve the production route's existing Next/TypeScript aliases in Node's test runner.
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(fileURLToPath(new URL(`../${specifier.slice(2)}`, import.meta.url)), context);
  return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context);
} });
const { POST, PATCH } = await import("../app/api/finance/[kind]/route.ts");
hooks.deregister();

function fixture(t: TestContext) {
  const db = openDatabase(":memory:");
  db.exec(`INSERT INTO users(id,username,name,password_hash,role) VALUES
    ('admin','synthetic_admin','合成管理员','synthetic','ADMIN'),
    ('member','synthetic_member','合成成员','synthetic','PROJECT_MEMBER');
    INSERT INTO customers(id,name) VALUES('customer','纯合成事务客户');
    INSERT INTO contracts(id,number,name,customer_id,amount_cents) VALUES('contract','QA-ATOMIC','纯合成合同','customer',1000);
    INSERT INTO projects(id,name,customer_id,manager_user_id) VALUES('project','纯合成项目','customer','admin');
    INSERT INTO project_members(project_id,user_id,commission_basis_points) VALUES('project','member',1000);
    INSERT INTO receivables(id,contract_id,project_id,name,category,amount_cents,due_date)
      VALUES('receivable','contract','project','合成首款','首款',1000,'2026-10-29');`);
  createProjectCommissions(db, { projectId: "project", sourceType: "CONTRACT", sourceId: "contract", grossCents: 1000, releaseCondition: "首款" });
  const { token } = createSession(db, "admin");
  globalThis.__pmsDatabase = db;
  t.after(() => { globalThis.__pmsDatabase = undefined; db.close(); });
  const snapshot = () => Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name")
    .all().map(row => [String(row.name), db.prepare(`SELECT * FROM "${String(row.name).replaceAll('"', '""')}" ORDER BY rowid`).all()]));
  const request = (kind: string, method: string, body: unknown) => new NextRequest(`http://localhost/api/finance/${kind}`, {
    method, headers: { cookie: `pms_session=${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const payload = (kind: string) => ({ idempotencyKey: `atomic-${kind}`, customerId: "customer", amountCents: 1000,
    ...(kind === "invoices" ? { invoiceNumber: "QA-ATOMIC-INVOICE", invoiceDate: "2026-10-29" } : { receivedDate: "2026-10-29", referenceNumber: "QA-ATOMIC-RECEIPT" }),
    allocations: [{ receivableId: "receivable", amountCents: 1000 }] });
  const context = (kind: string) => ({ params: Promise.resolve({ kind }) });
  const rejectAudit = (kind: string, action: string) => db.exec(`CREATE TRIGGER reject_finance_audit BEFORE INSERT ON audit_logs
    WHEN NEW.entity_type='${kind === "invoices" ? "INVOICE" : "RECEIPT"}' AND NEW.action='${action}'
    BEGIN SELECT RAISE(ABORT,'QA_AUDIT_FAILURE'); END`);
  return { db, snapshot, request, payload, context, rejectAudit };
}

for (const kind of ["invoices", "receipts"]) for (const action of ["CREATE", "VOID"]) for (const revoke of ["inactive", "role"]) {
  test(`${kind} ${action} 等待请求正文时${revoke}撤权，写锁内必须重新鉴权且不写入`, async t => {
    const f = fixture(t);
    let body: unknown = f.payload(kind);
    if (action === "VOID") {
      const created = await POST(f.request(kind, "POST", body), f.context(kind));
      assert.equal(created.status, 201);
      body = { id: (await created.json()).id, reason: "纯合成撤权测试" };
    }
    const bytes = Buffer.from(JSON.stringify(body));
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) {
      controller = value; controller.enqueue(bytes.subarray(0, -1));
    } });
    const template = f.request(kind, action === "CREATE" ? "POST" : "PATCH", body);
    const request = new NextRequest(template.url, { method: template.method, headers: template.headers, body: stream });
    const pending = action === "CREATE" ? POST(request, f.context(kind)) : PATCH(request, f.context(kind));
    await new Promise<void>(resolve => setImmediate(resolve));
    f.db.exec(revoke === "inactive" ? "UPDATE users SET active=0 WHERE id='admin'" : "UPDATE users SET role='PROJECT_MEMBER' WHERE id='admin'");
    const before = f.snapshot();
    controller.enqueue(bytes.subarray(-1)); controller.close();
    const response = await pending;
    assert.equal(response.status, revoke === "inactive" ? 401 : 403);
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.db.isTransaction, false);
  });
}

for (const kind of ["invoices", "receipts"]) {
  test(`${kind} 创建审计失败回滚全部表，原幂等键可成功重试`, async t => {
    const f = fixture(t);
    f.rejectAudit(kind, "CREATE");
    const before = f.snapshot();
    assert.equal(Object.keys(before).length, 36);
    const failed = await POST(f.request(kind, "POST", f.payload(kind)), f.context(kind));
    assert.equal(failed.status, 400);
    assert.deepEqual(await failed.json(), { error: "QA_AUDIT_FAILURE" });
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.db.isTransaction, false);
    f.db.exec("DROP TRIGGER reject_finance_audit");
    const retry = await POST(f.request(kind, "POST", f.payload(kind)), f.context(kind));
    assert.equal(retry.status, 201);
    const { id } = await retry.json();
    assert.equal(f.db.prepare(`SELECT amount_cents FROM ${kind} WHERE id=?`).get(id)!.amount_cents, 1000);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='CREATE' AND entity_type=? AND entity_id=?")
      .get(kind === "invoices" ? "INVOICE" : "RECEIPT", id)!.n, 1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM idempotency_keys WHERE key=?").get(`atomic-${kind}`)!.n, 1);
    if (kind === "receipts") assert.equal(f.db.prepare("SELECT status FROM commission_accruals").get()!.status, "PAYABLE");
  });

  test(`${kind} 作废审计失败回滚全部表，重试保留原分摊并写一条作废审计`, async t => {
    const f = fixture(t);
    const created = await POST(f.request(kind, "POST", f.payload(kind)), f.context(kind));
    assert.equal(created.status, 201);
    const { id } = await created.json();
    f.rejectAudit(kind, "VOID");
    const before = f.snapshot(), body = { id, reason: "纯合成流水纠正" };
    const failed = await PATCH(f.request(kind, "PATCH", body), f.context(kind));
    assert.equal(failed.status, 400);
    assert.deepEqual(await failed.json(), { error: "QA_AUDIT_FAILURE" });
    assert.deepEqual(f.snapshot(), before);
    assert.equal(f.db.isTransaction, false);
    f.db.exec("DROP TRIGGER reject_finance_audit");
    const retry = await PATCH(f.request(kind, "PATCH", body), f.context(kind));
    assert.equal(retry.status, 200);
    assert.equal(f.db.prepare(`SELECT void_reason FROM ${kind} WHERE id=?`).get(id)!.void_reason, body.reason);
    const allocationTable = kind === "invoices" ? "invoice_allocations" : "receipt_allocations";
    assert.equal(f.db.prepare(`SELECT amount_cents FROM ${allocationTable}`).get()!.amount_cents, 1000);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='VOID' AND entity_type=? AND entity_id=?")
      .get(kind === "invoices" ? "INVOICE" : "RECEIPT", id)!.n, 1);
  });
}
