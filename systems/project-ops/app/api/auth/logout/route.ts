import { NextRequest, NextResponse } from "next/server";
import { apiFailure, assertSameOrigin, requireApiUser, SESSION_COOKIE } from "@/lib/api.ts";
import { writeAudit } from "@/lib/audit.ts";
import { deleteSession } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";

export function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = requireApiUser(request);
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (token) deleteSession(getDb(), token);
    writeAudit(getDb(), { userId: user.id, action: "LOGOUT", entityType: "USER", entityId: user.id });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
    return response;
  } catch (error) { return apiFailure(error); }
}
