import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../lib/db.ts";
import { createInvoiceWithAllocations, createReceiptWithAllocations, getReceivableStatus, voidFinanceRecord } from "../lib/finance.ts";
import { initializeSchema } from "../lib/schema.ts";

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
