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
    const sheet = request.nextUrl.searchParams.get("sheet") ?? "";
    const lightBlueOnly =
      request.nextUrl.searchParams.get("lightBlueOnly") !== "false";
    const fullEditMode =
      request.nextUrl.searchParams.get("fullEditMode") === "true";
    const showNamedTriplets =
      request.nextUrl.searchParams.get("showNamedTriplets") === "true";
    const payload = await getRow(sheet, sheetRowNumber, {
      lightBlueOnly,
      fullEditMode,
      showNamedTriplets,
    });
    return NextResponse.json(payload);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
