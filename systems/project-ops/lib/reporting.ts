import type { DatabaseSync } from "node:sqlite";
import type { SessionUser } from "./auth.ts";
import type { ReceivableExportRow } from "./excel.ts";
import { businessDate } from "./business-date.ts";
import { contractScopeSql, customerScopeSql, projectScopeSql, receivableScopeSql, workItemScopeSql } from "./permissions.ts";

export type ReportFilters = {
  customer?: string;
  project?: string;
  owner?: string;
  department?: string;
  month?: string;
  category?: string;
  invoiceStatus?: string;
  receiptStatus?: string;
};

export type ReceivableReportRow = ReceivableExportRow & {
  id: string;
  customerId: string;
  projectId: string;
  contractId: string;
  ownerId: string;
  departmentId: string;
  outstandingCents: number;
  overdue: boolean;
};

export type DashboardMetrics = {
  contractTotalCents: number;
  receivableCents: number;
  receivedCents: number;
  unreceivedCents: number;
  overdueCents: number;
  invoicedUnpaidCents: number;
  monthReceivedCents: number;
  serviceDueCents: number;
  serviceDueCount: number;
  payableCommissionCents: number;
  workTodoCount: number;
};

export type ReportAnalysis = {
  collectionRate: number;
  invoiceRate: number;
  overdueRate: number;
  topCustomers: { label: string; amountCents: number }[];
  monthly: { month: string; amountCents: number; receivedCents: number }[];
  insights: string[];
};

const invoiceStatus = (amount: number, invoiced: number) =>
  invoiced >= amount ? "全部开票" : invoiced > 0 ? "部分开票" : "未开票";
const receiptStatus = (amount: number, received: number) =>
  received >= amount ? "全部回款" : received > 0 ? "部分回款" : "未回款";

export function getReceivableReportRows(
  db: DatabaseSync,
  user: SessionUser,
  filters: ReportFilters = {},
  today = businessDate(),
) {
  const scope = customerScopeSql(user);
  const receivableScope = receivableScopeSql(user);
  const clauses = [scope.sql, receivableScope.sql, "r.voided_at IS NULL", "ct.status!='VOID'"];
  const params: string[] = [...scope.params, ...receivableScope.params];
  for (const [column, value] of [
    ["c.id", filters.customer],
    ["r.project_id", filters.project],
    ["r.owner_user_id", filters.owner],
    ["COALESCE(p.department_id,c.department_id)", filters.department],
    ["r.category", filters.category],
  ] as const) {
    if (value) {
      clauses.push(`${column}=?`);
      params.push(value);
    }
  }
  if (filters.month) {
    clauses.push("r.due_date_is_estimated=0");
    clauses.push("strftime('%Y-%m',r.due_date)=?");
    params.push(filters.month);
  }

  const raw = db.prepare(`SELECT r.id,c.id customer_id,c.name customer,
      COALESCE(p.id,'') project_id,COALESCE(p.name,'') project,ct.id contract_id,
      ct.number||' '||ct.name contract,r.name item,r.category,r.due_date,r.due_date_is_estimated,r.amount_cents,
      COALESCE((SELECT SUM(ia.amount_cents) FROM invoice_allocations ia JOIN invoices i ON i.id=ia.invoice_id
        WHERE ia.receivable_id=r.id AND i.voided_at IS NULL),0) invoiced_cents,
      COALESCE((SELECT SUM(ra.amount_cents) FROM receipt_allocations ra JOIN receipts x ON x.id=ra.receipt_id
        WHERE ra.receivable_id=r.id AND x.voided_at IS NULL),0) received_cents,
      COALESCE(u.id,'') owner_id,COALESCE(u.name,'') owner,
      COALESCE(d.id,'') department_id,COALESCE(d.name,'') department
    FROM receivables r
    JOIN contracts ct ON ct.id=r.contract_id
    JOIN customers c ON c.id=ct.customer_id
    LEFT JOIN projects p ON p.id=r.project_id
    LEFT JOIN users u ON u.id=r.owner_user_id
    LEFT JOIN departments d ON d.id=COALESCE(p.department_id,c.department_id)
    WHERE ${clauses.join(" AND ")}
    ORDER BY c.name,r.due_date,r.name`).all(...params) as Record<string, unknown>[];

  return raw.map((row) => {
    const amount = Number(row.amount_cents);
    const invoiced = Number(row.invoiced_cents);
    const received = Number(row.received_cents);
    return {
      id: String(row.id),
      customerId: String(row.customer_id),
      customer: String(row.customer),
      projectId: String(row.project_id),
      project: String(row.project),
      contractId: String(row.contract_id),
      contract: String(row.contract),
      item: String(row.item),
      category: String(row.category),
      dueDate: String(row.due_date),
      amountCents: amount,
      invoicedCents: invoiced,
      receivedCents: received,
      outstandingCents: Math.max(0, amount - received),
      invoiceStatus: invoiceStatus(amount, invoiced),
      receiptStatus: receiptStatus(amount, received),
      ownerId: String(row.owner_id),
      owner: String(row.owner),
      departmentId: String(row.department_id),
      department: String(row.department),
      overdue: !Number(row.due_date_is_estimated) && received < amount && String(row.due_date) < today,
    } satisfies ReceivableReportRow;
  }).filter((row) =>
    (!filters.invoiceStatus || row.invoiceStatus === filters.invoiceStatus)
    && (!filters.receiptStatus || row.receiptStatus === filters.receiptStatus));
}

