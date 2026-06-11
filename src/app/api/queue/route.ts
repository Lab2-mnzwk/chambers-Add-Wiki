import { NextRequest, NextResponse } from "next/server";
import { getQueue } from "@/lib/work-service";
import type { WorkOptions } from "@/lib/types";

function parseOptions(searchParams: URLSearchParams): WorkOptions {
  return {
    worker: searchParams.get("worker") ?? "",
    queueFilter: (searchParams.get("queueFilter") ??
      "未担当＋自分担当") as WorkOptions["queueFilter"],
    skipDone: searchParams.get("skipDone") !== "false",
    lightBlueOnly: searchParams.get("lightBlueOnly") !== "false",
    showEmptyFromAc: searchParams.get("showEmptyFromAc") === "true",
    indexRows: Number(searchParams.get("indexRows") ?? 10000),
  };
}

export async function GET(request: NextRequest) {
  try {
    const options = parseOptions(request.nextUrl.searchParams);
    const sheetRows = await getQueue(options);
    return NextResponse.json({ sheetRows });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
