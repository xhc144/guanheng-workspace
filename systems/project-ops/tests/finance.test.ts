import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { inTransaction, openDatabase } from "../lib/db.ts";
import { createInvoiceWithAllocations, createReceiptWithAllocations, getReceivableStatus, voidFinanceRecord } from "../lib/finance.ts";
import { initializeSchema } from "../lib/schema.ts";
import type { SessionUser } from "../lib/auth.ts";
import { createFinanceEntry, voidFinanceEntry } from "../app/api/finance/service.ts";
import { createReceivableRecord, saveContractRecord, voidBusinessEntry } from "../app/contracts/service.ts";
import { publishRuleVersion, saveRuleDraft } from "../lib/rules.ts";

function fixture() {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO departments (id, name) VALUES ('d1', '交付部')").run();
  db.prepare(`INSERT INTO users (id, username, name, password_hash, role, department_id)
    VALUES ('u1', 'admin', '管理员', 'test', 'ADMIN', 'd1')`).run();
  db.prepare(`INSERT INTO customers (id, name, owner_user_id, department_id)
    VALUES ('c1', '测试客户', 'u1', 'd1')`).run();
  db.prepare(`INSERT INTO contracts (id, number, name, customer_id, amount_cents)
    VALUES ('ct1', 'HT-TEST', '测试合同', 'c1', 200000)`).run();
  db.prepare(`INSERT INTO receivables
    (id, contract_id, name, category, amount_cents, due_date, owner_user_id)
    VALUES ('r1', 'ct1', '首期款', '首期款', 100000, '2026-01-01', 'u1'),
           ('r2', 'ct1', '验收款', '验收款', 100000, '2026-12-31', 'u1')`).run();
  return db;
}

test("invoice and receipt support partial and cross-receivable allocations", () => {
  const db = fixture();
  createInvoiceWithAllocations(db, {
    idempotencyKey: "invoice-1", invoiceNumber: "FP-001", customerId: "c1", invoiceDate: "2026-02-01",
    amountCents: 120000, allocations: [{ receivableId: "r1", amountCents: 60000 }, { receivableId: "r2", amountCents: 60000 }],
  });
  createReceiptWithAllocations(db, {
    idempotencyKey: "receipt-1", customerId: "c1", receivedDate: "2026-02-02", amountCents: 90000,
    allocations: [{ receivableId: "r1", amountCents: 40000 }, { receivableId: "r2", amountCents: 50000 }],
  });
  assert.deepEqual(getReceivableStatus(db, "r1", "2026-08-29"), {
    amountCents: 100000, invoicedCents: 60000, receivedCents: 40000,
    invoiceStatus: "PARTIAL", receiptStatus: "PARTIAL", overdue: true, voided: false,
  });
});

test("one receivable supports repeated invoices and receipts from partial to full", () => {
  const db = fixture();
  createInvoiceWithAllocations(db, {
    idempotencyKey: "invoice-repeat-1", invoiceNumber: "FP-101", customerId: "c1", invoiceDate: "2026-02-01",
    amountCents: 40000, allocations: [{ receivableId: "r1", amountCents: 40000 }],
  });
  createReceiptWithAllocations(db, {
    idempotencyKey: "receipt-repeat-1", customerId: "c1", receivedDate: "2026-02-02", amountCents: 30000,
    allocations: [{ receivableId: "r1", amountCents: 30000 }],
  });
  assert.deepEqual(getReceivableStatus(db, "r1", "2026-08-29"), {
    amountCents: 100000, invoicedCents: 40000, receivedCents: 30000,
    invoiceStatus: "PARTIAL", receiptStatus: "PARTIAL", overdue: true, voided: false,
  });
  createInvoiceWithAllocations(db, {
    idempotencyKey: "invoice-repeat-2", invoiceNumber: "FP-102", customerId: "c1", invoiceDate: "2026-02-03",
    amountCents: 60000, allocations: [{ receivableId: "r1", amountCents: 60000 }],
  });
  createReceiptWithAllocations(db, {
    idempotencyKey: "receipt-repeat-2", customerId: "c1", receivedDate: "2026-02-04", amountCents: 70000,
    allocations: [{ receivableId: "r1", amountCents: 70000 }],
  });
  assert.deepEqual(getReceivableStatus(db, "r1", "2026-08-29"), {
    amountCents: 100000, invoicedCents: 100000, receivedCents: 100000,
    invoiceStatus: "FULL", receiptStatus: "FULL", overdue: false, voided: false,
  });
  assert.equal((db.prepare("SELECT COUNT(*) count FROM invoices").get() as { count: number }).count, 2);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM receipts").get() as { count: number }).count, 2);
});