export function summarizeReceivableRows(rows: ReceivableReportRow[]) {
  return rows.reduce((summary, row) => ({
    amountCents: summary.amountCents + row.amountCents,
    invoicedCents: summary.invoicedCents + row.invoicedCents,
    receivedCents: summary.receivedCents + row.receivedCents,
    outstandingCents: summary.outstandingCents + row.outstandingCents,
    overdueCents: summary.overdueCents + (row.overdue ? row.outstandingCents : 0),
  }), { amountCents: 0, invoicedCents: 0, receivedCents: 0, outstandingCents: 0, overdueCents: 0 });
}

export function analyzeReceivableRows(rows: ReceivableReportRow[]): ReportAnalysis {
  const totals = summarizeReceivableRows(rows);
  const percent = (value: number) => totals.amountCents ? Math.round(value / totals.amountCents * 1000) / 10 : 0;
  const customers = new Map<string, number>();
  const months = new Map<string, { amountCents: number; receivedCents: number }>();
  for (const row of rows) {
    customers.set(row.customer, (customers.get(row.customer) ?? 0) + row.outstandingCents);
    const month = row.dueDate.slice(0, 7);
    const value = months.get(month) ?? { amountCents: 0, receivedCents: 0 };
    value.amountCents += row.amountCents;
    value.receivedCents += Math.min(row.amountCents, row.receivedCents);
    months.set(month, value);
  }
  const topCustomers = [...customers].filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, amountCents]) => ({ label, amountCents }));
  const monthly = [...months].sort(([a], [b]) => a.localeCompare(b)).slice(-6)
    .map(([month, value]) => ({ month, ...value }));
  const collectionRate = percent(totals.receivedCents);
  const invoiceRate = percent(Math.min(totals.amountCents, totals.invoicedCents));
  const overdueRate = percent(totals.overdueCents);
  const insights = rows.length ? [
    `当前筛选范围回款率 ${collectionRate}%，仍有未回款需要持续跟进。`,
    totals.overdueCents ? `其中逾期未回占应收 ${overdueRate}%，建议优先跟进已逾期款项。` : "当前没有逾期未回款。",
    topCustomers[0] ? `${topCustomers[0].label}的未回款最高，占全部未回款 ${totals.outstandingCents ? Math.round(topCustomers[0].amountCents / totals.outstandingCents * 1000) / 10 : 0}%。` : "当前没有未回款客户。",
  ] : ["当前筛选范围没有可分析的有效应收明细。"];
  return { collectionRate, invoiceRate, overdueRate, topCustomers, monthly, insights };
}

