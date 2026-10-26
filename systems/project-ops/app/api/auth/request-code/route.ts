import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, apiFailure, requestIp } from "@/lib/api.ts";
import { writeAudit } from "@/lib/audit.ts";
import { findActiveLoginUser, issueLoginCode } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { isEmailDeliveryConfigured, processEmailOutbox, queueEmail } from "@/lib/notifications.ts";

const schema = z.object({ username: z.string().trim().min(1).max(200) });

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const { username } = schema.parse(await request.json());
    const db = getDb();
    const user = findActiveLoginUser(db, username);
    if (user?.email && isEmailDeliveryConfigured()) {
      const { code } = issueLoginCode(db, user.id, requestIp(request));
      queueEmail(db, user.email, "项目经营管理系统登录验证码", `你的登录验证码是：${code}\n\n验证码 10 分钟内有效，请勿转发给他人。`);
      await processEmailOutbox(db);
    }
    writeAudit(db, { action: "LOGIN_CODE_REQUEST", entityType: "USER", entityId: user?.id ?? username, ipAddress: requestIp(request) });
    return NextResponse.json({ message: "如账号已绑定邮箱，登录验证码将发送至该邮箱" });
  } catch (error) {
    if (error instanceof Error && /过于频繁|次数过多/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 429 });
    return apiFailure(error);
  }
}
