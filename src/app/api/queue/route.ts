import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { getQueue } from "@/lib/work-service";
import type { WorkOptions } from "@/lib/types";

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
    indexRows: Number(searchParams.get("indexRows") ?? 10000),
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
    return NextResponse.json({ queue });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
