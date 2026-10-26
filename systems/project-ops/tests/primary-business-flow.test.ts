import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase, inTransaction } from "../lib/db.ts";
import { writeAudit } from "../lib/audit.ts";
import { saveProjectRecord } from "../lib/projects.ts";
import { saveWorkItem, addWorkLog } from "../lib/work-items.ts";
import { createInvoiceWithAllocations, createReceiptWithAllocations, getReceivableStatus, voidFinanceRecord } from "../lib/finance.ts";
import { createProjectCommissions, refreshCommissionEligibility, createCommissionPayout } from "../lib/commissions.ts";
import { createServicePeriod, renewServicePeriod } from "../lib/service-fees.ts";
import { getDashboardMetrics, getReceivableReportRows } from "../lib/reporting.ts";
import type { SessionUser } from "../lib/auth.ts";

const admin: SessionUser = { id: "admin", username: "synthetic_admin", name: "虚构管理员", email: null, role: "ADMIN", departmentId: "d" };
function fixture() {
  const db = openDatabase(":memory:");
  db.exec(`INSERT INTO departments(id,name) VALUES('d','合成交付部');
    INSERT INTO users(id,username,name,password_hash,role,department_id) VALUES
      ('admin','synthetic_admin','虚构管理员','synthetic','ADMIN','d'),
      ('one','synthetic_one','虚构甲','synthetic','PROJECT_MEMBER','d'),
      ('two','synthetic_two','虚构乙','synthetic','PROJECT_MEMBER','d');
    INSERT INTO customers(id,name,owner_user_id,department_id) VALUES('customer','纯虚构主流程客户','admin','d');
    INSERT INTO contracts(id,number,name,customer_id,amount_cents) VALUES('contract','SYNTHETIC-WP24','纯虚构合同','customer',100000);`);
  return db;
}
function setupProject(db: ReturnType<typeof openDatabase>) {
  return saveProjectRecord(db, { name: "纯虚构交付项目", customerId: "customer", managerUserId: "admin", departmentId: "d", status: "ACTIVE",
    contractIds: ["contract"], members: [{ userId: "one", duty: "实施", commissionBasisPoints: 500 }, { userId: "two", duty: "开发", commissionBasisPoints: 300 }] });
}

test("旧API组合贯通合同、分期、多次票款、报表、指定款多人提成、发放与服务续期", t => {
  const db = fixture(); t.after(() => db.close());
  const projectId = inTransaction(db, () => {
    const id = setupProject(db);
    db.prepare(`INSERT INTO receivables(id,contract_id,project_id,name,category,amount_cents,due_date,owner_user_id)
      VALUES('first','contract',?,'蓝图首期','蓝图款',40000,'2026-01-01','one'),
            ('last','contract',?,'实施尾期','实施款',60000,'2026-12-31','two')`).run(id, id);
    writeAudit(db, { userId: "admin", action: "CREATE", entityType: "PROJECT", entityId: id }); return id;
  });
  const accruals = inTransaction(db, () => createProjectCommissions(db, { projectId, sourceType: "CONTRACT", sourceId: "contract", grossCents: 100000, releaseCondition: "蓝图款" }));
  assert.deepEqual(db.prepare("SELECT commission_cents,status FROM commission_accruals ORDER BY commission_cents").all().map(r => [r.commission_cents, r.status]), [[3000, "BLOCKED"], [5000, "BLOCKED"]]);
  assert.throws(() => createCommissionPayout(db, { accrualIds: accruals, payoutDate: "2026-01-03", createdBy: "admin" }), /不可发放/);
  for (const [key, amount] of [["a", 25000], ["b", 15000]] as const) inTransaction(db, () => {
    const id = createInvoiceWithAllocations(db, { idempotencyKey: `invoice-${key}`, invoiceNumber: `SYNTHETIC-${key}`,
      customerId: "customer", invoiceDate: "2026-01-02", amountCents: amount, allocations: [{ receivableId: "first", amountCents: amount }] });
    writeAudit(db, { userId: "admin", action: "CREATE", entityType: "INVOICE", entityId: id });
  });
  let firstReceipt = "";
  for (const [key, amount] of [["a", 10000], ["b", 30000]] as const) inTransaction(db, () => {
    const input = { idempotencyKey: `receipt-${key}`, customerId: "customer", receivedDate: "2026-01-03", amountCents: amount,
      allocations: [{ receivableId: "first", amountCents: amount }] };
    const id = createReceiptWithAllocations(db, input);
    assert.equal(createReceiptWithAllocations(db, input), id);
    if (key === "a") firstReceipt = id;
    const changed = refreshCommissionEligibility(db, projectId);
    assert.equal(changed, key === "a" ? 0 : 2);
    writeAudit(db, { userId: "admin", action: "CREATE", entityType: "RECEIPT", entityId: id });
  });
  assert.deepEqual(getReceivableStatus(db, "first", "2026-01-04"), { amountCents: 40000, invoicedCents: 40000, receivedCents: 40000, invoiceStatus: "FULL", receiptStatus: "FULL", overdue: false, voided: false });
  const metrics = getDashboardMetrics(db, admin, "2026-01-04");
  assert.deepEqual(metrics, { contractTotalCents: 100000, receivableCents: 100000, receivedCents: 40000, unreceivedCents: 60000,
    overdueCents: 0, invoicedUnpaidCents: 0, monthReceivedCents: 40000, serviceDueCents: 0, serviceDueCount: 0, payableCommissionCents: 8000, workTodoCount: 0 });
  const rows = getReceivableReportRows(db, admin, {}, "2026-01-04");
  assert.equal(rows.reduce((sum, row) => sum + row.receivedCents, 0), 40000);
  const payout = inTransaction(db, () => {
    const result = createCommissionPayout(db, { accrualIds: accruals, payoutDate: "2026-01-04", createdBy: "admin" });
    writeAudit(db, { userId: "admin", action: "PAY", entityType: "COMMISSION", entityId: result.payoutId }); return result;
  });
  assert.equal(payout.totalCents, 8000);
  assert.deepEqual(db.prepare("SELECT status FROM commission_accruals").all().map(row => row.status), ["PAID", "PAID"]);
  inTransaction(db, () => {
    const before = voidFinanceRecord(db, { kind: "receipts", id: firstReceipt, reason: "纯合成流水纠正" });
    writeAudit(db, { userId: "admin", action: "VOID", entityType: "RECEIPT", entityId: firstReceipt, before });
  });
  assert.equal(getReceivableStatus(db, "first").receivedCents, 30000);
  assert.equal(db.prepare("SELECT void_reason FROM receipts WHERE id=?").get(firstReceipt)!.void_reason, "纯合成流水纠正");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM receipts").get()!.n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='VOID' AND entity_id=?").get(firstReceipt)!.n, 1);
  // Baseline PAID history is retained. Reversal warnings/eligibility downgrade are WP09 work, not G0 claims.
  assert.equal(db.prepare("SELECT total_cents FROM commission_payouts WHERE id=?").get(payout.payoutId)!.total_cents, 8000);
  const original = inTransaction(db, () => createServicePeriod(db, { projectId, contractId: "contract", startDate: "2026-03-01", endDate: "2027-02-28", amountCents: 12000 }));
  const before = db.prepare("SELECT * FROM service_periods WHERE id=?").get(original.periodId);
  const renewed = inTransaction(db, () => renewServicePeriod(db, original.periodId));
  assert.deepEqual(db.prepare("SELECT * FROM service_periods WHERE id=?").get(original.periodId), before);
  assert.equal(db.prepare("SELECT previous_period_id FROM service_periods WHERE id=?").get(renewed.periodId)!.previous_period_id, original.periodId);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM service_periods").get()!.n, 2);
  assert.equal(db.prepare("SELECT SUM(amount_cents) total FROM receivables WHERE category='服务费'").get()!.total, 24000);
  assert.throws(() => renewServicePeriod(db, original.periodId), /已经续费/);
});

