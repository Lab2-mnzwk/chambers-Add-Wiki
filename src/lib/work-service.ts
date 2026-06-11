import {
  COL_ASSIGNEE,
  DEFAULT_INDEX_ROWS,
  ENABLE_SHEET_WRITES,
  SHEET_NAME,
  WORK_STATUS_OPTIONS,
  workSheetEditUrl,
} from "./config";
import {
  buildRowPayload,
  buildWritePlan,
  collectEditableUpdates,
  filterQueueRows,
  rowByUniqueFromValues,
} from "./columns";
import {
  executeWritePlan,
  fetchQueueIndex,
  fetchRowValues,
  loadAssignDiscordNames,
  loadSheetStructure,
} from "./sheets";
import {
  cacheStats,
  clearCache,
  getRowValues,
  getStructure,
  hasQueueIndex,
  loadQueueIndex,
  patchQueueIndex,
  patchRowValues,
  saveQueueIndex,
  saveRowValues,
  setStructure,
} from "./store";
import type {
  BootstrapPayload,
  RowPayload,
  SavePayload,
  SaveResult,
  SheetStructure,
  WorkOptions,
} from "./types";

export { clearCache, cacheStats };

async function ensureStructure(): Promise<SheetStructure> {
  let structure = getStructure();
  if (!structure) {
    structure = await loadSheetStructure();
    setStructure(structure);
  }
  return structure;
}

export async function getBootstrap(): Promise<BootstrapPayload> {
  const structure = await ensureStructure();
  const discordNames = await loadAssignDiscordNames();
  return {
    spreadsheetTitle: structure.title,
    sheetName: SHEET_NAME,
    sheetUrl: workSheetEditUrl(),
    discordNames,
    statusOptions: [...WORK_STATUS_OPTIONS],
    defaultIndexRows: DEFAULT_INDEX_ROWS,
    enableWrites: ENABLE_SHEET_WRITES,
  };
}

export async function getQueue(options: WorkOptions): Promise<number[]> {
  const structure = await ensureStructure();
  let records = hasQueueIndex(options.indexRows)
    ? loadQueueIndex()
    : null;

  if (!records) {
    records = await fetchQueueIndex(structure, options.indexRows);
    saveQueueIndex(records, options.indexRows);
  }

  return filterQueueRows(records, options);
}

export async function getRow(
  sheetRowNumber: number,
  options: Pick<WorkOptions, "showEmptyFromAc" | "lightBlueOnly">
): Promise<RowPayload> {
  const structure = await ensureStructure();
  let rowValues = getRowValues(sheetRowNumber);
  if (!rowValues) {
    rowValues = await fetchRowValues(structure, sheetRowNumber);
    saveRowValues(sheetRowNumber, rowValues);
  }

  const rowByUnique = rowByUniqueFromValues(structure.uniqueHeaders, rowValues);
  return buildRowPayload(
    rowByUnique,
    structure.rawHeaders,
    structure.uniqueHeaders,
    sheetRowNumber,
    options
  );
}

export async function saveRow(payload: SavePayload): Promise<SaveResult> {
  if (!ENABLE_SHEET_WRITES) {
    throw new Error("ENABLE_SHEET_WRITES=false のため書き込みできません。");
  }

  const structure = await ensureStructure();
  const rowPayload = await getRow(payload.sheetRowNumber, payload.options);
  const workColNames = rowPayload.columns.map((c) => c.uniqueName);

  const updates = collectEditableUpdates(
    payload.edits,
    workColNames,
    structure.rawHeaders,
    structure.uniqueHeaders
  );
  if (payload.worker && structure.uniqueHeaders.includes(COL_ASSIGNEE)) {
    updates[COL_ASSIGNEE] = payload.worker;
  }

  const plan = buildWritePlan(
    payload.sheetRowNumber,
    structure.rawHeaders,
    structure.uniqueHeaders,
    updates
  );

  if (!plan.length) {
    throw new Error("書き込み対象セルがありません。");
  }

  await executeWritePlan(plan);
  patchRowValues(payload.sheetRowNumber, structure.uniqueHeaders, updates);

  const statusUnique = rowPayload.columns.find((c) => c.isStatus)?.uniqueName;
  if (statusUnique && updates[statusUnique] !== undefined) {
    patchQueueIndex(
      payload.sheetRowNumber,
      updates[statusUnique],
      updates[COL_ASSIGNEE] ?? ""
    );
  } else if (updates[COL_ASSIGNEE]) {
    patchQueueIndex(payload.sheetRowNumber, "", updates[COL_ASSIGNEE]);
  }

  const currentIndex = payload.queueSheetRows.indexOf(payload.sheetRowNumber);
  const nextSheetRowNumber =
    currentIndex >= 0 && currentIndex + 1 < payload.queueSheetRows.length
      ? payload.queueSheetRows[currentIndex + 1]
      : null;

  return {
    savedCells: plan.length,
    nextSheetRowNumber,
    atEnd: nextSheetRowNumber === null,
  };
}

export async function refreshCache(): Promise<void> {
  clearCache();
  const structure = await loadSheetStructure();
  setStructure(structure);
}