test("voided invoice and receipt restore capacity and can be re-recorded", () => {
  const db = fixture();
  const invoiceId = createInvoiceWithAllocations(db, {
    idempotencyKey: "invoice-before-void", invoiceNumber: "FP-201", customerId: "c1", invoiceDate: "2026-02-01",
    amountCents: 100000, allocations: [{ receivableId: "r1", amountCents: 100000 }],
  });
  const receiptId = createReceiptWithAllocations(db, {
    idempotencyKey: "receipt-before-void", customerId: "c1", receivedDate: "2026-02-02", amountCents: 100000,
    allocations: [{ receivableId: "r1", amountCents: 100000 }],
  });
  voidFinanceRecord(db, { kind: "invoices", id: invoiceId, reason: "号码录错" });
  voidFinanceRecord(db, { kind: "receipts", id: receiptId, reason: "流水录错" });
  const restored = getReceivableStatus(db, "r1", "2026-08-29");
  assert.equal(restored.invoicedCents, 0);
  assert.equal(restored.receivedCents, 0);
  assert.equal(restored.invoiceStatus, "NONE");
  assert.equal(restored.receiptStatus, "NONE");
  createInvoiceWithAllocations(db, {
    idempotencyKey: "invoice-after-void", invoiceNumber: "FP-202", customerId: "c1", invoiceDate: "2026-02-03",
    amountCents: 100000, allocations: [{ receivableId: "r1", amountCents: 100000 }],
  });
  createReceiptWithAllocations(db, {
    idempotencyKey: "receipt-after-void", customerId: "c1", receivedDate: "2026-02-04", amountCents: 100000,
    allocations: [{ receivableId: "r1", amountCents: 100000 }],
  });
  const rerecorded = getReceivableStatus(db, "r1", "2026-08-29");
  assert.equal(rerecorded.invoiceStatus, "FULL");
  assert.equal(rerecorded.receiptStatus, "FULL");
  assert.equal((db.prepare("SELECT COUNT(*) count FROM invoices WHERE voided_at IS NOT NULL").get() as { count: number }).count, 1);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM receipts WHERE voided_at IS NOT NULL").get() as { count: number }).count, 1);
});

test("over-allocation rolls back the entire receipt", () => {
  const db = fixture();
  assert.throws(() => createReceiptWithAllocations(db, {
    idempotencyKey: "too-much", customerId: "c1", receivedDate: "2026-02-02", amountCents: 150000,
    allocations: [{ receivableId: "r1", amountCents: 100001 }],
  }), /超过应收余额/);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM receipts").get() as { count: number }).count, 0);
});

test("over-allocation rolls back the entire invoice", () => {
  const db = fixture();
  assert.throws(() => createInvoiceWithAllocations(db, {
    idempotencyKey: "invoice-too-much", invoiceNumber: "FP-301", customerId: "c1", invoiceDate: "2026-02-02",
    amountCents: 150000, allocations: [{ receivableId: "r1", amountCents: 100001 }],
  }), /超过应收余额/);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM invoices").get() as { count: number }).count, 0);
});

test("finance records reject unallocated balances", () => {
  const db = fixture();
  assert.throws(() => createReceiptWithAllocations(db, {
    idempotencyKey: "receipt-short", customerId: "c1", receivedDate: "2026-02-02", amountCents: 10000,
    allocations: [{ receivableId: "r1", amountCents: 9999 }],
  }), /必须等于回款金额/);
  assert.throws(() => createInvoiceWithAllocations(db, {
    idempotencyKey: "invoice-short", invoiceNumber: "FP-SHORT", customerId: "c1", invoiceDate: "2026-02-02", amountCents: 10000,
    allocations: [{ receivableId: "r1", amountCents: 9999 }],
  }), /必须等于发票金额/);
});

