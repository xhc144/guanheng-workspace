import type { NextRequest } from "next/server";
import { ApiError, requireApiUser, SESSION_COOKIE } from "../../../lib/api.ts";
import { getRuntimeHealth, RuntimeHealthAccessError } from "../../../lib/runtime-health.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export function GET(request: NextRequest) {
  try {
    // 无会话时在调用共享数据库初始化前拒绝，保持匿名诊断请求无数据副作用。
    if (!request.cookies.get(SESSION_COOKIE)?.value) throw new ApiError(401, "请先登录");
    const user = requireApiUser(request);
    return Response.json(getRuntimeHealth(user), { headers });
  } catch (error) {
    if (error instanceof ApiError || error instanceof RuntimeHealthAccessError) {
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    // 不复用会回显任意异常 message 的通用错误响应，防止路径或配置进入接口。
    return Response.json({ error: "运行诊断暂时无法读取，请稍后重试或联系管理员" }, { status: 500, headers });
  }
}
