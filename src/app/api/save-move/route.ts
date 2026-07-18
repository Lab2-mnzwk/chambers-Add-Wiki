import { after, NextRequest, NextResponse } from "next/server";
import { getSheetById } from "@/lib/config";
import { getRow, navigateToTarget, saveRow } from "@/lib/work-service";
import { withSheetsAccessToken } from "@/lib/sheets";
import type {
  QueueEntry,
  SaveMoveAction,
  SaveMoveResponse,
  SavePayload,
  WorkOptions,
} from "@/lib/types";

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function parseRowOptions(value: SaveMoveAction["rowOptions"] | undefined) {
  return {
    lightBlueOnly: value?.lightBlueOnly !== false,
    fullEditMode: value?.fullEditMode === true,
    showNamedTriplets: value?.showNamedTriplets === true,
  };
}

function parseAction(raw: SaveMoveAction): SaveMoveAction {
  if (raw.kind !== "jump" && raw.kind !== "navigate") {
    throw new Error("移動方法が不正です。");
  }
  if (raw.kind === "jump") {
    const target = raw.target as QueueEntry;
    if (
      !getSheetById(target?.sheet) ||
      !Number.isFinite(target?.row) ||
      target.row < 2
    ) {
      throw new Error("移動先のシートまたは行番号が不正です。");
    }
    return {
      kind: "jump",
      target: { sheet: target.sheet, row: Math.floor(target.row) },
      rowOptions: parseRowOptions(raw.rowOptions),
    };
  }
  const candidates = Array.isArray(raw.candidates)
    ? raw.candidates
        .filter(
          (entry) =>
            getSheetById(entry?.sheet) &&
            Number.isFinite(entry?.row) &&
            entry.row >= 2
        )
        .slice(0, 20)
        .map((entry) => ({ sheet: entry.sheet, row: Math.floor(entry.row) }))
    : [];
  const statusFilter = (["all", "incomplete", "notStarted"].includes(
    raw.statusFilter
  )
    ? raw.statusFilter
    : "incomplete") as WorkOptions["statusFilter"];
  return {
    kind: "navigate",
    candidates,
    statusFilter,
    rowOptions: parseRowOptions(raw.rowOptions),
  };
}

export async function POST(request: NextRequest) {
  let body: { save: SavePayload; move: SaveMoveAction };
  try {
    body = (await request.json()) as typeof body;
    if (!body.save || !body.move) throw new Error("保存・移動情報が不足しています。");
  } catch (error) {
    return NextResponse.json(
      {
        save: { ok: false, error: errorMessage(error) },
        move: { ok: false, kind: "navigate", error: errorMessage(error) },
      } satisfies SaveMoveResponse,
      { status: 400 }
    );
  }

  let action: SaveMoveAction;
  try {
    action = parseAction(body.move);
  } catch (error) {
    return NextResponse.json(
      {
        save: { ok: false, error: errorMessage(error) },
        move: { ok: false, kind: body.move.kind, error: errorMessage(error) },
      } satisfies SaveMoveResponse,
      { status: 400 }
    );
  }

  let response: SaveMoveResponse;
  try {
    response = await withSheetsAccessToken<SaveMoveResponse>(async () => {
      const runSave = () => saveRow(body.save, (work) => after(work));
      const runMove = async () => {
        if (action.kind === "jump") {
          return getRow(
            action.target.sheet,
            action.target.row,
            action.rowOptions
          );
        }
        return navigateToTarget(
          action.candidates,
          action.statusFilter,
          action.rowOptions
        );
      };

      // 同じ行を「開く」場合だけは、保存後の値を確実に読むため直列にする。
      const sameRowJump =
        action.kind === "jump" &&
        action.target.sheet === body.save.sheet &&
        action.target.row === body.save.sheetRowNumber;

      if (sameRowJump && action.kind === "jump") {
        try {
          const saveResult = await runSave();
          try {
            const moveResult = await getRow(
              action.target.sheet,
              action.target.row,
              action.rowOptions,
              true
            );
            return {
              save: { ok: true, result: saveResult },
              move: { ok: true, kind: "jump", result: moveResult },
            };
          } catch (error) {
            return {
              save: { ok: true, result: saveResult },
              move: { ok: false, kind: "jump", error: errorMessage(error) },
            };
          }
        } catch (error) {
          return {
            save: { ok: false, error: errorMessage(error) },
            move: {
              ok: false,
              kind: "jump",
              error: "保存失敗のため移動しません。",
            },
          };
        }
      }

      const [saveSettled, moveSettled] = await Promise.allSettled([
        runSave(),
        runMove(),
      ]);
      const save =
        saveSettled.status === "fulfilled"
          ? ({ ok: true, result: saveSettled.value } as const)
          : ({ ok: false, error: errorMessage(saveSettled.reason) } as const);
      const move =
        moveSettled.status === "fulfilled"
          ? action.kind === "jump"
            ? ({ ok: true, kind: "jump", result: moveSettled.value } as const)
            : ({
                ok: true,
                kind: "navigate",
                result: moveSettled.value,
              } as const)
          : ({
              ok: false,
              kind: action.kind,
              error: errorMessage(moveSettled.reason),
            } as const);
      return { save, move } as SaveMoveResponse;
    });
  } catch (error) {
    const message = errorMessage(error);
    response = {
      save: { ok: false, error: message },
      move: { ok: false, kind: action.kind, error: message },
    };
  }

  return NextResponse.json(response);
}
