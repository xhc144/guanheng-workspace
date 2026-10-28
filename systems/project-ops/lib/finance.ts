import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { businessDate } from "./business-date.ts";
import { inTransaction } from "./db.ts";
import { multiplyBasisPoints } from "./money.ts";

export interface AllocationInput { receivableId: string; amountCents: number }

function validateAllocations(allocations: AllocationInput[]) {
  if (!Array.isArray(allocations) || !allocations.length) throw new Error("至少需要一条分摊明细");
  const ids = new Set<string>();
  let total = 0;
  for (const item of allocations) {
    if (!item || typeof item.receivableId !== "string" || !item.receivableId.trim() || !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0) {
      throw new Error("分摊明细不正确");
    }
    if (ids.has(item.receivableId)) throw new Error("同一应收不能重复分摊");
    ids.add(item.receivableId);
    total += item.amountCents;
    if (!Number.isSafeInteger(total)) throw new Error("分摊合计超出安全金额范围");
  }
}

function validateDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("业务日期不正确，请填写真实日历日期");
  }
}

function assertReceivableCapacity(
  db: DatabaseSync,
  allocations: AllocationInput[],
  table: "invoice_allocations" | "receipt_allocations",
  customerId: string,
) {
  for (const item of allocations) {
    const row = db.prepare(`
      SELECT r.amount_cents, r.voided_at, c.id customer_id,
        COALESCE((SELECT SUM(a.amount_cents) FROM ${table} a
          JOIN ${table === "invoice_allocations" ? "invoices" : "receipts"} source
            ON source.id = a.${table === "invoice_allocations" ? "invoice_id" : "receipt_id"}
          WHERE a.receivable_id = r.id AND source.voided_at IS NULL), 0) allocated_cents
      FROM receivables r JOIN contracts ct ON ct.id = r.contract_id JOIN customers c ON c.id = ct.customer_id
      WHERE r.id = ? AND ct.status != 'VOID'
    `).get(item.receivableId) as Record<string, unknown> | undefined;
    if (!row || row.voided_at) throw new Error("应收不存在或已作废");
    if (row.customer_id !== customerId) throw new Error("分摊应收与付款客户不一致");
    if (item.amountCents > Number(row.amount_cents) - Number(row.allocated_cents)) {
      throw new Error("分摊金额超过应收余额");
    }
  }
}

function hashRequest(operation: string, payload: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify({ operation, ...payload })).digest("hex");
}

function normalizedAllocations(allocations: AllocationInput[]) {
  return [...allocations].sort((left, right) => left.receivableId.localeCompare(right.receivableId));
}

function existingIdempotentResult(db: DatabaseSync, key: string, operation: string, requestHash: string) {
  const row = db.prepare("SELECT result_id, operation, request_hash FROM idempotency_keys WHERE key = ?").get(key) as Record<string, unknown> | undefined;
  if (!row) return null;
  if (row.operation !== operation) throw new Error("幂等键已被其他操作使用");
  if (!row.request_hash) throw new Error("历史幂等键无法验证请求内容，请使用新的幂等键");
  if (row.request_hash !== requestHash) throw new Error("幂等键对应的请求内容不一致");
  return String(row.result_id);
}