test("旧项目/研发/工时/财务API可统一事务组合，外层失败全部撤回", t => {
  const db = fixture(); t.after(() => db.close());
  assert.throws(() => inTransaction(db, () => {
    const projectId = setupProject(db);
    const workItemId = saveWorkItem(db, { type: "MILESTONE", title: "纯合成验收", projectId, customerId: "customer", participantUserIds: ["one"], priority: "HIGH", status: "OPEN", changedBy: "admin" });
    addWorkLog(db, { workItemId, userId: "one", workDate: "2026-01-01", minutes: 45 });
    db.prepare("INSERT INTO receivables(id,contract_id,project_id,name,category,amount_cents,due_date) VALUES('temp','contract',?,'合成款','首款',100,'2026-01-01')").run(projectId);
    const id = createReceiptWithAllocations(db, { idempotencyKey: "rollback", customerId: "customer", receivedDate: "2026-01-01", amountCents: 100, allocations: [{ receivableId: "temp", amountCents: 100 }] });
    writeAudit(db, { userId: "admin", action: "CREATE", entityType: "RECEIPT", entityId: id });
    throw new Error("主流程合成失败");
  }), /主流程合成失败/);
  for (const table of ["projects", "contract_projects", "project_members", "work_items", "work_item_participants", "work_item_history", "work_logs", "receivables", "receipts", "receipt_allocations", "idempotency_keys", "audit_logs"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n, 0, table);
  }
  assert.equal(db.prepare("SELECT amount_cents FROM contracts WHERE id='contract'").get()!.amount_cents, 100000);
});

test("审计写入真实失败时财务和幂等键均回滚，拒绝超额时不残留记录", t => {
  const db = fixture(); t.after(() => db.close());
  db.exec("INSERT INTO receivables(id,contract_id,name,category,amount_cents,due_date) VALUES('r','contract','合成款','首款',100,'2026-01-01')");
  const input = { idempotencyKey: "atomic-audit", customerId: "customer", receivedDate: "2026-01-01", amountCents: 100, allocations: [{ receivableId: "r", amountCents: 100 }] };
  assert.throws(() => inTransaction(db, () => {
    const id = createReceiptWithAllocations(db, input);
    writeAudit(db, { userId: "does-not-exist", action: "CREATE", entityType: "RECEIPT", entityId: id });
  }), /FOREIGN KEY/);
  for (const table of ["receipts", "receipt_allocations", "idempotency_keys", "audit_logs"]) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n, 0);
  assert.throws(() => createReceiptWithAllocations(db, { ...input, amountCents: 101, allocations: [{ receivableId: "r", amountCents: 101 }] }), /超过应收余额/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM receipts").get()!.n, 0);
  assert.equal(db.prepare("SELECT amount_cents FROM receivables WHERE id='r'").get()!.amount_cents, 100);
});
