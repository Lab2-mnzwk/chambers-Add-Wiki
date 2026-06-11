import { NextRequest, NextResponse } from "next/server";
import { saveRow } from "@/lib/work-service";
import type { SavePayload } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as SavePayload;
    const result = await saveRow(payload);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
