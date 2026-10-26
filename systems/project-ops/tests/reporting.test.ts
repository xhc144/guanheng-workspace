import assert from "node:assert/strict";
import test from "node:test";
import type { SessionUser } from "../lib/auth.ts";
import { openDatabase } from "../lib/db.ts";
import { analyzeReceivableRows, getDashboardMetrics, getReceivableReportRows, summarizeReceivableRows } from "../lib/reporting.ts";

const manager: SessionUser = { id: "manager", username: "manager", name: "部门负责人", email: null, role: "DEPARTMENT_MANAGER", departmentId: "d1" };

function fixture() {
  const db = openDatabase(":memory:");
  db.exec(`
    INSERT INTO departments (id,name) VALUES ('d1','交付一部'),('d2','交付二部');
    INSERT INTO users (id,username,name,password_hash,role,department_id) VALUES
      ('manager','manager','部门负责人','test','DEPARTMENT_MANAGER','d1'),
      ('member','member','项目成员','test','PROJECT_MEMBER','d1'),
      ('other','other','其他人员','test','PROJECT_MEMBER','d2');
    INSERT INTO customers (id,name,owner_user_id,department_id) VALUES
      ('c1','客户甲','manager','d1'),('c2','客户乙','other','d2');
    INSERT INTO contracts (id,number,name,customer_id,amount_cents,status) VALUES
      ('ct1','HT-1','有效合同','c1',300000,'ACTIVE'),
      ('ct-void','HT-V','已作废合同','c1',900000,'VOID'),
      ('ct2','HT-2','范围外合同','c2',400000,'ACTIVE');
    INSERT INTO projects (id,name,customer_id,manager_user_id,department_id,status) VALUES
      ('p1','项目一','c1','manager','d1','ACTIVE'),('p2','项目二','c2','other','d2','ACTIVE');
    INSERT INTO receivables (id,contract_id,project_id,name,category,amount_cents,due_date,owner_user_id,voided_at) VALUES
      ('r1','ct1','p1','首期款','首期款',100000,'2026-01-31','manager',NULL),
      ('r2','ct1','p1','蓝图款','蓝图款',200000,'2026-02-28','member',NULL),
      ('r-void','ct1','p1','作废款','其他款',500000,'2026-01-01','manager','2026-03-01'),
      ('r-on-void-contract','ct-void','p1','无效合同款','其他款',900000,'2026-01-01','manager',NULL),
      ('r-out','ct2','p2','范围外款','首期款',400000,'2026-01-31','other',NULL);
    INSERT INTO invoices (id,invoice_number,customer_id,invoice_date,amount_cents,voided_at) VALUES
      ('i1','FP-1','c1','2026-03-01',260000,NULL),('i-void','FP-V','c1','2026-03-01',40000,'2026-03-02');
    INSERT INTO invoice_allocations (id,invoice_id,receivable_id,amount_cents) VALUES
      ('ia1','i1','r1',60000),('ia2','i1','r2',200000),('ia-v','i-void','r1',40000);
    INSERT INTO receipts (id,customer_id,received_date,amount_cents,reference_number,voided_at) VALUES
      ('pay1','c1','2026-03-02',90000,'HK-1',NULL),('pay-void','c1','2026-03-03',20000,'HK-V','2026-03-04');
    INSERT INTO receipt_allocations (id,receipt_id,receivable_id,amount_cents) VALUES
      ('pa1','pay1','r1',40000),('pa2','pay1','r2',50000),('pa-v','pay-void','r1',20000);
    INSERT INTO service_periods (id,project_id,start_date,end_date,amount_cents,status) VALUES
      ('sp1','p1','2025-04-01','2026-03-30',50000,'DUE'),
      ('sp-paid','p1','2025-01-01','2026-03-10',99999,'PAID'),
      ('sp-out','p2','2025-04-01','2026-03-30',70000,'DUE');
    INSERT INTO commission_accruals (id,project_id,user_id,source_type,source_id,gross_cents,basis_points,commission_cents,status) VALUES
      ('ca1','p1','member','SETTLEMENT','s1',100000,1000,12345,'PAYABLE'),
      ('ca-out','p2','other','SETTLEMENT','s2',100000,1000,99999,'PAYABLE');
    INSERT INTO work_items (id,type,title,project_id,assignee_user_id,status) VALUES
      ('w1','TASK','待办','p1','member','OPEN'),('w-done','TASK','已完成','p1','member','DONE'),('w-out','TASK','范围外','p2','other','OPEN');
  `);
  return db;
}

