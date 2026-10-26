import { NextRequest, NextResponse } from "next/server";
import { apiFailure, requireApiUser } from "@/lib/api.ts";

export function GET(request: NextRequest) {
  try { return NextResponse.json({ user: requireApiUser(request) }); }
  catch (error) { return apiFailure(error); }
}
