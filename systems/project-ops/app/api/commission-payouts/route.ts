import type { NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, assertSameOrigin, requireApiUser, SESSION_COOKIE } from "../../../lib/api.ts";
import { commissionActor, CommissionError, createCommissionPayout, parseCommissionFilters, queryCommissions } from "../../../lib/commissions.ts";
import { getDb } from "../../../lib/db.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function actor(request: NextRequest, finance = false) {
  if (!request.cookies.get(SESSION_COOKIE)?.value) throw new ApiError(401, "请先登录");
  return commissionActor(getDb(), requireApiUser(request), finance);
}
function failure(error: unknown) {
  if (error instanceof ApiError || error instanceof CommissionError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: "发放内容不完整或格式不正确" }, { status: 400, headers });
  return Response.json({ error: "提成处理失败，请稍后重试或联系管理员" }, { status: 500, headers });
}
export function GET(request: NextRequest) {
  try {
    const user = actor(request);
    return Response.json(queryCommissions(getDb(), user, parseCommissionFilters(request.nextUrl.searchParams)), { headers });
  } catch (error) { return failure(error); }
}
const payout = z.object({ accrualIds: z.array(z.string().trim().min(1).max(100)).min(1).max(500), payoutDate: z.string(), notes: z.string().max(1000).optional() }).strict();
export async function POST(request: NextRequest) {
  try {
    const user = actor(request, true); assertSameOrigin(request);
    const input = payout.parse(await request.json());
    return Response.json(createCommissionPayout(getDb(), { ...input, createdBy: user.id }), { status: 201, headers });
  } catch (error) { return failure(error); }
}