test("report totals match each effective database detail and combine filters", () => {
  const db = fixture();
  const rows = getReceivableReportRows(db, manager, {}, "2026-03-15");
  assert.deepEqual(rows.map((row) => row.id), ["r1", "r2"]);
  const summary = summarizeReceivableRows(rows);
  const direct = db.prepare(`SELECT SUM(r.amount_cents) amount,
      SUM(COALESCE((SELECT SUM(ia.amount_cents) FROM invoice_allocations ia JOIN invoices i ON i.id=ia.invoice_id WHERE ia.receivable_id=r.id AND i.voided_at IS NULL),0)) invoiced,
      SUM(COALESCE((SELECT SUM(ra.amount_cents) FROM receipt_allocations ra JOIN receipts x ON x.id=ra.receipt_id WHERE ra.receivable_id=r.id AND x.voided_at IS NULL),0)) received
    FROM receivables r JOIN contracts ct ON ct.id=r.contract_id JOIN customers c ON c.id=ct.customer_id
    WHERE r.voided_at IS NULL AND ct.status!='VOID' AND c.department_id='d1'`).get() as { amount: number; invoiced: number; received: number };
  assert.deepEqual(
    { amount: summary.amountCents, invoiced: summary.invoicedCents, received: summary.receivedCents },
    { amount: Number(direct.amount), invoiced: Number(direct.invoiced), received: Number(direct.received) },
  );
  assert.deepEqual(summary, { amountCents: 300000, invoicedCents: 260000, receivedCents: 90000, outstandingCents: 210000, overdueCents: 210000 });
  const filtered = getReceivableReportRows(db, manager, { customer: "c1", project: "p1", owner: "member", department: "d1", month: "2026-02", category: "蓝图款", invoiceStatus: "全部开票", receiptStatus: "部分回款" }, "2026-03-15");
  assert.deepEqual(filtered.map((row) => row.id), ["r2"]);
});

test("dashboard exposes all required metrics from effective scoped records", () => {
  const metrics = getDashboardMetrics(fixture(), manager, "2026-03-15");
  assert.deepEqual(metrics, {
    contractTotalCents: 300000,
    receivableCents: 300000,
    receivedCents: 90000,
    unreceivedCents: 210000,
    overdueCents: 210000,
    invoicedUnpaidCents: 170000,
    monthReceivedCents: 90000,
    serviceDueCents: 50000,
    serviceDueCount: 1,
    payableCommissionCents: 12345,
    workTodoCount: 1,
  });
});