export function getDashboardMetrics(
  db: DatabaseSync,
  user: SessionUser,
  today = businessDate(),
): DashboardMetrics {
  const scope = customerScopeSql(user);
  const contractScope = contractScopeSql(user);
  const receivableScope = receivableScopeSql(user);
  const projectScope = projectScopeSql(user);
  const workScope = workItemScopeSql(user);
  const rows = getReceivableReportRows(db, user, {}, today);
  const receivables = summarizeReceivableRows(rows);
  const contract = db.prepare(`SELECT COALESCE(SUM(ct.amount_cents),0) total
    FROM contracts ct JOIN customers c ON c.id=ct.customer_id
    WHERE ct.status!='VOID' AND ${scope.sql} AND ${contractScope.sql}`).get(...scope.params, ...contractScope.params) as { total: number };
  const monthReceived = db.prepare(`SELECT COALESCE(SUM(ra.amount_cents),0) total
    FROM receipt_allocations ra
    JOIN receipts x ON x.id=ra.receipt_id
    JOIN receivables r ON r.id=ra.receivable_id
    JOIN contracts ct ON ct.id=r.contract_id
    JOIN customers c ON c.id=ct.customer_id
    WHERE x.voided_at IS NULL AND x.date_is_estimated=0 AND r.voided_at IS NULL AND ct.status!='VOID'
      AND strftime('%Y-%m',x.received_date)=substr(?,1,7) AND ${scope.sql} AND ${receivableScope.sql}`)
    .get(today, ...scope.params, ...receivableScope.params) as { total: number };
  const serviceDue = db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(outstanding_cents),0) total FROM (
    SELECT sp.id,CASE WHEN sp.receivable_id IS NULL AND sp.status='PAID' THEN 0 ELSE MAX(0,sp.amount_cents-
      COALESCE((SELECT SUM(ra.amount_cents) FROM receipt_allocations ra JOIN receipts x ON x.id=ra.receipt_id
        WHERE ra.receivable_id=sp.receivable_id AND x.voided_at IS NULL),0)) END outstanding_cents
    FROM service_periods sp JOIN projects p ON p.id=sp.project_id JOIN customers c ON c.id=p.customer_id
    WHERE sp.status!='VOID' AND sp.end_date<=date(?, '+30 days') AND ${scope.sql} AND ${projectScope.sql}
  ) WHERE outstanding_cents>0`)
    .get(today, ...scope.params, ...projectScope.params) as { count: number; total: number };
  const commissionOwner = user.role === "PROJECT_MEMBER" ? "AND ca.user_id=?" : "";
  const commissions = db.prepare(`SELECT COALESCE(SUM(ca.commission_cents),0) total
    FROM commission_accruals ca JOIN projects p ON p.id=ca.project_id JOIN customers c ON c.id=p.customer_id
    WHERE ca.status='PAYABLE' AND ${scope.sql} AND ${projectScope.sql} ${commissionOwner}`)
    .get(...scope.params, ...projectScope.params, ...(commissionOwner ? [user.id] : [])) as { total: number };
  const work = db.prepare(`SELECT COUNT(*) count FROM work_items wi
    WHERE wi.status NOT IN ('DONE','CANCELLED') AND ${workScope.sql}`)
    .get(...workScope.params) as { count: number };
  return {
    contractTotalCents: Number(contract.total),
    receivableCents: receivables.amountCents,
    receivedCents: receivables.receivedCents,
    unreceivedCents: receivables.outstandingCents,
    overdueCents: receivables.overdueCents,
    invoicedUnpaidCents: rows.reduce((sum, row) => sum + Math.max(0, row.invoicedCents - row.receivedCents), 0),
    monthReceivedCents: Number(monthReceived.total),
    serviceDueCents: Number(serviceDue.total),
    serviceDueCount: Number(serviceDue.count),
    payableCommissionCents: Number(commissions.total),
    workTodoCount: Number(work.count),
  };
}
