import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { getSessionUser, type SessionUser } from "./auth.ts";
import { getDb } from "./db.ts";

export const SESSION_COOKIE = "pms_session";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function requireApiUser(request: NextRequest): SessionUser {
  const user = getSessionUser(getDb(), request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) throw new ApiError(401, "请先登录");
  return user;
}

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let parsedOrigin: URL;
  try { parsedOrigin = new URL(origin); }
  catch { throw new ApiError(403, "请求来源不可信"); }
  const host = request.headers.get("host");
  if (!host || parsedOrigin.host.toLowerCase() !== host.toLowerCase() || parsedOrigin.protocol !== request.nextUrl.protocol) {
    throw new ApiError(403, "请求来源不可信");
  }
}

export function requestIp(request: NextRequest) {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export function apiFailure(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) {
    return Response.json({ error: "提交内容不完整或格式不正确", details: error.issues }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "服务器处理失败";
  const conflict = /UNIQUE constraint failed|重复|已被/.test(message);
  return Response.json({ error: conflict ? "记录重复，请检查唯一字段" : message }, { status: conflict ? 409 : 400 });
}
