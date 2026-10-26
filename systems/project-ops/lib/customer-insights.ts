import type { DatabaseSync } from "node:sqlite";
import type { SessionUser } from "./auth.ts";
import { contractScopeSql, customerScopeSql, projectScopeSql, receivableScopeSql } from "./permissions.ts";

export type SearchHit = {
  id: string;
  type: "CUSTOMER" | "CONTRACT" | "PROJECT";
  title: string;
  subtitle: string;
  href: string;
};

export type CustomerDetail = {
  customer: Record<string, unknown>;
  summary: {
    contractCents: number;
    receivableCents: number;
    receivedCents: number;
    outstandingCents: number;
    invoiceCents: number;
    serviceFeeCents: number;
  };
  contracts: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  receivables: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  servicePeriods: Record<string, unknown>[];
};

const records = (rows: unknown[]) => rows as Record<string, unknown>[];
const likeTerm = (query: string) => `%${query.replace(/[\\%_]/g, "\\$&")}%`;

export function globalSearch(db: DatabaseSync, user: SessionUser, input: string) {
  const query = input.trim().slice(0, 100);
  if (!query) return { query, customers: [] as SearchHit[], contracts: [] as SearchHit[], projects: [] as SearchHit[] };
  const like = likeTerm(query), customerScope = customerScopeSql(user), projectScope = projectScopeSql(user), contract = contractScopeSql(user);
  const customers = records(db.prepare(`SELECT c.id,c.name,c.short_name,c.contact_name,c.industry,c.is_agency
    FROM customers c WHERE ${customerScope.sql}
      AND (c.name LIKE ? ESCAPE '\\' OR COALESCE(c.short_name,'') LIKE ? ESCAPE '\\' OR COALESCE(c.contact_name,'') LIKE ? ESCAPE '\\' OR COALESCE(c.industry,'') LIKE ? ESCAPE '\\')
    ORDER BY c.active DESC,c.name LIMIT 20`).all(...customerScope.params, like, like, like, like)).map(row => ({
      id: String(row.id), type: "CUSTOMER" as const, title: String(row.name),
      subtitle: [row.short_name, row.contact_name, row.industry, Number(row.is_agency) ? "代理商" : null].filter(Boolean).map(String).join(" · ") || "客户档案",
      href: `/customers/${encodeURIComponent(String(row.id))}`,
    }));
  const contracts = records(db.prepare(`SELECT ct.id,ct.number,ct.name,c.name customer_name
    FROM contracts ct JOIN customers c ON c.id=ct.customer_id WHERE ${customerScope.sql} AND ${contract.sql}
      AND (ct.number LIKE ? ESCAPE '\\' OR ct.name LIKE ? ESCAPE '\\')
    ORDER BY ct.status='VOID',ct.updated_at DESC LIMIT 20`).all(...customerScope.params, ...contract.params, like, like)).map(row => ({
      id: String(row.id), type: "CONTRACT" as const, title: `${String(row.number)} · ${String(row.name)}`,
      subtitle: String(row.customer_name), href: `/contracts?edit=${encodeURIComponent(String(row.id))}`,
    }));
  const projects = records(db.prepare(`SELECT p.id,p.name,p.project_version,c.name customer_name
    FROM projects p JOIN customers c ON c.id=p.customer_id WHERE ${projectScope.sql}
      AND (p.name LIKE ? ESCAPE '\\' OR COALESCE(p.project_version,'') LIKE ? ESCAPE '\\') ORDER BY p.status='VOID',p.updated_at DESC LIMIT 20`)
    .all(...projectScope.params, like,like)).map(row => ({
      id: String(row.id), type: "PROJECT" as const, title: String(row.name),
      subtitle: [row.project_version,row.customer_name].filter(Boolean).map(String).join(" · "), href: `/projects?edit=${encodeURIComponent(String(row.id))}`,
    }));
  return { query, customers, contracts, projects };
}

