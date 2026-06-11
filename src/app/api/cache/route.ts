import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { cacheStats, refreshCache } from "@/lib/work-service";

export async function DELETE() {
  try {
    await refreshCache();
    return NextResponse.json({ ok: true, stats: cacheStats() });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

export async function GET() {
  return NextResponse.json(cacheStats());
}