export function createReceiptWithAllocations(db: DatabaseSync, input: {
  idempotencyKey: string; customerId: string; receivedDate: string; amountCents: number;
  referenceNumber?: string; payerAccount?: string; paymentMethod?: string; notes?: string;
  allocations: AllocationInput[];
}) {
  if (!input.idempotencyKey) throw new Error("缺少幂等键");
  validateDate(input.receivedDate);
  validateAllocations(input.allocations);
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error("回款金额不正确");
  const requestHash = hashRequest("CREATE_RECEIPT", {
    customerId: input.customerId,
    receivedDate: input.receivedDate,
    amountCents: input.amountCents,
    referenceNumber: input.referenceNumber ?? null,
    payerAccount: input.payerAccount ?? null,
    paymentMethod: input.paymentMethod ?? null,
    notes: input.notes ?? null,
    allocations: normalizedAllocations(input.allocations),
  });
  return inTransaction(db, () => {
    const existing = existingIdempotentResult(db, input.idempotencyKey, "CREATE_RECEIPT", requestHash);
    if (existing) return existing;
    assertReceivableCapacity(db, input.allocations, "receipt_allocations", input.customerId);
    if (input.allocations.reduce((sum, item) => sum + item.amountCents, 0) !== input.amountCents) {
      throw new Error("分摊合计必须等于回款金额");
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO receipts
      (id, customer_id, received_date, amount_cents, payer_account, payment_method, reference_number, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.customerId, input.receivedDate, input.amountCents, input.payerAccount ?? null,
        input.paymentMethod ?? null, input.referenceNumber?.trim() ? input.referenceNumber : null, input.notes ?? null);
    const statement = db.prepare("INSERT INTO receipt_allocations (id, receipt_id, receivable_id, amount_cents) VALUES (?, ?, ?, ?)");
    for (const item of input.allocations) statement.run(randomUUID(), id, item.receivableId, item.amountCents);
    db.prepare("INSERT INTO idempotency_keys (key, operation, result_id, request_hash) VALUES (?, 'CREATE_RECEIPT', ?, ?)")
      .run(input.idempotencyKey, id, requestHash);
    return id;
  });
}

export function createInvoiceWithAllocations(db: DatabaseSync, input: {
  idempotencyKey: string; invoiceNumber: string; customerId: string; invoiceDate: string;
  amountCents: number; taxRateBasisPoints?: number; taxCents?: number; notes?: string;
  allocations: AllocationInput[];
}) {
  if (!input.idempotencyKey) throw new Error("缺少幂等键");
  validateDate(input.invoiceDate);
  validateAllocations(input.allocations);
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error("发票金额不正确");
  if (!input.invoiceNumber.trim()) throw new Error("发票号不能为空");
  if (!Number.isSafeInteger(input.taxRateBasisPoints ?? 0) || (input.taxRateBasisPoints ?? 0) < 0 || (input.taxRateBasisPoints ?? 0) > 10000) throw new Error("税率须在0%至100%之间");
  if (!Number.isSafeInteger(input.taxCents ?? 0) || (input.taxCents ?? 0) < 0 || (input.taxCents ?? 0) > input.amountCents) throw new Error("税额不得超过发票金额");
  const requestHash = hashRequest("CREATE_INVOICE", {
    invoiceNumber: input.invoiceNumber,
    customerId: input.customerId,
    invoiceDate: input.invoiceDate,
    amountCents: input.amountCents,
    taxRateBasisPoints: input.taxRateBasisPoints ?? 0,
    taxCents: input.taxCents ?? 0,
    notes: input.notes ?? null,
    allocations: normalizedAllocations(input.allocations),
  });
  return inTransaction(db, () => {
    const existing = existingIdempotentResult(db, input.idempotencyKey, "CREATE_INVOICE", requestHash);
    if (existing) return existing;
    assertReceivableCapacity(db, input.allocations, "invoice_allocations", input.customerId);
    if (input.allocations.reduce((sum, item) => sum + item.amountCents, 0) !== input.amountCents) {
      throw new Error("分摊合计必须等于发票金额");
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO invoices
      (id, invoice_number, customer_id, invoice_date, amount_cents, tax_rate_basis_points, tax_cents, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.invoiceNumber, input.customerId, input.invoiceDate, input.amountCents,
        input.taxRateBasisPoints ?? 0, input.taxCents ?? 0, input.notes ?? null);
    const statement = db.prepare("INSERT INTO invoice_allocations (id, invoice_id, receivable_id, amount_cents) VALUES (?, ?, ?, ?)");
    for (const item of input.allocations) statement.run(randomUUID(), id, item.receivableId, item.amountCents);
    db.prepare("INSERT INTO idempotency_keys (key, operation, result_id, request_hash) VALUES (?, 'CREATE_INVOICE', ?, ?)")
      .run(input.idempotencyKey, id, requestHash);
    return id;
  });
}

export function voidFinanceRecord(db: DatabaseSync, input: {
  kind: "invoices" | "receipts";
  id: string;
  reason: string;
}) {
  if (input.kind !== "invoices" && input.kind !== "receipts") throw new Error("财务记录类型不存在");
  const reason = input.reason.trim();
  if (!input.id) throw new Error("财务记录编号不能为空");
  if (reason.length < 2 || reason.length > 500) throw new Error("作废原因须为2至500字");
  return inTransaction(db, () => {
    const before = db.prepare(`SELECT * FROM ${input.kind} WHERE id=? AND voided_at IS NULL`)
      .get(input.id) as Record<string, unknown> | undefined;
    if (!before) throw new Error("记录不存在或已作废");
    db.prepare(`UPDATE ${input.kind} SET voided_at=CURRENT_TIMESTAMP,void_reason=? WHERE id=?`)
      .run(reason, input.id);
    return before;
  });
}

export function getReceivableStatus(db: DatabaseSync, receivableId: string, today = businessDate()) {
  const row = db.prepare(`
    SELECT r.amount_cents, r.due_date, r.due_date_is_estimated, r.voided_at,
      COALESCE((SELECT SUM(ia.amount_cents) FROM invoice_allocations ia JOIN invoices i ON i.id = ia.invoice_id
        WHERE ia.receivable_id = r.id AND i.voided_at IS NULL), 0) invoiced_cents,
      COALESCE((SELECT SUM(ra.amount_cents) FROM receipt_allocations ra JOIN receipts p ON p.id = ra.receipt_id
        WHERE ra.receivable_id = r.id AND p.voided_at IS NULL), 0) received_cents
    FROM receivables r WHERE r.id = ?
  `).get(receivableId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("应收不存在");
  const amount = Number(row.amount_cents), invoiced = Number(row.invoiced_cents), received = Number(row.received_cents);
  const status = (value: number) => value === 0 ? "NONE" : value < amount ? "PARTIAL" : "FULL";
  return {
    amountCents: amount, invoicedCents: invoiced, receivedCents: received,
    invoiceStatus: status(invoiced), receiptStatus: status(received),
    overdue: !row.voided_at && !Number(row.due_date_is_estimated) && received < amount && String(row.due_date) < today,
    voided: Boolean(row.voided_at),
  };
}

export function calculateCommission(input: {
  grossCents: number; taxCents?: number; businessFeeCents?: number;
  agencyFeeCents?: number; otherFeeCents?: number; basisPoints: number;
}) {
  const deductions = (input.taxCents ?? 0) + (input.businessFeeCents ?? 0) +
    (input.agencyFeeCents ?? 0) + (input.otherFeeCents ?? 0);
  const baseCents = Math.max(0, input.grossCents - deductions);
  return { baseCents, commissionCents: multiplyBasisPoints(baseCents, input.basisPoints) };
}
