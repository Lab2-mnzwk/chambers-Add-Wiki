import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { getBootstrap } from "@/lib/work-service";

export async function GET() {
  try {
    const data = await getBootstrap();
    return NextResponse.json(data);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
