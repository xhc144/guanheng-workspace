import { NextRequest, NextResponse } from "next/server";
import { apiFailure, ApiError, assertSameOrigin, requestIp, requireApiUser } from "@/lib/api.ts";
import { getDb } from "@/lib/db.ts";
import { createFinanceEntry, voidFinanceEntry } from "../service.ts";

type Context = { params: Promise<{ kind: string }> };
async function readBody(request: NextRequest) {
  try { return await request.json(); }
  catch { throw new ApiError(400, "请求内容不是有效JSON，请重新提交"); }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    assertSameOrigin(request);
    const actor = requireApiUser(request), { kind } = await params;
    const result = createFinanceEntry(getDb(), actor, kind, await readBody(request), requestIp(request));
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) { return apiFailure(error); }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    assertSameOrigin(request);
    const actor = requireApiUser(request), { kind } = await params;
    return NextResponse.json(voidFinanceEntry(getDb(), actor, kind, await readBody(request), requestIp(request)));
  } catch (error) { return apiFailure(error); }
}
