"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { createReceivableRecord, saveContractRecord, voidBusinessEntry } from "./service.ts";

export type BusinessActionState = { ok: boolean; message: string };
async function context() {
  const db = getDb(), user = getSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) throw new Error("登录已过期，请重新登录");
  return { db, user };
}
function refresh() {
  for (const path of ["/contracts", "/finance", "/", "/commissions"]) revalidatePath(path);
}
function failure(error: unknown): BusinessActionState {
  if (error instanceof ZodError) return { ok: false, message: error.issues[0]?.message || "提交内容不正确" };
  return { ok: false, message: error instanceof Error && /UNIQUE/.test(error.message) ? "合同编号已存在" : error instanceof Error ? error.message : "保存失败" };
}

export async function saveContract(_state: BusinessActionState, formData: FormData): Promise<BusinessActionState> {
  try {
    const { db, user } = await context();
    const result = saveContractRecord(db, user, Object.fromEntries(formData));
    refresh();
    return { ok: true, message: result.replayed ? "合同已保存，请勿重复提交" : formData.get("id") ? "合同已更新" : "合同已创建" };
  } catch (error) { return failure(error); }
}

export async function createReceivable(_state: BusinessActionState, formData: FormData): Promise<BusinessActionState> {
  try {
    const { db, user } = await context();
    const result = createReceivableRecord(db, user, Object.fromEntries(formData));
    refresh();
    return { ok: true, message: result.replayed ? "应收已保存，请勿重复提交" : "应收计划已创建" };
  } catch (error) { return failure(error); }
}

export async function voidBusinessRecord(formData: FormData): Promise<BusinessActionState> {
  try {
    const { db, user } = await context();
    voidBusinessEntry(db, user, Object.fromEntries(formData));
    refresh();
    return { ok: true, message: "记录已作废，历史记录与原因已保留" };
  } catch (error) { return failure(error); }
}
