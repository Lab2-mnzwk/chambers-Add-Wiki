import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { getQueue } from "@/lib/work-service";
import type { WorkOptions } from "@/lib/types";

function parseOptions(searchParams: URLSearchParams): WorkOptions {
  return {
    worker: searchParams.get("worker") ?? "",
    queueFilter: (searchParams.get("queueFilter") ??
      "自分担当") as WorkOptions["queueFilter"],
    skipDone: searchParams.get("skipDone") !== "false",
    lightBlueOnly: searchParams.get("lightBlueOnly") !== "false",
    fullEditMode: searchParams.get("fullEditMode") === "true",
    indexRows: Number(searchParams.get("indexRows") ?? 10000),
  };
}

export async function GET(request: NextRequest) {
  try {
    const options = parseOptions(request.nextUrl.searchParams);
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";
    const sheetRows = await getQueue(options, forceRefresh);
    return NextResponse.json({ sheetRows });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