test("estimated receivable dates never become overdue", () => {
  const db = fixture();
  db.prepare("UPDATE receivables SET due_date_is_estimated=1 WHERE id='r1'").run();
  assert.equal(getReceivableStatus(db, "r1", "2026-08-29").overdue, false);
});

test("idempotency key prevents duplicate receipt", () => {
  const db = fixture();
  const input = {
    idempotencyKey: "same", customerId: "c1", receivedDate: "2026-02-02", amountCents: 10000,
    allocations: [{ receivableId: "r1", amountCents: 10000 }],
  };
  const first = createReceiptWithAllocations(db, input);
  const second = createReceiptWithAllocations(db, input);
  assert.equal(first, second);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM receipts").get() as { count: number }).count, 1);
  assert.throws(() => createReceiptWithAllocations(db, { ...input, amountCents: 20000 }), /请求内容不一致/);
});

test("idempotency key prevents duplicate invoice and rejects changed payload", () => {
  const db = fixture();
  const input = {
    idempotencyKey: "same-invoice", invoiceNumber: "FP-401", customerId: "c1", invoiceDate: "2026-02-02",
    amountCents: 10000, allocations: [{ receivableId: "r1", amountCents: 10000 }],
  };
  const first = createInvoiceWithAllocations(db, input);
  const second = createInvoiceWithAllocations(db, input);
  assert.equal(first, second);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM invoices").get() as { count: number }).count, 1);
  assert.throws(() => createInvoiceWithAllocations(db, { ...input, invoiceNumber: "FP-402" }), /请求内容不一致/);
});

test("existing databases migrate the idempotency request hash column without losing keys", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE idempotency_keys (
    key TEXT PRIMARY KEY, operation TEXT NOT NULL, result_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.prepare("INSERT INTO idempotency_keys (key,operation,result_id) VALUES ('legacy','CREATE_RECEIPT','old-id')").run();
  initializeSchema(db);
  const columns = db.prepare("PRAGMA table_info(idempotency_keys)").all() as { name: string }[];
  assert.ok(columns.some(column => column.name === "request_hash"));
  const row = db.prepare("SELECT result_id,request_hash FROM idempotency_keys WHERE key='legacy'").get() as Record<string, unknown>;
  assert.equal(row.result_id, "old-id");
  assert.equal(row.request_hash, null);
});

test("allocation rejects a receivable owned by another customer", () => {
  const db = fixture();
  db.prepare("INSERT INTO customers (id,name,owner_user_id,department_id) VALUES ('c2','其他客户','u1','d1')").run();
  assert.throws(() => createReceiptWithAllocations(db, {
    idempotencyKey: "wrong-customer", customerId: "c2", receivedDate: "2026-02-02", amountCents: 10000,
    allocations: [{ receivableId: "r1", amountCents: 10000 }],
  }), /客户不一致/);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM receipts").get() as { count: number }).count, 0);
});

test("voided contracts reject new invoice and receipt allocations", () => {
  const db = fixture();
  db.prepare("UPDATE contracts SET status='VOID' WHERE id='ct1'").run();
  assert.throws(() => createInvoiceWithAllocations(db, {
    idempotencyKey: "void-contract-invoice", invoiceNumber: "FP-VOID", customerId: "c1", invoiceDate: "2026-02-02",
    amountCents: 10000, allocations: [{ receivableId: "r1", amountCents: 10000 }],
  }), /不存在或已作废/);
  assert.throws(() => createReceiptWithAllocations(db, {
    idempotencyKey: "void-contract-receipt", customerId: "c1", receivedDate: "2026-02-02", amountCents: 10000,
    allocations: [{ receivableId: "r1", amountCents: 10000 }],
  }), /不存在或已作废/);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM invoices").get() as { count: number }).count, 0);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM receipts").get() as { count: number }).count, 0);
});

