import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { writeAudit } from "../../lib/audit.ts";
import type { SessionUser } from "../../lib/auth.ts";
import { inTransaction } from "../../lib/db.ts";
import { parseMoneyToCents } from "../../lib/money.ts";
import { canManageFinance, contractScopeSql, customerScopeSql, projectScopeSql } from "../../lib/permissions.ts";

const key = z.string().trim().min(8, "请重新打开表单后提交").max(100);
const description = z.string().trim().max(500, "说明不能超过500字");
const contractSchema = z.object({
  id: z.string().optional(), idempotencyKey: key,
  number: z.string().trim().min(2, "合同编号至少2字").max(50, "合同编号不能超过50字"),
  name: z.string().trim().min(2, "合同名称至少2字").max(150, "合同名称不能超过150字"),
  customerId: z.string().min(1, "请选择客户"), signedDate: z.string().date("签订日期不正确").or(z.literal("")),
  amount: z.string().min(1, "请填写合同金额"), status: z.enum(["DRAFT", "ACTIVE", "COMPLETED"]), description,
});
const receivableSchema = z.object({
  idempotencyKey: key, contractId: z.string().min(1, "请选择合同"), projectId: z.string().optional(),
  name: z.string().trim().min(1, "请填写款项名称").max(100), category: z.string().trim().min(1, "请填写款项类型").max(50),
  amount: z.string().min(1, "请填写应收金额"), dueDate: z.string().date("计划回款日不正确"), notes: description,
});

function atomic<T>(db: DatabaseSync, work: () => T) {
  try { return inTransaction(db, work); }
  catch (error) {
    if (error instanceof Error && /database is (locked|busy)/i.test(error.message)) throw new Error("其他操作正在处理中，请保留内容稍后重试");
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) throw new Error("合同编号已存在", { cause: error });
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_SQLITE_ERROR") throw new Error("保存失败，数据已回滚，请稍后重试", { cause: error });
    throw error;
  }
}

function idempotent(db: DatabaseSync, operation: string, idempotencyKey: string, payload: unknown, write: () => string) {
  const requestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const existing = db.prepare("SELECT operation,request_hash,result_id FROM idempotency_keys WHERE key=?")
    .get(idempotencyKey) as { operation: string; request_hash: string | null; result_id: string } | undefined;
  if (existing) {
    if (existing.operation !== operation || existing.request_hash !== requestHash) throw new Error("幂等键对应的请求内容不一致，请核对上次提交结果");
    return { id: existing.result_id, replayed: true };
  }
  const id = write();
  db.prepare("INSERT INTO idempotency_keys (key,operation,result_id,request_hash) VALUES (?,?,?,?)").run(idempotencyKey, operation, id, requestHash);
  return { id, replayed: false };
}

