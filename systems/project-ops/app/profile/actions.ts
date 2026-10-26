"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SESSION_COOKIE } from "@/lib/api.ts";
import { getSessionUser } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { updateOwnProfile } from "@/lib/profile.ts";

export type ProfileActionState = { ok: boolean; message: string };
const schema = z.object({ name: z.string().trim().min(2, "姓名至少2个字").max(100), email: z.union([z.literal(""), z.string().email("邮箱格式不正确").max(200)]) });

export async function saveProfile(_state: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  try {
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "资料格式不正确" };
    const db = getDb(), user = getSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value);
    if (!user) return { ok: false, message: "登录已过期，请重新登录" };
    updateOwnProfile(db, user, parsed.data); revalidatePath("/profile");
    return { ok: true, message: "个人资料已更新" };
  } catch (error) {
    const message = error instanceof Error && /UNIQUE constraint failed: users.email/.test(error.message) ? "邮箱已被其他人员使用" : error instanceof Error ? error.message : "保存失败";
    return { ok: false, message };
  }
}