export function getCustomerDetail(db: DatabaseSync, user: SessionUser, customerId: string): CustomerDetail | null {
  const scope = customerScopeSql(user);
  const customer = db.prepare(`SELECT c.*,u.name owner_name,d.name department_name
    FROM customers c LEFT JOIN users u ON u.id=c.owner_user_id LEFT JOIN departments d ON d.id=c.department_id
    WHERE c.id=? AND ${scope.sql}`).get(customerId, ...scope.params) as Record<string, unknown> | undefined;
  if (!customer) return null;
  const contract = contractScopeSql(user), receivable = receivableScopeSql(user), project = projectScopeSql(user, "p");
  const contracts = records(db.prepare(`SELECT ct.*,
      COALESCE((SELECT SUM(r.amount_cents) FROM receivables r WHERE r.contract_id=ct.id AND r.voided_at IS NULL),0) receivable_cents,
      COALESCE((SELECT SUM(ra.amount_cents) FROM receipt_allocations ra JOIN receipts x ON x.id=ra.receipt_id JOIN receivables r ON r.id=ra.receivable_id WHERE r.contract_id=ct.id AND r.voided_at IS NULL AND x.voided_at IS NULL),0) received_cents,
      COALESCE((SELECT SUM(ia.amount_cents) FROM invoice_allocations ia JOIN invoices x ON x.id=ia.invoice_id JOIN receivables r ON r.id=ia.receivable_id WHERE r.contract_id=ct.id AND r.voided_at IS NULL AND x.voided_at IS NULL),0) invoiced_cents
    FROM contracts ct WHERE ct.customer_id=? AND ${contract.sql} ORDER BY ct.signed_date IS NULL,ct.signed_date DESC,ct.created_at DESC`).all(customerId, ...contract.params));
  const projects = records(db.prepare(`SELECT p.*,u.name manager_name,d.name department_name,
      (SELECT GROUP_CONCAT(ct.number,'、') FROM contract_projects cp JOIN contracts ct ON ct.id=cp.contract_id WHERE cp.project_id=p.id) contract_numbers
    FROM projects p LEFT JOIN users u ON u.id=p.manager_user_id LEFT JOIN departments d ON d.id=p.department_id
    WHERE p.customer_id=? AND ${project.sql} ORDER BY p.status='VOID',p.updated_at DESC`).all(customerId, ...project.params));
  const receivables = records(db.prepare(`SELECT r.*,ct.number contract_number,p.name project_name,
      COALESCE((SELECT SUM(ia.amount_cents) FROM invoice_allocations ia JOIN invoices x ON x.id=ia.invoice_id WHERE ia.receivable_id=r.id AND x.voided_at IS NULL),0) invoiced_cents,
      COALESCE((SELECT SUM(ra.amount_cents) FROM receipt_allocations ra JOIN receipts x ON x.id=ra.receipt_id WHERE ra.receivable_id=r.id AND x.voided_at IS NULL),0) received_cents
    FROM receivables r JOIN contracts ct ON ct.id=r.contract_id LEFT JOIN projects p ON p.id=r.project_id
    WHERE ct.customer_id=? AND ${receivable.sql} ORDER BY r.voided_at IS NOT NULL,r.due_date`).all(customerId, ...receivable.params));
  const invoices = user.role === "PROJECT_MEMBER"
    ? records(db.prepare(`SELECT i.id,i.invoice_number,i.customer_id,i.invoice_date,SUM(ia.amount_cents) amount_cents,i.tax_rate_basis_points,
        ROUND(i.tax_cents*SUM(ia.amount_cents)*1.0/i.amount_cents) tax_cents,i.notes,i.voided_at,i.void_reason,i.created_at
      FROM invoices i JOIN invoice_allocations ia ON ia.invoice_id=i.id JOIN receivables r ON r.id=ia.receivable_id
      WHERE i.customer_id=? AND ${receivable.sql} GROUP BY i.id ORDER BY i.voided_at IS NOT NULL,i.invoice_date DESC,i.created_at DESC`).all(customerId, ...receivable.params))
    : records(db.prepare(`SELECT i.* FROM invoices i WHERE i.customer_id=? ORDER BY i.voided_at IS NOT NULL,i.invoice_date DESC,i.created_at DESC`).all(customerId));
  const servicePeriods = records(db.prepare(`SELECT sp.*,p.name project_name,r.name receivable_name,
      COALESCE((SELECT SUM(ra.amount_cents) FROM receipt_allocations ra JOIN receipts x ON x.id=ra.receipt_id WHERE ra.receivable_id=sp.receivable_id AND x.voided_at IS NULL),0) received_cents
    FROM service_periods sp JOIN projects p ON p.id=sp.project_id LEFT JOIN receivables r ON r.id=sp.receivable_id
    WHERE p.customer_id=? AND ${project.sql} ORDER BY sp.status='VOID',sp.start_date DESC`).all(customerId, ...project.params));
  const active = (row: Record<string, unknown>) => row.status !== "VOID" && !row.voided_at;
  const sum = (rows: Record<string, unknown>[], key: string) => rows.filter(active).reduce((total, row) => total + Number(row[key]), 0);
  const contractCents = sum(contracts, "amount_cents"), receivableCents = sum(receivables, "amount_cents"), receivedCents = sum(receivables, "received_cents");
  return { customer, summary: { contractCents, receivableCents, receivedCents,
    outstandingCents: Math.max(0, receivableCents - receivedCents), invoiceCents: sum(invoices, "amount_cents"),
    serviceFeeCents: sum(servicePeriods, "amount_cents") }, contracts, projects, receivables, invoices, servicePeriods };
}
