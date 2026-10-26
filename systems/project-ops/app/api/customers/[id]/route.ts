import { type NextRequest, NextResponse } from "next/server";
import { apiFailure, requireApiUser } from "@/lib/api.ts";
import { getCustomerDetail } from "@/lib/customer-insights.ts";
import { getDb } from "@/lib/db.ts";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const db = getDb(), user = requireApiUser(request), { id } = await params, detail = getCustomerDetail(db, user, id);
    if (!detail) return NextResponse.json({ error: "客户不存在" }, { status: 404 });
    return NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiFailure(error); }
}
