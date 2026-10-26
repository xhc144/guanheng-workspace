import type { NextRequest } from "next/server";
import { ApiError, requireApiUser, SESSION_COOKIE } from "../../../lib/api.ts";
import { assertCapabilityAdmin, CapabilityError, getCapabilities } from "../../../lib/capabilities/service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export function GET(request: NextRequest) {
  try {
    if (!request.cookies.get(SESSION_COOKIE)?.value) throw new ApiError(401, "请先登录");
    const actor = requireApiUser(request);
    assertCapabilityAdmin(actor);
    const query = request.nextUrl.searchParams;
    // Reject ambiguous/repeated or unknown parameters, rather than silently choosing one.
    if ([...query.keys()].some(key => !["q", "system", "decision", "page"].includes(key) || query.getAll(key).length > 1)) {
      throw new CapabilityError(400, "筛选参数重复或不受支持");
    }
    return Response.json(getCapabilities(actor, Object.fromEntries(query)), { headers });
  } catch (error) {
    if (error instanceof ApiError || error instanceof CapabilityError) {
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    return Response.json({ error: "能力目录暂时无法读取，请稍后重试或联系管理员" }, { status: 500, headers });
  }
}