// Exercise the same transaction services used by route handlers and server actions.
const financeActor: SessionUser = { id: "u1", username: "admin", name: "管理员", email: null, role: "ADMIN", departmentId: "d1" };
const receiptInput = (overrides = {}) => ({ idempotencyKey: "audited-receipt", customerId: "c1", receivedDate: "2026-02-02", amountCents: 100000, allocations: [{ receivableId: "r1", amountCents: 100000 }], ...overrides });
const invoiceInput = (overrides = {}) => ({ ...receiptInput(), idempotencyKey: "audited-invoice", invoiceNumber: "FP-AUDIT", invoiceDate: "2026-02-02", ...overrides });
const contractInput = (overrides = {}) => ({ idempotencyKey: "contract-audit", number: "HT-AUDIT", name: "合成测试合同", customerId: "c1", signedDate: "2026-02-02", amount: "1000.00", status: "ACTIVE", description: "", ...overrides });
const receivableInput = (overrides = {}) => ({ idempotencyKey: "receivable-audit", contractId: "ct1", projectId: "", name: "自定义里程款", category: "历史自定义类型", amount: "123.45", dueDate: "2026-02-02", notes: "", ...overrides });
function count(db: DatabaseSync, table: string) { return Number((db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n); }
function causedBy(message: string) {
  return (error: unknown) => error instanceof Error && /数据已回滚/.test(error.message) && error.cause instanceof Error && error.cause.message === message;
}
function rejectAudits(db: DatabaseSync) { db.exec("CREATE TEMP TRIGGER reject_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit failure injection'); END"); }
function projectFixture(db: DatabaseSync) {
  db.exec("INSERT INTO projects (id,name,customer_id) VALUES ('p1','合成项目','c1'); UPDATE receivables SET project_id='p1' WHERE id='r1'");
  db.exec(`INSERT INTO commission_accruals (id,project_id,user_id,source_type,source_id,gross_cents,basis_points,commission_cents,release_condition,status)
    VALUES ('ac1','p1','u1','CONTRACT','ct1',100000,100,1000,'首期款','BLOCKED')`);
}

for (const kind of ["invoices", "receipts"] as const) {
  test(`${kind}: audit failure rolls back source, allocation, request hash and eligibility`, () => {
    const db = fixture(); projectFixture(db); rejectAudits(db);
    const input = kind === "invoices" ? invoiceInput() : receiptInput();
    assert.throws(() => createFinanceEntry(db, financeActor, kind, input), causedBy("audit failure injection"));
    assert.equal(count(db, kind), 0); assert.equal(count(db, kind === "invoices" ? "invoice_allocations" : "receipt_allocations"), 0);
    assert.equal(count(db, "idempotency_keys"), 0); assert.equal(count(db, "audit_logs"), 0);
    assert.equal(db.prepare("SELECT status FROM commission_accruals WHERE id='ac1'").get()?.status, "BLOCKED");
    db.exec("DROP TRIGGER reject_audit");
    assert.equal(createFinanceEntry(db, financeActor, kind, input).replayed, false);
    assert.equal(count(db, "audit_logs"), 1); db.close();
  });
  test(`${kind}: same request replays once, changed request conflicts, void retry preserves history`, () => {
    const db = fixture(), input = kind === "invoices" ? invoiceInput() : receiptInput();
    const result = createFinanceEntry(db, financeActor, kind, input, "127.0.0.7");
    assert.deepEqual(createFinanceEntry(db, financeActor, kind, input), { id: result.id, replayed: true });
    assert.equal(count(db, kind), 1); assert.equal(count(db, "audit_logs"), 1);
    assert.throws(() => createFinanceEntry(db, financeActor, kind, { ...input, notes: "changed" }), /请求内容不一致/);
    assert.equal(count(db, "audit_logs"), 1);
    rejectAudits(db);
    assert.throws(() => voidFinanceEntry(db, financeActor, kind, { id: result.id, reason: "录入更正" }), causedBy("audit failure injection"));
    assert.equal(db.prepare(`SELECT voided_at FROM ${kind} WHERE id=?`).get(result.id)?.voided_at, null);
    db.exec("DROP TRIGGER reject_audit");
    voidFinanceEntry(db, financeActor, kind, { id: result.id, reason: "录入更正" });
    assert.equal(voidFinanceEntry(db, financeActor, kind, { id: result.id, reason: "录入更正" }).replayed, true);
    assert.throws(() => voidFinanceEntry(db, financeActor, kind, { id: result.id, reason: "更改历史" }), /不能更改原作废原因/);
    assert.equal(count(db, "audit_logs"), 2);
    assert.equal(db.prepare(`SELECT void_reason FROM ${kind} WHERE id=?`).get(result.id)?.void_reason, "录入更正");
    assert.equal(count(db, kind === "invoices" ? "invoice_allocations" : "receipt_allocations"), 1);
    assert.equal(createFinanceEntry(db, financeActor, kind, input).id, result.id);
    const correction = { ...input, idempotencyKey: `${input.idempotencyKey}-corrected`, invoiceNumber: "FP-CORRECTED" };
    assert.notEqual(createFinanceEntry(db, financeActor, kind, correction).id, result.id);
    assert.equal(count(db, kind), 2); assert.equal(count(db, "audit_logs"), 3);
    db.close();
  });
}

test("receipt replay skips later published rules and eligibility writes", () => {
  const db = fixture(); projectFixture(db);
  const rule = saveRuleDraft(db, { name: "首次到账提醒", triggerEvent: "RECEIPT_CREATED", condition: { field: "status", op: "eq", value: "PAID" }, formula: { op: "literal", value: 1 }, action: { type: "CREATE_NOTIFICATION", title: "合成通知" } });
  publishRuleVersion(db, rule.ruleId, rule.versionId, "u1");
  const result = createFinanceEntry(db, financeActor, "receipts", receiptInput());
  assert.equal(count(db, "rule_executions"), 1); assert.equal(count(db, "notifications"), 1);
  assert.equal(db.prepare("SELECT status FROM commission_accruals WHERE id='ac1'").get()?.status, "PAYABLE");
  db.exec("UPDATE commission_accruals SET status='BLOCKED' WHERE id='ac1'");
  const later = saveRuleDraft(db, { name: "后发布规则", triggerEvent: "RECEIPT_CREATED", condition: { field: "status", op: "eq", value: "PAID" }, formula: { op: "literal", value: 1 }, action: { type: "CREATE_NOTIFICATION", title: "后发布通知" } });
  publishRuleVersion(db, later.ruleId, later.versionId, "u1");
  assert.equal(createFinanceEntry(db, financeActor, "receipts", receiptInput()).id, result.id);
  assert.equal(count(db, "rule_executions"), 1); assert.equal(count(db, "notifications"), 1);
  assert.equal(db.prepare("SELECT status FROM commission_accruals WHERE id='ac1'").get()?.status, "BLOCKED");
  db.close();
});

test("receipt void refreshes affected project eligibility in the same rollback boundary", () => {
  const db = fixture(); projectFixture(db);
  const receipt = createFinanceEntry(db, financeActor, "receipts", receiptInput());
  db.exec("UPDATE receivables SET project_id='p1' WHERE id='r2'");
  createReceiptWithAllocations(db, receiptInput({ idempotencyKey: "other-category-receipt", allocations: [{ receivableId: "r2", amountCents: 100000 }] }));
  db.exec("UPDATE commission_accruals SET status='BLOCKED',release_condition='验收款' WHERE id='ac1'");
  db.exec("CREATE TEMP TRIGGER reject_refresh BEFORE UPDATE ON commission_accruals BEGIN SELECT RAISE(ABORT, 'eligibility failure injection'); END");
  assert.throws(() => voidFinanceEntry(db, financeActor, "receipts", { id: receipt.id, reason: "回款纠错" }), causedBy("eligibility failure injection"));
  assert.equal(db.prepare("SELECT voided_at FROM receipts WHERE id=?").get(receipt.id)?.voided_at, null);
  assert.equal(db.prepare("SELECT status FROM commission_accruals WHERE id='ac1'").get()?.status, "BLOCKED");
  assert.equal(count(db, "audit_logs"), 1);
  db.exec("DROP TRIGGER reject_refresh");
  voidFinanceEntry(db, financeActor, "receipts", { id: receipt.id, reason: "回款纠错" });
  assert.equal(db.prepare("SELECT status FROM commission_accruals WHERE id='ac1'").get()?.status, "PAYABLE");
  assert.equal(count(db, "audit_logs"), 2); db.close();
});

for (const role of ["DEPARTMENT_MANAGER", "PROJECT_MEMBER"] as const) test(`${role} cannot register or void finance records`, () => {
  const db = fixture(), actor = { ...financeActor, role };
  assert.throws(() => createFinanceEntry(db, actor, "receipts", receiptInput()), /仅管理员或财务/);
  assert.throws(() => voidFinanceEntry(db, actor, "receipts", { id: "missing", reason: "测试原因" }), /仅管理员或财务/);
  assert.equal(count(db, "receipts"), 0); assert.equal(count(db, "audit_logs"), 0); assert.equal(count(db, "idempotency_keys"), 0); db.close();
});

test("audited boundary rejects cross-customer, duplicate allocation, invalid dates and unsafe amounts", () => {
  const db = fixture(); db.exec("INSERT INTO customers (id,name) VALUES ('c2','另一合成客户')");
  for (const input of [receiptInput({ customerId: "c2" }), receiptInput({ allocations: [{ receivableId: "r1", amountCents: 50000 }, { receivableId: "r1", amountCents: 50000 }] }), receiptInput({ receivedDate: "2026-02-30" }), receiptInput({ amountCents: Number.MAX_SAFE_INTEGER + 1 })]) {
    assert.throws(() => createFinanceEntry(db, financeActor, "receipts", input));
  }
  assert.throws(() => createFinanceEntry(db, financeActor, "invoices", invoiceInput({ taxCents: 100001 })), /税额/);
  assert.throws(() => voidFinanceRecord(db, { kind: "receipts; DROP TABLE customers" as never, id: "x", reason: "测试" }), /类型不存在/);
  assert.equal(count(db, "receipts"), 0); assert.equal(count(db, "invoices"), 0); assert.equal(count(db, "audit_logs"), 0); db.close();
});

test("contract create, edit and void audit failures restore exact prior data", () => {
  const db = fixture(); rejectAudits(db);
  assert.throws(() => saveContractRecord(db, financeActor, contractInput()), causedBy("audit failure injection"));
  assert.equal(count(db, "contracts"), 1); assert.equal(count(db, "idempotency_keys"), 0);
  db.exec("DROP TRIGGER reject_audit");
  const created = saveContractRecord(db, financeActor, contractInput());
  assert.equal(saveContractRecord(db, financeActor, contractInput()).id, created.id); assert.equal(count(db, "audit_logs"), 1);
  rejectAudits(db);
  assert.throws(() => saveContractRecord(db, financeActor, contractInput({ id: created.id, idempotencyKey: "contract-edit", name: "修改但回滚" })), causedBy("audit failure injection"));
  assert.equal(db.prepare("SELECT name FROM contracts WHERE id=?").get(created.id)?.name, "合成测试合同");
  assert.throws(() => voidBusinessEntry(db, financeActor, { type: "contract", id: created.id, reason: "更正合同" }), causedBy("audit failure injection"));
  assert.equal(db.prepare("SELECT status FROM contracts WHERE id=?").get(created.id)?.status, "ACTIVE");
  assert.equal(count(db, "idempotency_keys"), 1); db.close();
});

test("receivable audit failure, idempotent replay, custom category and department project scope", () => {
  const db = fixture(); rejectAudits(db);
  assert.throws(() => createReceivableRecord(db, financeActor, receivableInput()), causedBy("audit failure injection"));
  assert.equal(count(db, "receivables"), 2); assert.equal(count(db, "idempotency_keys"), 0);
  db.exec("DROP TRIGGER reject_audit");
  const result = createReceivableRecord(db, financeActor, receivableInput());
  assert.equal(createReceivableRecord(db, financeActor, receivableInput()).id, result.id);
  assert.equal(count(db, "receivables"), 3); assert.equal(count(db, "audit_logs"), 1);
  assert.equal(db.prepare("SELECT category FROM receivables WHERE id=?").get(result.id)?.category, "历史自定义类型");
  assert.throws(() => createReceivableRecord(db, financeActor, receivableInput({ amount: "0" })), /大于0/);
  assert.throws(() => createReceivableRecord(db, { ...financeActor, role: "PROJECT_MEMBER" }, receivableInput()), /无权/);
  db.exec("INSERT INTO departments (id,name) VALUES ('d2','其他部'); INSERT INTO projects (id,name,customer_id,department_id) VALUES ('p2','外部门项目','c1','d2')");
  assert.throws(() => createReceivableRecord(db, { ...financeActor, role: "DEPARTMENT_MANAGER" }, receivableInput({ idempotencyKey: "manager-scope", projectId: "p2" })), /无权访问/);
  assert.throws(() => createReceivableRecord(db, { ...financeActor, role: "DEPARTMENT_MANAGER", departmentId: "d2" }, receivableInput({ idempotencyKey: "manager-customer" })), /无权访问/);
  rejectAudits(db);
  assert.throws(() => voidBusinessEntry(db, financeActor, { type: "receivable", id: result.id, reason: "应收更正" }), causedBy("audit failure injection"));
  assert.equal(db.prepare("SELECT voided_at FROM receivables WHERE id=?").get(result.id)?.voided_at, null); db.close();
});

test("contracts and receivables with live allocations require source correction before void", () => {
  const db = fixture(); createFinanceEntry(db, financeActor, "receipts", receiptInput());
  for (const [type, id] of [["receivable", "r1"], ["contract", "ct1"]]) assert.throws(() => voidBusinessEntry(db, financeActor, { type, id, reason: "误操作" }), /先作废对应/);
  assert.equal(db.prepare("SELECT status FROM contracts WHERE id='ct1'").get()?.status, "ACTIVE");
  assert.equal(getReceivableStatus(db, "r1").voided, false); assert.equal(count(db, "audit_logs"), 1); db.close();
});

test("blank optional receipt references allow independent entries without changing replay hashes", () => {
  const db = fixture();
  const first = receiptInput({ idempotencyKey: "blank-reference-one", referenceNumber: "", amountCents: 10000, allocations: [{ receivableId: "r1", amountCents: 10000 }] });
  // Simulate an old caller's key. The request_hash representation remains unchanged.
  const oldId = createReceiptWithAllocations(db, first);
  assert.equal(createFinanceEntry(db, financeActor, "receipts", first).id, oldId);
  const second = createFinanceEntry(db, financeActor, "receipts", { ...first, idempotencyKey: "blank-reference-two" });
  assert.notEqual(second.id, oldId);
  assert.equal(count(db, "receipts"), 2); assert.equal(count(db, "audit_logs"), 1);
  assert.equal(db.prepare("SELECT reference_number FROM receipts WHERE id=?").get(second.id)?.reference_number, null); db.close();
});

test("cross-receivable audited replay ignores allocation order and preserves exact integer totals", () => {
  const db = fixture();
  const input = receiptInput({ amountCents: 100001, allocations: [{ receivableId: "r1", amountCents: 50001 }, { receivableId: "r2", amountCents: 50000 }] });
  const created = createFinanceEntry(db, financeActor, "receipts", input);
  assert.equal(createFinanceEntry(db, financeActor, "receipts", { ...input, allocations: [...input.allocations].reverse() }).id, created.id);
  assert.equal(db.prepare("SELECT SUM(amount_cents) total FROM receipt_allocations").get()?.total, 100001);
  assert.equal(db.prepare("SELECT amount_cents FROM receipts WHERE id=?").get(created.id)?.amount_cents, 100001);
  assert.equal(count(db, "audit_logs"), 1);
  assert.throws(() => createFinanceEntry(db, financeActor, "invoices", invoiceInput({ idempotencyKey: input.idempotencyKey })), /其他操作/);
  assert.equal(count(db, "invoices"), 0);
  db.exec("INSERT INTO idempotency_keys (key,operation,result_id) VALUES ('legacy-no-hash','CREATE_RECEIPT','legacy-source')");
  assert.throws(() => createFinanceEntry(db, financeActor, "receipts", receiptInput({ idempotencyKey: "legacy-no-hash" })), /历史幂等键/);
  assert.equal(count(db, "receipts"), 1); assert.equal(count(db, "audit_logs"), 1); db.close();
});

test("an outer transaction rollback also rolls back audited nested services", () => {
  const db = fixture();
  assert.throws(() => inTransaction(db, () => {
    createFinanceEntry(db, financeActor, "receipts", receiptInput());
    saveContractRecord(db, financeActor, contractInput());
    createReceivableRecord(db, financeActor, receivableInput());
    throw new Error("outer failure injection");
  }), /outer failure injection/);
  assert.equal(count(db, "receipts"), 0); assert.equal(count(db, "receipt_allocations"), 0);
  assert.equal(count(db, "contracts"), 1); assert.equal(count(db, "receivables"), 2);
  assert.equal(count(db, "idempotency_keys"), 0); assert.equal(count(db, "audit_logs"), 0);
  assert.equal(createFinanceEntry(db, financeActor, "receipts", receiptInput()).replayed, false); db.close();
});

test("contract editing checks member scope and preserves customer identity", () => {
  const db = fixture(), member = { ...financeActor, id: "u2", role: "PROJECT_MEMBER" as const };
  db.exec("INSERT INTO users (id,username,name,password_hash,role) VALUES ('u2','scope-member','合成员工','test','PROJECT_MEMBER'); INSERT INTO projects (id,name,customer_id,manager_user_id) VALUES ('p2','同客户未关联合同项目','c1','u2')");
  assert.throws(() => saveContractRecord(db, member, contractInput()), /无权创建/);
  assert.throws(() => saveContractRecord(db, member, contractInput({ id: "ct1" })), /无权修改/);
  db.exec("INSERT INTO customers (id,name) VALUES ('c2','其他合成客户')");
  assert.throws(() => saveContractRecord(db, financeActor, contractInput({ id: "ct1", customerId: "c2" })), /不可更换客户/);
  assert.equal(db.prepare("SELECT customer_id FROM contracts WHERE id='ct1'").get()?.customer_id, "c1");
  assert.equal(count(db, "audit_logs"), 0); assert.equal(count(db, "idempotency_keys"), 0); db.close();
});

test("contract edits replay once and successful business voids preserve before snapshots", () => {
  const db = fixture();
  const created = saveContractRecord(db, financeActor, contractInput());
  const edit = contractInput({ id: created.id, idempotencyKey: "contract-real-edit", name: "更新后的合成合同", description: "保留原始说明" });
  assert.equal(saveContractRecord(db, financeActor, edit).replayed, false);
  assert.equal(saveContractRecord(db, financeActor, edit).replayed, true);
  assert.equal(count(db, "audit_logs"), 2);
  const updateAudit = db.prepare("SELECT before_json,after_json FROM audit_logs WHERE entity_id=? AND action='UPDATE'").get(created.id) as { before_json: string; after_json: string };
  assert.equal(JSON.parse(updateAudit.before_json).name, "合成测试合同");
  assert.equal(JSON.parse(updateAudit.after_json).name, "更新后的合成合同");
  voidBusinessEntry(db, financeActor, { id: created.id, type: "contract", reason: "合成合同纠错" });
  const contract = db.prepare("SELECT status,description FROM contracts WHERE id=?").get(created.id);
  assert.equal(contract?.status, "VOID"); assert.equal(contract?.description, "保留原始说明\n作废：合成合同纠错");
  assert.throws(() => saveContractRecord(db, financeActor, { ...edit, idempotencyKey: "edit-void-contract" }), /已作废/);
  const receivable = createReceivableRecord(db, financeActor, receivableInput());
  voidBusinessEntry(db, financeActor, { id: receivable.id, type: "receivable", reason: "合成应收纠错" });
  const row = db.prepare("SELECT voided_at,void_reason FROM receivables WHERE id=?").get(receivable.id);
  assert.ok(row?.voided_at); assert.equal(row?.void_reason, "合成应收纠错");
  assert.equal(count(db, "receivables"), 3); assert.equal(count(db, "audit_logs"), 5); db.close();
});

test("receivable replay survives source soft-void while new writes remain forbidden", () => {
  const db = fixture(); projectFixture(db);
  const input = receivableInput({ projectId: "p1" });
  const created = createReceivableRecord(db, financeActor, input);
  db.exec("UPDATE projects SET status='VOID' WHERE id='p1'");
  assert.equal(createReceivableRecord(db, financeActor, input).id, created.id);
  assert.throws(() => createReceivableRecord(db, financeActor, { ...input, idempotencyKey: "after-project-void" }), /项目已作废/);
  db.exec("UPDATE contracts SET status='VOID' WHERE id='ct1'");
  assert.equal(createReceivableRecord(db, financeActor, input).replayed, true);
  assert.throws(() => createReceivableRecord(db, financeActor, { ...input, idempotencyKey: "after-contract-void" }), /合同已作废/);
  assert.equal(count(db, "audit_logs"), 1); assert.equal(count(db, "idempotency_keys"), 1); db.close();
});
