import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ApiError } from "../../../lib/api.ts";
import { writeAudit } from "../../../lib/audit.ts";
import type { SessionUser } from "../../../lib/auth.ts";
import { refreshCommissionEligibility } from "../../../lib/commissions.ts";
import { inTransaction } from "../../../lib/db.ts";
import { createInvoiceWithAllocations, createReceiptWithAllocations, voidFinanceRecord } from "../../../lib/finance.ts";
import { canManageFinance } from "../../../lib/permissions.ts";
import { executePublishedRules } from "../../../lib/rules.ts";

const allocation = z.object({ receivableId: z.string().min(1), amountCents: z.number().int().positive() });
const base = z.object({
  idempotencyKey: z.string().trim().min(8).max(100), customerId: z.string().min(1),
  amountCents: z.number().int().positive(), allocations: z.array(allocation).min(1).max(500),
  notes: z.string().max(1000).optional(),
});
const invoiceSchema = base.extend({
  invoiceNumber: z.string().trim().min(1).max(100), invoiceDate: z.string().date(),
  taxRateBasisPoints: z.number().int().min(0).max(10000).optional(), taxCents: z.number().int().min(0).optional(),
});
const receiptSchema = base.extend({
  receivedDate: z.string().date(), referenceNumber: z.string().max(100).optional(),
  payerAccount: z.string().max(100).optional(), paymentMethod: z.string().max(50).optional(),
});

function financeKind(kind: string) {
  if (kind !== "invoices" && kind !== "receipts") throw new ApiError(404, "财务记录类型不存在");
  return kind;
}

function atomic<T>(db: DatabaseSync, work: () => T): T {
  try { return inTransaction(db, work); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/database is (locked|busy)/i.test(message)) throw new ApiError(409, "其他财务操作正在处理中，请保留内容稍后重试");
    if (/幂等键/.test(message)) throw new ApiError(409, message);
    if (/UNIQUE constraint failed/.test(message)) throw new ApiError(409, "发票号或流水号已存在，请核对原记录");
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_SQLITE_ERROR") {
      const failure = new ApiError(500, "财务保存失败，数据已回滚，请稍后重试");
      failure.cause = error;
      throw failure;
    }
    throw error;
  }
}

function refreshReceiptProjects(db: DatabaseSync, receiptId: string) {
  const projects = db.prepare(`SELECT DISTINCT r.project_id FROM receipt_allocations a
    JOIN receivables r ON r.id=a.receivable_id WHERE a.receipt_id=? AND r.project_id IS NOT NULL`)
    .all(receiptId) as { project_id: string }[];
  for (const row of projects) refreshCommissionEligibility(db, row.project_id);
}

// A replay is recognized only after the original service verifies operation and request_hash.
export function createFinanceEntry(db: DatabaseSync, actor: SessionUser, kind: string, body: unknown, ipAddress: string | null = null) {
  if (!canManageFinance(actor)) throw new ApiError(403, "仅管理员或财务可以登记票款");
  const table = financeKind(kind);
  const input = table === "invoices" ? invoiceSchema.parse(body) : receiptSchema.parse(body);
  return atomic(db, () => {
    const replayed = Boolean(db.prepare("SELECT 1 FROM idempotency_keys WHERE key=?").get(input.idempotencyKey));
    const id = table === "invoices"
      ? createInvoiceWithAllocations(db, invoiceSchema.parse(input))
      : createReceiptWithAllocations(db, receiptSchema.parse(input));
    if (replayed) return { id, replayed: true };
    if (table === "receipts") refreshReceiptProjects(db, id);
    writeAudit(db, { userId: actor.id, action: "CREATE", entityType: table === "invoices" ? "INVOICE" : "RECEIPT", entityId: id, after: input, ipAddress });
    if (table === "receipts") executePublishedRules(db, {
      triggerEvent: "RECEIPT_CREATED", eventKey: `receipt:${id}`, data: { ...input, receiptId: id, status: "PAID", userId: actor.id },
    });
    return { id, replayed: false };
  });
}

export function voidFinanceEntry(db: DatabaseSync, actor: SessionUser, kind: string, body: unknown, ipAddress: string | null = null) {
  if (!canManageFinance(actor)) throw new ApiError(403, "仅管理员或财务可以作废票款");
  const table = financeKind(kind);
  const input = z.object({ id: z.string().min(1), reason: z.string().trim().min(2).max(500) }).parse(body);
  return atomic(db, () => {
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(input.id) as Record<string, unknown> | undefined;
    if (!existing) throw new ApiError(404, "财务记录不存在");
    if (existing.voided_at) {
      if (existing.void_reason === input.reason) return { ok: true, replayed: true };
      throw new ApiError(409, "记录已作废，不能更改原作废原因");
    }
    const before = voidFinanceRecord(db, { kind: table, ...input });
    if (table === "receipts") refreshReceiptProjects(db, input.id);
    writeAudit(db, { userId: actor.id, action: "VOID", entityType: table === "invoices" ? "INVOICE" : "RECEIPT", entityId: input.id, before, after: { reason: input.reason }, ipAddress });
    return { ok: true, replayed: false };
  });
}
