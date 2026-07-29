import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import {
  cacheStats,
  clearCacheByTarget,
  type CacheTarget,
} from "@/lib/work-service";

const VALID_TARGETS: CacheTarget[] = ["all", "nav", "rows", "wiki"];

export async function DELETE(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get("target") ?? "all";
    const target = (VALID_TARGETS.includes(raw as CacheTarget)
      ? raw
      : "all") as CacheTarget;
    await clearCacheByTarget(target);
    return NextResponse.json({ ok: true, target, stats: await cacheStats() });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

export async function GET() {
  return NextResponse.json(await cacheStats());
}
