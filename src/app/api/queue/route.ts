import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { DEFAULT_INDEX_ROWS } from "@/lib/config";
import { getQueue } from "@/lib/work-service";
import type { CompactQueue, WorkOptions } from "@/lib/types";

function parseOptions(searchParams: URLSearchParams): WorkOptions {
  return {
    worker: searchParams.get("worker") ?? "",
    queueFilter: (searchParams.get("queueFilter") ??
      "自分担当") as WorkOptions["queueFilter"],
    statusFilter: (["all", "incomplete", "notStarted"].includes(
      searchParams.get("statusFilter") ?? ""
    )
      ? searchParams.get("statusFilter")
      : "incomplete") as WorkOptions["statusFilter"],
    lightBlueOnly: searchParams.get("lightBlueOnly") !== "false",
    showNamedTriplets: searchParams.get("showNamedTriplets") === "true",
    fullEditMode: searchParams.get("fullEditMode") === "true",
    indexRows: Number(searchParams.get("indexRows") ?? DEFAULT_INDEX_ROWS),
  };
}

export async function GET(request: NextRequest) {
  try {
    const options = parseOptions(request.nextUrl.searchParams);
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";
    const refreshSheets = request.nextUrl.searchParams
      .get("sheet")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const queue = await getQueue(options, forceRefresh, refreshSheets);
    if (request.nextUrl.searchParams.get("compact") === "true") {
      const bySheet = new Map<string, number[]>();
      for (const entry of queue) {
        const rows = bySheet.get(entry.sheet) ?? [];
        rows.push(entry.row);
        bySheet.set(entry.sheet, rows);
      }
      const queueCompact: CompactQueue = [...bySheet.entries()];
      return NextResponse.json({ queueCompact });
    }
    return NextResponse.json({ queue });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
