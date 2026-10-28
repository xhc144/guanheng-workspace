import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SessionUser } from "./auth.ts";
import { writeAudit } from "./audit.ts";
import { businessDate } from "./business-date.ts";
import { calculateCommission } from "./finance.ts";
import { inTransaction } from "./db.ts";
import { canManageFinance, projectScopeSql } from "./permissions.ts";

export class CommissionError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function fail(message: string, status = 400): never { throw new CommissionError(status, message); }
function text(value: string, label: string, max = 100) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail(`${label}不正确`);
  return value.trim();
}
function cents(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label}必须是非负整数分且不能超出范围`);
  return value;
}
function totalCents(values: number[]) {
  return values.reduce((sum, value) => cents(sum + cents(value, "金额"), "合计金额"), 0);
}
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail("发放日期不正确");
  return value;
}
// Reload current roles and department; callers cannot supply a stale or forged role.
export function commissionActor(db: DatabaseSync, actor: Pick<SessionUser, "id"> | null, finance = false): SessionUser {
  if (!actor?.id) fail("请先登录", 401);
  const row = db.prepare("SELECT id,username,name,email,role,department_id FROM users WHERE id=? AND active=1").get(actor.id);
  if (!row) fail("登录已过期，请重新登录", 401);
  const user: SessionUser = { id: String(row.id), username: String(row.username), name: String(row.name),
    email: row.email ? String(row.email) : null, role: row.role as SessionUser["role"], departmentId: row.department_id ? String(row.department_id) : null };
  if (finance && !canManageFinance(user)) fail("仅管理员或财务可以操作提成", 403);
  return user;
}
export type CommissionInput = {
  projectId: string; sourceType: "CONTRACT" | "RECEIPT" | "SETTLEMENT"; sourceId: string;
  grossCents: number; taxCents?: number; businessFeeCents?: number; agencyFeeCents?: number; otherFeeCents?: number;
  releaseCondition?: string | null; ruleVersionId?: string | null;
};
type EligibilityInput = Pick<CommissionInput, "projectId" | "sourceType" | "sourceId" | "releaseCondition">;
type Condition = { met: boolean; totalCents: number; receivedCents: number; count: number };
function conditionSnapshot(db: DatabaseSync, projectId: string, category: string): Condition {
  const rows = db.prepare(`SELECT r.amount_cents,
    (SELECT COALESCE(SUM(ra.amount_cents),0) FROM receipt_allocations ra JOIN receipts rp ON rp.id=ra.receipt_id
      WHERE ra.receivable_id=r.id AND rp.voided_at IS NULL) received
    FROM receivables r JOIN contracts ct ON ct.id=r.contract_id
    WHERE r.project_id=? AND r.category=? AND r.voided_at IS NULL AND ct.status!='VOID'`)
    .all(projectId, category) as { amount_cents: number; received: number }[];
  const total = totalCents(rows.map(r => Number(r.amount_cents)));
  return { met: total > 0 && rows.every(r => Number(r.received) >= Number(r.amount_cents)),
    totalCents: total, receivedCents: totalCents(rows.map(r => Number(r.received))), count: rows.length };
}
export function releaseConditionMet(db: DatabaseSync, projectId: string, category: string) {
  return conditionSnapshot(db, projectId, category).met;
}
function eligibility(db: DatabaseSync, input: EligibilityInput) {
  let reason = "";
  if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND status!='VOID'").get(input.projectId)) reason = "项目已作废或不存在";
  if (!reason && input.sourceType === "CONTRACT" && !db.prepare(`SELECT 1 FROM contracts ct WHERE ct.id=? AND ct.status!='VOID' AND
    (EXISTS(SELECT 1 FROM contract_projects cp WHERE cp.contract_id=ct.id AND cp.project_id=?) OR
     EXISTS(SELECT 1 FROM receivables r WHERE r.contract_id=ct.id AND r.project_id=?))`).get(input.sourceId, input.projectId, input.projectId)) reason = "来源合同已作废、不存在或未关联该项目";
  if (!reason && input.sourceType === "RECEIPT" && !db.prepare(`SELECT 1 FROM receipts rp JOIN receipt_allocations ra ON ra.receipt_id=rp.id
    JOIN receivables r ON r.id=ra.receivable_id JOIN contracts ct ON ct.id=r.contract_id
    WHERE rp.id=? AND rp.voided_at IS NULL AND r.project_id=? AND r.voided_at IS NULL AND ct.status!='VOID'`).get(input.sourceId, input.projectId)) reason = "来源回款已作废或没有该项目的有效分摊";
  const condition = input.releaseCondition ? conditionSnapshot(db, input.projectId, input.releaseCondition) : null;
  if (!reason && condition && !condition.met) reason = condition.count ? `「${input.releaseCondition}」尚未全部到账` : `「${input.releaseCondition}」没有有效应收，需人工复核`;
  return { eligible: !reason, reason: reason || (condition ? `「${input.releaseCondition}」已全部到账` : "无需额外到账条件"),
    conditionTotalCents: condition?.totalCents ?? 0, conditionReceivedCents: condition?.receivedCents ?? 0 };
}
// Compatible with the rule engine. User-facing accruals call accrueCommissions for authorization and audit.
export function createProjectCommissions(db: DatabaseSync, input: CommissionInput) {
  const projectId = text(input.projectId, "项目"), sourceId = text(input.sourceId, "提成来源");
  if (!["CONTRACT", "RECEIPT", "SETTLEMENT"].includes(input.sourceType)) fail("计提来源类型不正确");
  const amounts = [input.grossCents, input.taxCents ?? 0, input.businessFeeCents ?? 0, input.agencyFeeCents ?? 0, input.otherFeeCents ?? 0];
  amounts.forEach(value => cents(value, "计提金额")); const deductions = totalCents(amounts.slice(1));
  const condition = input.releaseCondition ? text(input.releaseCondition, "指定款项", 100) : null;
  return inTransaction(db, () => {
    if (!db.prepare("SELECT 1 FROM projects WHERE id=? AND status!='VOID'").get(projectId)) fail("项目不存在或已作废");
    if (db.prepare("SELECT 1 FROM commission_accruals WHERE project_id=? AND source_type=? AND source_id=? AND status!='VOID'").get(projectId, input.sourceType, sourceId)) fail("该来源已计提，请勿重复提交", 409);
    if (condition && !conditionSnapshot(db, projectId, condition).count) fail("指定款项必须精确选择该项目的有效应收类别");
    const members = db.prepare("SELECT user_id,commission_basis_points FROM project_members WHERE project_id=? AND commission_basis_points>0").all(projectId) as { user_id: string; commission_basis_points: number }[];
    if (!members.length) fail("项目没有可计提成员");
    const state = eligibility(db, { ...input, projectId, sourceId, releaseCondition: condition });
    const ids: string[] = [];
    for (const member of members) {
      const basisPoints = Number(member.commission_basis_points), base = Math.max(0, input.grossCents - deductions);
      if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || !Number.isSafeInteger(base * basisPoints)) fail("成员点数或计算金额超出精确计算范围");
      const result = calculateCommission({ ...input, basisPoints }), id = randomUUID(); cents(result.commissionCents, "个人提成");
      db.prepare(`INSERT INTO commission_accruals (id,project_id,user_id,source_type,source_id,gross_cents,tax_cents,business_fee_cents,agency_fee_cents,other_fee_cents,basis_points,commission_cents,release_condition,status,rule_version_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, projectId, member.user_id, input.sourceType, sourceId, ...amounts, basisPoints, result.commissionCents, condition, state.eligible ? "PAYABLE" : "BLOCKED", input.ruleVersionId ?? null);
      ids.push(id);
    }
    return ids;
  });
}
export function accrueCommissions(db: DatabaseSync, actor: SessionUser, input: CommissionInput) {
  return inTransaction(db, () => {
    const user = commissionActor(db, actor, true), actual = { ...input };
    if (input.sourceType === "CONTRACT") {
      const row = db.prepare(`SELECT ct.amount_cents FROM contracts ct JOIN contract_projects cp ON cp.contract_id=ct.id
        WHERE ct.id=? AND cp.project_id=? AND ct.status!='VOID'`).get(input.sourceId, input.projectId);
      if (!row) fail("合同不是该项目的有效合同"); actual.grossCents = Number(row.amount_cents);
    } else if (input.sourceType === "RECEIPT") {
      const row = db.prepare(`SELECT COALESCE(SUM(ra.amount_cents),0) amount_cents FROM receipt_allocations ra
        JOIN receipts rp ON rp.id=ra.receipt_id JOIN receivables r ON r.id=ra.receivable_id JOIN contracts ct ON ct.id=r.contract_id
        WHERE rp.id=? AND r.project_id=? AND rp.voided_at IS NULL AND r.voided_at IS NULL AND ct.status!='VOID'`).get(input.sourceId, input.projectId)!;
      actual.grossCents = Number(row.amount_cents); if (!actual.grossCents) fail("回款未有效分摊到该项目");
    }
    const ids = createProjectCommissions(db, actual);
    for (const id of ids) writeAudit(db, { userId: user.id, action: "ACCRUE", entityType: "COMMISSION", entityId: id,
      after: db.prepare("SELECT * FROM commission_accruals WHERE id=?").get(id) });
    return ids;
  });
}
// WP07 calls this exact signature within its receipt transaction. PAID/VOID/PENDING history is retained.
export function refreshCommissionEligibility(db: DatabaseSync, projectId?: string): number {
  return inTransaction(db, () => {
    const rows = db.prepare(`SELECT * FROM commission_accruals WHERE status IN ('BLOCKED','PAYABLE') ${projectId ? "AND project_id=?" : ""}`)
      .all(...(projectId ? [projectId] : [])); let changed = 0;
    for (const row of rows) {
      const state = eligibility(db, { projectId: String(row.project_id), sourceType: row.source_type as CommissionInput["sourceType"], sourceId: String(row.source_id), releaseCondition: row.release_condition ? String(row.release_condition) : null });
      const status = state.eligible ? "PAYABLE" : "BLOCKED"; if (status === row.status) continue;
      changed += Number(db.prepare("UPDATE commission_accruals SET status=? WHERE id=? AND status=?").run(status, row.id!, row.status!).changes);
      writeAudit(db, { action: "ELIGIBILITY", entityType: "COMMISSION", entityId: String(row.id), before: { status: row.status }, after: { status, reason: state.reason } });
    }
    return changed;
  });
}
export function createCommissionPayout(db: DatabaseSync, input: { accrualIds: string[]; payoutDate: string; createdBy: string; notes?: string }) {
  if (!Array.isArray(input.accrualIds) || !input.accrualIds.length || input.accrualIds.length > 500) fail("请选择1至500笔可发放提成");
  const ids = input.accrualIds.map(id => text(id, "提成编号")); if (new Set(ids).size !== ids.length) fail("同一批次不能重复选择提成", 409);
  date(input.payoutDate); const notes = input.notes?.trim() ?? ""; if (notes.length > 1000) fail("批次备注不能超过1000字");
  return inTransaction(db, () => {
    const user = commissionActor(db, { id: input.createdBy }, true), rows = ids.map(id => db.prepare("SELECT * FROM commission_accruals WHERE id=?").get(id));
    if (rows.some(row => !row || !["PAYABLE", "BLOCKED"].includes(String(row.status)) || Number(row.commission_cents) <= 0 ||
      !eligibility(db, { projectId: String(row.project_id), sourceType: row.source_type as CommissionInput["sourceType"], sourceId: String(row.source_id), releaseCondition: row.release_condition ? String(row.release_condition) : null }).eligible)) fail("包含不可发放、条件失效、零金额或已发放的提成", 409);
    const total = totalCents(rows.map(row => Number(row!.commission_cents))), payoutId = randomUUID();
    db.prepare("INSERT INTO commission_payouts (id,payout_date,total_cents,created_by,notes) VALUES (?,?,?,?,?)").run(payoutId, input.payoutDate, total, user.id, notes || null);
    for (const row of rows) {
      db.prepare("INSERT INTO commission_payout_items (payout_id,accrual_id,amount_cents) VALUES (?,?,?)").run(payoutId, row!.id!, row!.commission_cents!);
      db.prepare("UPDATE commission_accruals SET status='PAID' WHERE id=?").run(row!.id!);
    }
    writeAudit(db, { userId: user.id, action: "PAYOUT", entityType: "COMMISSION_PAYOUT", entityId: payoutId, after: { accrualIds: ids, payoutDate: input.payoutDate, totalCents: total, notes } });
    return { payoutId, totalCents: total };
  });
}
export function voidCommissionAccrual(db: DatabaseSync, actor: SessionUser, id: string, reason: string) {
  id = text(id, "提成编号"); reason = text(reason, "作废原因", 1000); if (reason.length < 2) fail("作废原因至少填写2个字");
  return inTransaction(db, () => {
    const user = commissionActor(db, actor, true), before = db.prepare("SELECT * FROM commission_accruals WHERE id=? AND status NOT IN ('PAID','VOID')").get(id);
    if (!before) fail("提成不存在、已发放或已作废", 409);
    db.prepare("UPDATE commission_accruals SET status='VOID' WHERE id=?").run(id);
    writeAudit(db, { userId: user.id, action: "VOID", entityType: "COMMISSION", entityId: id, before, after: { status: "VOID", reason } });
  });
}
export type CommissionFilters = { month?: string; userId?: string; status?: string; payoutId?: string; projectId?: string; page?: string };
export function parseCommissionFilters(params: URLSearchParams): CommissionFilters {
  const allowed = ["month", "userId", "status", "payoutId", "projectId", "page"];
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) fail("查询包含未知或重复筛选参数");
  return Object.fromEntries(params);
}
export type CommissionEntry = {
  id: string; projectId: string; projectName: string; customerName: string; userId: string; userName: string;
  sourceType: string; sourceId: string; sourceLabel: string; grossCents: number; taxCents: number; businessFeeCents: number;
  agencyFeeCents: number; otherFeeCents: number; baseCents: number; basisPoints: number; commissionCents: number;
  releaseCondition: string | null; status: string; storedStatus: string; eligible: boolean; reason: string;
  conditionTotalCents: number; conditionReceivedCents: number; requiresReview: boolean; payoutId: string | null;
  payoutDate: string | null; payoutAmountCents: number | null; createdAt: string; voidReason: string | null;
};
export function queryCommissions(db: DatabaseSync, actor: SessionUser | null, filters: CommissionFilters = {}) {
  const user = commissionActor(db, actor), finance = canManageFinance(user), month = filters.month ?? businessDate().slice(0, 7);
  if (month && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith("0000"))) fail("查询月份不正确");
  const status = filters.status || "ALL"; if (!["ALL", "UNPAID", "PAID", "BLOCKED", "PAYABLE", "VOID", "REVIEW"].includes(status)) fail("提成状态筛选不正确");
  if (filters.page && !/^[1-9]\d{0,5}$/.test(filters.page)) fail("查询页码不正确");
  for (const value of [filters.userId, filters.projectId, filters.payoutId]) if (value && (value.length > 100 || value.trim() !== value)) fail("查询编号不正确");
  if (!finance && filters.userId && filters.userId !== user.id) fail("个人提成查询不能读取他人数据", 403);
  const scope = projectScopeSql(user), clauses = [scope.sql], params: string[] = [...scope.params], targetUser = finance ? filters.userId : user.id;
  if (targetUser) { clauses.push("ca.user_id=?"); params.push(targetUser); }
  if (filters.projectId) { clauses.push("ca.project_id=?"); params.push(filters.projectId); }
  if (filters.payoutId) { clauses.push("cp.id=?"); params.push(filters.payoutId); }
  if (month) { clauses.push("(CASE WHEN ca.status='PAID' THEN substr(cp.payout_date,1,7) ELSE strftime('%Y-%m',ca.created_at,'+8 hours') END)=?"); params.push(month); }
  const rows = db.prepare(`SELECT ca.*,p.name project_name,c.name customer_name,u.name user_name,cp.id payout_id,cp.payout_date,cp.notes payout_notes,pay_creator.name payout_creator,pi.amount_cents payout_amount,
    CASE ca.source_type WHEN 'CONTRACT' THEN COALESCE((SELECT number FROM contracts WHERE id=ca.source_id),ca.source_id)
      WHEN 'RECEIPT' THEN COALESCE((SELECT reference_number FROM receipts WHERE id=ca.source_id),ca.source_id) ELSE ca.source_id END source_label,
    (SELECT json_extract(a.after_json,'$.reason') FROM audit_logs a WHERE a.entity_type='COMMISSION' AND a.entity_id=ca.id AND a.action='VOID' ORDER BY a.created_at DESC,a.id DESC LIMIT 1) void_reason
    FROM commission_accruals ca JOIN projects p ON p.id=ca.project_id JOIN customers c ON c.id=p.customer_id JOIN users u ON u.id=ca.user_id
    LEFT JOIN commission_payout_items pi ON pi.accrual_id=ca.id LEFT JOIN commission_payouts cp ON cp.id=pi.payout_id LEFT JOIN users pay_creator ON pay_creator.id=cp.created_by
    WHERE ${clauses.join(" AND ")} ORDER BY ca.created_at DESC,ca.id DESC`).all(...params);
  const entries: CommissionEntry[] = rows.map(row => {
    const state = eligibility(db, { projectId: String(row.project_id), sourceType: row.source_type as CommissionInput["sourceType"], sourceId: String(row.source_id), releaseCondition: row.release_condition ? String(row.release_condition) : null });
    const effectiveStatus = ["BLOCKED", "PAYABLE"].includes(String(row.status)) ? (state.eligible ? "PAYABLE" : "BLOCKED") : String(row.status);
    return { id: String(row.id), projectId: String(row.project_id), projectName: String(row.project_name), customerName: String(row.customer_name), userId: String(row.user_id), userName: String(row.user_name),
      sourceType: String(row.source_type), sourceId: String(row.source_id), sourceLabel: String(row.source_label), grossCents: Number(row.gross_cents), taxCents: Number(row.tax_cents), businessFeeCents: Number(row.business_fee_cents), agencyFeeCents: Number(row.agency_fee_cents), otherFeeCents: Number(row.other_fee_cents),
      baseCents: Math.max(0, Number(row.gross_cents) - Number(row.tax_cents) - Number(row.business_fee_cents) - Number(row.agency_fee_cents) - Number(row.other_fee_cents)), basisPoints: Number(row.basis_points), commissionCents: Number(row.commission_cents),
      releaseCondition: row.release_condition ? String(row.release_condition) : null, status: effectiveStatus, storedStatus: String(row.status), ...state, requiresReview: row.status === "PAID" && !state.eligible,
      payoutId: row.payout_id ? String(row.payout_id) : null, payoutDate: row.payout_date ? String(row.payout_date) : null, payoutAmountCents: row.payout_amount == null ? null : Number(row.payout_amount), createdAt: String(row.created_at), voidReason: row.void_reason ? String(row.void_reason) : null };
  });
  const selected = entries.filter(row => status === "ALL" || (status === "UNPAID" ? ["PENDING", "BLOCKED", "PAYABLE"].includes(row.status) : status === "REVIEW" ? row.requiresReview : row.status === status));
  const metadata = new Map(rows.filter(row => row.payout_id).map(row => [String(row.payout_id), { notes: finance && row.payout_notes ? String(row.payout_notes) : null, createdByName: finance && row.payout_creator ? String(row.payout_creator) : null }]));
  const batches = new Map<string, { id: string; payoutDate: string; visibleTotalCents: number; itemCount: number; requiresReview: boolean; notes: string | null; createdByName: string | null }>();
  for (const row of selected) if (row.payoutId) {
    const batch = batches.get(row.payoutId) ?? { id: row.payoutId, payoutDate: row.payoutDate!, visibleTotalCents: 0, itemCount: 0, requiresReview: false, ...metadata.get(row.payoutId)! };
    batch.visibleTotalCents = totalCents([batch.visibleTotalCents, row.payoutAmountCents ?? 0]); batch.itemCount++; batch.requiresReview ||= row.requiresReview; batches.set(batch.id, batch);
  }
  const pageCount = Math.max(1, Math.ceil(selected.length / 25)), page = Math.min(Number(filters.page || 1), pageCount);
  return { month, status, page, pageCount, total: selected.length, entries: selected.slice((page - 1) * 25, page * 25), batches: [...batches.values()].sort((a, b) => b.payoutDate.localeCompare(a.payoutDate) || a.id.localeCompare(b.id)),
    totals: { paidCents: totalCents(selected.filter(r => r.status === "PAID").map(r => r.payoutAmountCents ?? 0)), unpaidCents: totalCents(selected.filter(r => ["PENDING", "BLOCKED", "PAYABLE"].includes(r.status)).map(r => r.commissionCents)), payableCents: totalCents(selected.filter(r => r.status === "PAYABLE").map(r => r.commissionCents)), reviewCount: selected.filter(r => r.requiresReview).length },
    monthBasis: "已发按发放月份；未发、作废按计提月份（上海时间）。清空月份可查询全部。批次金额仅汇总本次筛选可见明细。" };
}
