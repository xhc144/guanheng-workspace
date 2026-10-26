import { type NextRequest, NextResponse } from "next/server";
import { apiFailure, requireApiUser } from "@/lib/api.ts";
import { globalSearch } from "@/lib/customer-insights.ts";
import { getDb } from "@/lib/db.ts";

export function GET(request: NextRequest) {
  try {
    const result = globalSearch(getDb(), requireApiUser(request), request.nextUrl.searchParams.get("q") ?? "");
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiFailure(error); }
}
