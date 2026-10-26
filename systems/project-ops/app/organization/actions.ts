"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser, type Role } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { saveDepartmentRecord, saveUserRecord } from "@/lib/organization.ts";

export type OrganizationActionState = { ok: boolean; message: string };
const optionalId = z.string().trim().max(100).transform((value) => value || undefined);
const departmentSchema = z.object({ id: optionalId, name: z.string().trim().min(2).max(100), parentId: optionalId, managerUserId: optionalId });
const userSchema = z.object({ id: optionalId, username: z.string().trim().min(3).max(40), name: z.string().trim().min(2).max(100),
  email: z.string().trim().max(200), password: z.string().max(200), role: z.enum(["ADMIN", "FINANCE", "DEPARTMENT_MANAGER", "PROJECT_MEMBER"]), departmentId: optionalId, active: z.enum(["1", "0"]) });

async function context() {
  const db = getDb(), user = getSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) throw new Error("登录已过期，请重新登录");
  if (user.role !== "ADMIN") throw new Error("仅管理员可以维护组织与人员");
  return { db, user };
}

function message(error: unknown) {
  if (error instanceof Error && /UNIQUE constraint failed: departments.name/.test(error.message)) return "部门名称已存在";
  if (error instanceof Error && /UNIQUE constraint failed: users.username/.test(error.message)) return "登录账号已存在";
  if (error instanceof Error && /UNIQUE constraint failed: users.email/.test(error.message)) return "邮箱已被其他人员使用";
  return error instanceof Error ? error.message : "保存失败";
}

export async function saveDepartment(_state: OrganizationActionState, formData: FormData): Promise<OrganizationActionState> {
  try {
    const parsed = departmentSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "部门内容不正确" };
    const { db, user } = await context(); saveDepartmentRecord(db, user, parsed.data); revalidatePath("/organization");
    return { ok: true, message: parsed.data.id ? "部门已更新" : "部门已创建" };
  } catch (error) { return { ok: false, message: message(error) }; }
}

export async function saveUser(_state: OrganizationActionState, formData: FormData): Promise<OrganizationActionState> {
  try {
    const parsed = userSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "人员内容不正确" };
    const { db, user } = await context(), input = parsed.data;
    saveUserRecord(db, user, { ...input, role: input.role as Role, active: input.active === "1" }); revalidatePath("/organization");
    return { ok: true, message: input.id ? "人员档案已更新" : "人员档案已创建" };
  } catch (error) { return { ok: false, message: message(error) }; }
}
