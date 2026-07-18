import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { getRowStatuses } from "@/lib/work-service";

/**
 * 移動探索の先読み用: 指定シートの複数行の作業 Status を一括取得する。
 * body: { sheet: string; rows: number[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      sheet?: string;
      rows?: unknown;
    };
    const sheet = body.sheet ?? "";
    const rows = Array.isArray(body.rows)
      ? body.rows.map((r) => Number(r)).filter((r) => Number.isFinite(r) && r >= 2)
      : [];
    if (!sheet || !rows.length) {
      return NextResponse.json({ sheet, statuses: {} });
    }
    const result = await getRowStatuses(sheet, rows);
    return NextResponse.json(result);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
