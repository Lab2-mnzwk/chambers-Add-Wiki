import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
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
    return apiErrorResponse(e);
  }
}
