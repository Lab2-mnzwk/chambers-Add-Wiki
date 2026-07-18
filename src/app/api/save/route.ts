import { after, NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { saveRow } from "@/lib/work-service";
import type { SavePayload } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as SavePayload;
    const result = await saveRow(payload, (work) => after(work));
    return NextResponse.json(result);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