export function saveContractRecord(db: DatabaseSync, actor: SessionUser, body: unknown) {
  const input = contractSchema.parse(body), amountCents = parseMoneyToCents(input.amount);
  return atomic(db, () => {
    if (!input.id && actor.role === "PROJECT_MEMBER") throw new Error("项目人员无权创建合同主档");
    const scope = customerScopeSql(actor), contractScope = contractScopeSql(actor);
    if (!db.prepare(`SELECT 1 FROM customers c WHERE c.id=? AND ${scope.sql}`).get(input.customerId, ...scope.params)) throw new Error("客户不存在或无权访问");
    const before = input.id ? db.prepare(`SELECT ct.* FROM contracts ct JOIN customers c ON c.id=ct.customer_id
      WHERE ct.id=? AND ${scope.sql} AND ${contractScope.sql}`).get(input.id, ...scope.params, ...contractScope.params) as Record<string, unknown> | undefined : undefined;
    if (input.id && !before) throw new Error("合同不存在或无权修改");
    if (before && before.customer_id !== input.customerId) throw new Error("已有合同不可更换客户");
    return idempotent(db, "SAVE_CONTRACT", input.idempotencyKey, { ...input, amountCents }, () => {
      if (before?.status === "VOID") throw new Error("合同已作废，不能修改");
      const id = input.id || randomUUID();
      if (before) db.prepare(`UPDATE contracts SET number=?,name=?,signed_date=?,amount_cents=?,status=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(input.number, input.name, input.signedDate || null, amountCents, input.status, input.description || null, id);
      else db.prepare("INSERT INTO contracts (id,number,name,customer_id,signed_date,amount_cents,status,description) VALUES (?,?,?,?,?,?,?,?)")
        .run(id, input.number, input.name, input.customerId, input.signedDate || null, amountCents, input.status, input.description || null);
      writeAudit(db, { userId: actor.id, action: before ? "UPDATE" : "CREATE", entityType: "CONTRACT", entityId: id, before, after: { ...input, amountCents } });
      return id;
    });
  });
}

export function createReceivableRecord(db: DatabaseSync, actor: SessionUser, body: unknown) {
  if (!canManageFinance(actor) && actor.role !== "DEPARTMENT_MANAGER") throw new Error("当前角色无权创建应收");
  const input = receivableSchema.parse(body), amountCents = parseMoneyToCents(input.amount);
  if (amountCents <= 0) throw new Error("应收金额必须大于0");
  return atomic(db, () => {
    const scope = customerScopeSql(actor), projectScope = projectScopeSql(actor);
    const contract = db.prepare(`SELECT ct.customer_id,ct.status FROM contracts ct JOIN customers c ON c.id=ct.customer_id
      WHERE ct.id=? AND ${scope.sql}`).get(input.contractId, ...scope.params) as { customer_id: string; status: string } | undefined;
    if (!contract) throw new Error("合同不存在或无权访问");
    const project = input.projectId ? db.prepare(`SELECT p.status FROM projects p WHERE p.id=? AND p.customer_id=? AND ${projectScope.sql}`)
      .get(input.projectId, contract.customer_id, ...projectScope.params) as { status: string } | undefined : undefined;
    if (input.projectId && !project) throw new Error("项目不存在、无权访问或与合同客户不一致");
    return idempotent(db, "CREATE_RECEIVABLE", input.idempotencyKey, { ...input, amountCents }, () => {
      if (contract.status === "VOID") throw new Error("合同已作废，不能新增应收");
      if (project?.status === "VOID") throw new Error("项目已作废，不能新增应收");
      const id = randomUUID();
      db.prepare(`INSERT INTO receivables (id,contract_id,project_id,name,category,amount_cents,due_date,owner_user_id,notes) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, input.contractId, input.projectId || null, input.name, input.category, amountCents, input.dueDate, actor.id, input.notes || null);
      writeAudit(db, { userId: actor.id, action: "CREATE", entityType: "RECEIVABLE", entityId: id, after: { ...input, amountCents } });
      return id;
    });
  });
}

export function voidBusinessEntry(db: DatabaseSync, actor: SessionUser, body: unknown) {
  if (!canManageFinance(actor)) throw new Error("仅管理员或财务可以作废财务记录");
  const input = z.object({ id: z.string().min(1), type: z.enum(["receivable", "contract"]), reason: z.string().trim().min(2, "作废原因至少2字").max(500, "作废原因不能超过500字") }).parse(body);
  return atomic(db, () => {
    const table = input.type === "receivable" ? "receivables" : "contracts";
    const before = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(input.id) as Record<string, unknown> | undefined;
    if (!before) throw new Error("记录不存在");
    if (before.voided_at || before.status === "VOID") throw new Error("记录已作废，请刷新查看原记录");
    // Allocated money must be corrected through the source documents first.
    const allocated = db.prepare(`SELECT 1 FROM receivables r WHERE ${input.type === "receivable" ? "r.id=?" : "r.contract_id=?"} AND (
      EXISTS (SELECT 1 FROM invoice_allocations a JOIN invoices i ON i.id=a.invoice_id WHERE a.receivable_id=r.id AND i.voided_at IS NULL)
      OR EXISTS (SELECT 1 FROM receipt_allocations a JOIN receipts p ON p.id=a.receipt_id WHERE a.receivable_id=r.id AND p.voided_at IS NULL)) LIMIT 1`).get(input.id);
    if (allocated) throw new Error("存在有效票款分摊，请先作废对应发票或回款，再作废应收或合同");
    if (input.type === "receivable") db.prepare("UPDATE receivables SET voided_at=CURRENT_TIMESTAMP,void_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(input.reason, input.id);
    else db.prepare("UPDATE contracts SET status='VOID',description=CASE WHEN description IS NULL OR description='' THEN ? ELSE description||char(10)||? END,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(`作废：${input.reason}`, `作废：${input.reason}`, input.id);
    writeAudit(db, { userId: actor.id, action: "VOID", entityType: input.type === "receivable" ? "RECEIVABLE" : "CONTRACT", entityId: input.id, before, after: { reason: input.reason } });
    return { id: input.id };
  });
}
