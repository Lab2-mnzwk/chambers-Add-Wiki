import { NextRequest, NextResponse } from "next/server";
import { getRow } from "@/lib/work-service";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sheetRow: string }> }
) {
  try {
    const { sheetRow } = await context.params;
    const sheetRowNumber = Number(sheetRow);
    if (!sheetRowNumber || sheetRowNumber < 2) {
      return NextResponse.json({ error: "Invalid row number" }, { status: 400 });
    }
    const showEmptyFromAc =
      request.nextUrl.searchParams.get("showEmptyFromAc") === "true";
    const lightBlueOnly =
      request.nextUrl.searchParams.get("lightBlueOnly") !== "false";
    const payload = await getRow(sheetRowNumber, {
      showEmptyFromAc,
      lightBlueOnly,
    });
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
