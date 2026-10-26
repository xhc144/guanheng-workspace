import type { NextRequest } from "next/server";
import { ApiError, requireApiUser, SESSION_COOKIE } from "../../../lib/api.ts";
import { getDb } from "../../../lib/db.ts";
import { ExtensionAccessError, getIntegrationHealth } from "../../../lib/extension-registry.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export function GET(request: NextRequest) {
  try {
    if (!request.cookies.get(SESSION_COOKIE)?.value) throw new ApiError(401, "请先登录");
    const user = requireApiUser(request);
    return Response.json(getIntegrationHealth(getDb(), user), { headers });
  } catch (error) {
    if (error instanceof ApiError || error instanceof ExtensionAccessError) {
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    return Response.json({ error: "集成状态暂时无法读取，请稍后重试或联系管理员" }, { status: 500, headers });
  }
}
