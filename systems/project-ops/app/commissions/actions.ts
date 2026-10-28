"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SESSION_COOKIE } from "../../lib/api.ts";
import { getSessionUser } from "../../lib/auth.ts";
import { accrueCommissions, commissionActor, CommissionError, createCommissionPayout, refreshCommissionEligibility, voidCommissionAccrual } from "../../lib/commissions.ts";
import { getDb, inTransaction } from "../../lib/db.ts";
import { writeAudit } from "../../lib/audit.ts";
import { parseMoneyToCents } from "../../lib/money.ts";

export type CommissionActionState = { ok: boolean; message: string };
const schema = z.object({
  projectId: z.string().trim().min(1).max(100), sourceType: z.enum(["CONTRACT", "RECEIPT", "SETTLEMENT"]),
  sourceId: z.string().trim().min(1).max(100), gross: z.string().optional(), tax: z.string().optional(),
  businessFee: z.string().optional(), agencyFee: z.string().optional(), otherFee: z.string().optional(),
  releaseCondition: z.string().max(100).optional(), settlementConfirmed: z.string().optional(),
});
const optionalMoney = (value: string | undefined) => !value?.trim() || /^0(?:\.0{1,2})?$/.test(value.trim()) ? 0 : parseMoneyToCents(value);
function failure(error: unknown): CommissionActionState {
  if (error instanceof CommissionError) return { ok: false, message: error.message };
  if (error instanceof Error && /金额|范围/.test(error.message)) return { ok: false, message: error.message };
  return { ok: false, message: "提成操作失败，请稍后重试或联系管理员" };
}
async function context() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) throw new CommissionError(401, "登录已过期，请重新登录");
  const db = getDb(), actor = getSessionUser(db, token), user = commissionActor(db, actor, true);
  return { db, user };
}
export async function createCommission(_state: CommissionActionState, formData: FormData): Promise<CommissionActionState> {
  try {
    const { db, user } = await context(), parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, message: "请选择项目、来源并检查计提内容" };
    const input = parsed.data;
    if (input.sourceType === "SETTLEMENT" && input.settlementConfirmed !== "on") return { ok: false, message: "请确认结算单号和结算金额已经人工核对" };
    const ids = accrueCommissions(db, user, { projectId: input.projectId, sourceType: input.sourceType, sourceId: input.sourceId,
      grossCents: input.sourceType === "SETTLEMENT" ? parseMoneyToCents(input.gross ?? "") : 0,
      taxCents: optionalMoney(input.tax), businessFeeCents: optionalMoney(input.businessFee), agencyFeeCents: optionalMoney(input.agencyFee), otherFeeCents: optionalMoney(input.otherFee), releaseCondition: input.releaseCondition || null });
    revalidatePath("/commissions");
    return { ok: true, message: `已为 ${ids.length} 名成员计提，点数以计提时的项目成员设置为准` };
  } catch (error) { return failure(error); }
}
export async function payoutCommissions(_state: CommissionActionState, formData: FormData): Promise<CommissionActionState> {
  try {
    const { db, user } = await context(), result = createCommissionPayout(db, {
      accrualIds: formData.getAll("accrualIds").map(String), payoutDate: String(formData.get("payoutDate") ?? ""), createdBy: user.id, notes: String(formData.get("notes") ?? ""),
    });
    revalidatePath("/commissions");
    return { ok: true, message: `发放批次已生成：${result.payoutId}` };
  } catch (error) { return failure(error); }
}
export async function refreshCommissions(): Promise<CommissionActionState> {
  try {
    const { db, user } = await context();
    const changed = inTransaction(db, () => {
      const count = refreshCommissionEligibility(db);
      if (count) writeAudit(db, { userId: user.id, action: "REFRESH", entityType: "COMMISSION", entityId: "eligibility", after: { changed: count } });
      return count;
    });
    revalidatePath("/commissions"); return { ok: true, message: `已复核发放条件，更新 ${changed} 笔未发提成；已发历史保持原金额` };
  } catch (error) { return failure(error); }
}
export async function voidCommission(_state: CommissionActionState, formData: FormData): Promise<CommissionActionState> {
  try {
    const { db, user } = await context();
    voidCommissionAccrual(db, user, String(formData.get("id") ?? ""), String(formData.get("reason") ?? ""));
    revalidatePath("/commissions"); return { ok: true, message: "提成已作废，原因和操作者已留存审计" };
  } catch (error) { return failure(error); }
}
