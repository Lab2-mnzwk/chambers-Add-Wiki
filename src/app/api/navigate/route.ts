import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-error";
import { navigateToTarget } from "@/lib/work-service";
import type { QueueEntry, WorkOptions } from "@/lib/types";

/**
 * A: 移動探索の集約。候補（travel 方向に並んだ行）を順に走査し、進捗フィルタで
 * スキップすべき行を飛ばして最初の着地行を確定し、その全データを 1 リクエストで返す。
 * body: {
 *   candidates: { sheet: string; row: number }[];
 *   statusFilter: "all" | "incomplete" | "notStarted";
 *   row: { lightBlueOnly: boolean; fullEditMode: boolean; showNamedTriplets: boolean };
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      candidates?: unknown;
      statusFilter?: WorkOptions["statusFilter"];
      row?: {
        lightBlueOnly?: boolean;
        fullEditMode?: boolean;
        showNamedTriplets?: boolean;
      };
    };

    const candidates: QueueEntry[] = Array.isArray(body.candidates)
      ? body.candidates
          .map((c) => {
            const e = c as { sheet?: unknown; row?: unknown };
            return { sheet: String(e.sheet ?? ""), row: Number(e.row) };
          })
          .filter((e) => e.sheet && Number.isFinite(e.row) && e.row >= 2)
      : [];

    const statusFilter = (["all", "incomplete", "notStarted"].includes(
      body.statusFilter ?? ""
    )
      ? body.statusFilter
      : "incomplete") as WorkOptions["statusFilter"];

    if (!candidates.length) {
      return NextResponse.json({
        landing: null,
        landingIndex: -1,
        payload: null,
        statuses: {},
      });
    }

    const result = await navigateToTarget(candidates, statusFilter, {
      lightBlueOnly: body.row?.lightBlueOnly !== false,
      fullEditMode: body.row?.fullEditMode === true,
      showNamedTriplets: body.row?.showNamedTriplets === true,
    });
    return NextResponse.json(result);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
