import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { getWikiHistorySuggestions } from "@/lib/work-service";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const name = params.get("name") ?? "";
    const wiki = params.get("wiki") ?? "";
    const query = params.get("q") ?? "";
    const indexRows = Number(params.get("indexRows") ?? 10000);

    const suggestions = await getWikiHistorySuggestions(
      name,
      wiki,
      query,
      indexRows
    );
    return NextResponse.json({ suggestions });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
