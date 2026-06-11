import { NextResponse } from "next/server";
import { cacheStats, refreshCache } from "@/lib/work-service";

export async function DELETE() {
  try {
    await refreshCache();
    return NextResponse.json({ ok: true, stats: cacheStats() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(cacheStats());
}
