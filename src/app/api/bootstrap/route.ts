import { NextResponse } from "next/server";
import { getBootstrap } from "@/lib/work-service";

export async function GET() {
  try {
    const data = await getBootstrap();
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