test("project members cannot read sibling project finances under the same customer", () => {
  const db = fixture();
  db.exec(`
    INSERT INTO project_members (project_id,user_id) VALUES ('p1','member');
    INSERT INTO projects (id,name,customer_id,manager_user_id,department_id,status)
      VALUES ('p-sibling','同客户未参与项目','c1','other','d1','ACTIVE');
    INSERT INTO contracts (id,number,name,customer_id,amount_cents,status)
      VALUES ('ct-sibling','HT-S','同客户未参与合同','c1',600000,'ACTIVE');
    INSERT INTO contract_projects (contract_id,project_id) VALUES ('ct1','p1'),('ct-sibling','p-sibling');
    INSERT INTO receivables (id,contract_id,project_id,name,category,amount_cents,due_date,owner_user_id)
      VALUES ('r-sibling','ct-sibling','p-sibling','同客户未参与应收','首期款',600000,'2026-02-28','other');
    INSERT INTO receipts (id,customer_id,received_date,amount_cents,reference_number)
      VALUES ('pay-sibling','c1','2026-03-03',600000,'HK-S');
    INSERT INTO receipt_allocations (id,receipt_id,receivable_id,amount_cents)
      VALUES ('pa-sibling','pay-sibling','r-sibling',600000);
    INSERT INTO service_periods (id,project_id,start_date,end_date,amount_cents,status)
      VALUES ('sp-sibling','p-sibling','2025-04-01','2026-03-30',80000,'DUE');
    INSERT INTO commission_accruals (id,project_id,user_id,source_type,source_id,gross_cents,basis_points,commission_cents,status)
      VALUES ('ca-sibling','p-sibling','member','SETTLEMENT','s-sibling',100000,1000,77777,'PAYABLE');
  `);
  const member: SessionUser = { id: "member", username: "member", name: "项目成员", email: null, role: "PROJECT_MEMBER", departmentId: "d1" };
  assert.deepEqual(getReceivableReportRows(db, member, {}, "2026-03-15").map((row) => row.id), ["r1", "r2"]);
  assert.deepEqual(getDashboardMetrics(db, member, "2026-03-15"), {
    contractTotalCents: 300000,
    receivableCents: 300000,
    receivedCents: 90000,
    unreceivedCents: 210000,
    overdueCents: 210000,
    invoicedUnpaidCents: 170000,
    monthReceivedCents: 90000,
    serviceDueCents: 50000,
    serviceDueCount: 1,
    payableCommissionCents: 12345,
    workTodoCount: 1,
  });
});

test("report analysis is derived from the same scoped receivable rows", () => {
  const analysis = analyzeReceivableRows(getReceivableReportRows(fixture(), manager, {}, "2026-03-15"));
  assert.deepEqual({ collectionRate: analysis.collectionRate, invoiceRate: analysis.invoiceRate, overdueRate: analysis.overdueRate },
    { collectionRate: 30, invoiceRate: 86.7, overdueRate: 70 });
  assert.deepEqual(analysis.topCustomers, [{ label: "客户甲", amountCents: 210000 }]);
  assert.deepEqual(analysis.monthly, [
    { month: "2026-01", amountCents: 100000, receivedCents: 40000 },
    { month: "2026-02", amountCents: 200000, receivedCents: 50000 },
  ]);
});

test("estimated legacy dates do not create false monthly receipts or overdue balances", () => {
  const db = fixture();
  db.prepare("UPDATE receivables SET due_date_is_estimated=1 WHERE id='r1'").run();
  db.prepare("UPDATE receipts SET date_is_estimated=1 WHERE id='pay1'").run();
  const rows = getReceivableReportRows(db, manager, {}, "2026-03-15");
  assert.equal(summarizeReceivableRows(rows).overdueCents, 150000);
  assert.equal(getDashboardMetrics(db, manager, "2026-03-15").monthReceivedCents, 0);
});

test("service fee due amount follows live receipt allocations instead of stale status", () => {
  const db = fixture();
  db.prepare("UPDATE service_periods SET receivable_id='r1',status='PAID' WHERE id='sp1'").run();
  assert.deepEqual(
    [getDashboardMetrics(db, manager, "2026-03-15").serviceDueCount, getDashboardMetrics(db, manager, "2026-03-15").serviceDueCents],
    [1, 10000],
  );
  db.exec(`
    INSERT INTO receipts (id,customer_id,received_date,amount_cents) VALUES ('pay-service','c1','2026-03-10',10000);
    INSERT INTO receipt_allocations (id,receipt_id,receivable_id,amount_cents) VALUES ('pa-service','pay-service','r1',10000);
  `);
  assert.deepEqual(
    [getDashboardMetrics(db, manager, "2026-03-15").serviceDueCount, getDashboardMetrics(db, manager, "2026-03-15").serviceDueCents],
    [0, 0],
  );
});
