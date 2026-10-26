import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiFailure, assertSameOrigin, requestIp, SESSION_COOKIE } from "@/lib/api.ts";
import { writeAudit } from "@/lib/audit.ts";
import { consumeLoginCode, createSession, findActiveLoginUser, verifyPassword } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";

const LoginSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), username: z.string().trim().min(1).max(200), password: z.string().min(1).max(256) }),
  z.object({ method: z.literal("code"), username: z.string().trim().min(1).max(200), code: z.string().regex(/^\d{6}$/) }),
]);

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = LoginSchema.parse(await request.json());
    const db = getDb();
    const row = input.method === "password" ? findActiveLoginUser(db, input.username) : undefined;
    const userId = input.method === "password" ? row && verifyPassword(input.password, row.password_hash) ? row.id : null : consumeLoginCode(db, input.username, input.code);
    if (!userId) {
      writeAudit(db, { action: input.method === "password" ? "LOGIN_FAILED" : "LOGIN_CODE_FAILED", entityType: "USER", entityId: row?.id ?? input.username, ipAddress: requestIp(request) });
      return NextResponse.json({ error: input.method === "password" ? "用户名/邮箱或密码错误" : "验证码错误或已失效" }, { status: 401 });
    }
    const session = createSession(db, userId);
    writeAudit(db, { userId, action: input.method === "password" ? "LOGIN" : "LOGIN_CODE", entityType: "USER", entityId: userId, ipAddress: requestIp(request) });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, session.token, {
      httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
      path: "/", expires: new Date(session.expiresAt),
    });
    return response;
  } catch (error) { return apiFailure(error); }
}
