import {
  DEFAULT_INDEX_ROWS,
  ENABLE_SHEET_WRITES,
  IDLE_CACHE_CLEAR_MS,
  SHEET_NAME,
  SPREADSHEET_DISPLAY_TITLE,
  WORK_STATUS_OPTIONS,
  workSheetEditUrl,
} from "./config";
import { auth, isOAuthConfigured } from "@/auth";
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
  fetchWikiHistoryFromSheet,
  loadAssignDiscordNames,
  loadSheetStructure,
} from "./sheets";
import {
  cacheStats,
  clearCache,
  getLastAccessAt,
  getRowValues,
  getStructure,
  getWikiHistory,
  hasQueueIndex,
  hasWikiHistory,
  loadQueueIndex,
  patchQueueIndex,
  patchRowValues,
  saveQueueIndex,
  saveRowValues,
  saveWikiHistory,
  setStructure,
  touchLastAccessAt,
} from "./store";
import type {
  BootstrapPayload,
  RowPayload,
  SavePayload,
  SaveResult,
  SheetStructure,
  WorkOptions,
} from "./types";
import {
  aggregateWikiHistory,
  mergeWikiHistoryFromSave,
  suggestWikiHistory,
  type WikiHistoryIndex,
  type WikiHistorySuggestion,
} from "./wiki-history";

export { clearCache, cacheStats };

/**
 * アクセスが IDLE_CACHE_CLEAR_MS 以上空いていたら全キャッシュをクリアする。
 * 直後の ensureStructure / getQueue / getRow / ensureWikiHistory が
 * シートから作り直すため、アイドル明けの初回アクセスで最新化される。
 * 連続利用中（閾値未満の間隔）は何もしないのでキャッシュ効果は維持される。
 */
function clearCacheIfIdle(now: number = Date.now()): void {
  const lastAccessAt = getLastAccessAt();
  if (lastAccessAt !== null && now - lastAccessAt >= IDLE_CACHE_CLEAR_MS) {
    clearCache();
  }
}

async function ensureStructure(): Promise<SheetStructure> {
  let structure = getStructure();
  if (!structure) {
    structure = await loadSheetStructure();
    setStructure(structure);
  }
  return structure;
}

export async function ensureWikiHistory(indexRows: number): Promise<WikiHistoryIndex> {
  if (hasWikiHistory(indexRows)) {
    return getWikiHistory()!;
  }
  const structure = await ensureStructure();
  const raw = await fetchWikiHistoryFromSheet(structure, indexRows);
  const index = aggregateWikiHistory(raw, indexRows);
  saveWikiHistory(index);
  return index;
}

export async function getWikiHistorySuggestions(
  name: string,
  wiki: string,
  query: string,
  indexRows: number
): Promise<WikiHistorySuggestion[]> {
  const index = await ensureWikiHistory(indexRows);
  return suggestWikiHistory(index, name, wiki, query);
}

export async function getBootstrap(): Promise<BootstrapPayload> {
  const oauth = isOAuthConfigured();
  const session = oauth ? await auth() : null;

  if (oauth && !session?.user) {
    return {
      authMode: "oauth",
      authRequired: true,
      userEmail: null,
      spreadsheetTitle: SPREADSHEET_DISPLAY_TITLE,
      sheetName: SHEET_NAME,
      sheetUrl: workSheetEditUrl(),
      discordNames: [],
      statusOptions: [...WORK_STATUS_OPTIONS],
      defaultIndexRows: DEFAULT_INDEX_ROWS,
      enableWrites: ENABLE_SHEET_WRITES,
    };
  }

  // アイドル明け（最終アクセスから閾値以上経過）なら全キャッシュをクリアし、
  // 続く ensureStructure / queue / row / 補完候補をシートから作り直す。
  clearCacheIfIdle();
  await ensureStructure();
  const discordNames = await loadAssignDiscordNames();
  // 今回のアクセス時刻を記録（次回のアイドル判定の基準）。
  touchLastAccessAt();
  return {
    authMode: oauth ? "oauth" : "service_account",
    authRequired: false,
    userEmail: session?.user?.email ?? null,
    spreadsheetTitle: SPREADSHEET_DISPLAY_TITLE,
    sheetName: SHEET_NAME,
    sheetUrl: workSheetEditUrl(),
    discordNames,
    statusOptions: [...WORK_STATUS_OPTIONS],
    defaultIndexRows: DEFAULT_INDEX_ROWS,
    enableWrites: ENABLE_SHEET_WRITES,
  };
}

export async function getQueue(
  options: WorkOptions,
  forceRefresh = false
): Promise<number[]> {
  touchLastAccessAt();
  const structure = await ensureStructure();
  let records =
    !forceRefresh && hasQueueIndex(options.indexRows) ? loadQueueIndex() : null;

  if (!records) {
    // forceRefresh 時はシートから status/assignee を取り直す（index 列のみの 1 回の batchGet）。
    records = await fetchQueueIndex(structure, options.indexRows);
    saveQueueIndex(records, options.indexRows);
  }

  return filterQueueRows(records, options);
}

export async function getRow(
  sheetRowNumber: number,
  options: Pick<WorkOptions, "lightBlueOnly" | "fullEditMode" | "showNamedTriplets">
): Promise<RowPayload> {
  touchLastAccessAt();
  const structure = await ensureStructure();
  let rowValues = getRowValues(sheetRowNumber);
  if (!rowValues) {
    rowValues = await fetchRowValues(structure, sheetRowNumber);
    saveRowValues(sheetRowNumber, rowValues);
  }

  const rowByUnique = rowByUniqueFromValues(structure.uniqueHeaders, rowValues);
  const payload = buildRowPayload(
    rowByUnique,
    structure.rawHeaders,
    structure.uniqueHeaders,
    sheetRowNumber,
    options
  );

  // 自己修復: 開いた行のライブ status をキュー index キャッシュへ反映する。
  // アプリ外でシートを直接編集して完了にした行も、開けば以降の判定・保存再計算で除外される。
  const statusValue = payload.columns.find((c) => c.isStatus)?.value;
  if (statusValue) {
    patchQueueIndex(sheetRowNumber, statusValue, "");
  }

  return payload;
}

export async function saveRow(payload: SavePayload): Promise<SaveResult> {
  if (!ENABLE_SHEET_WRITES) {
    throw new Error("ENABLE_SHEET_WRITES=false のため書き込みできません。");
  }

  const structure = await ensureStructure();
  const rowPayload = await getRow(payload.sheetRowNumber, payload.options);
  const workColNames = rowPayload.columns.map((c) => c.uniqueName);

  const fullEditMode = payload.options.fullEditMode === true;
  const updates = collectEditableUpdates(
    payload.edits,
    workColNames,
    structure.rawHeaders,
    structure.uniqueHeaders,
    fullEditMode
  );

  const plan = buildWritePlan(
    payload.sheetRowNumber,
    structure.rawHeaders,
    structure.uniqueHeaders,
    updates,
    fullEditMode
  );

  if (!plan.length) {
    throw new Error("書き込み対象セルがありません。");
  }

  await executeWritePlan(plan);
  patchRowValues(payload.sheetRowNumber, structure.uniqueHeaders, updates);

  const updatedValues = getRowValues(payload.sheetRowNumber);
  if (updatedValues) {
    const mergedRow = rowByUniqueFromValues(structure.uniqueHeaders, updatedValues);
    let history = getWikiHistory();
    if (!history || history.indexRows !== payload.options.indexRows) {
      history = {
        indexRows: payload.options.indexRows,
        builtAt: Date.now(),
        entries: [],
      };
    }
    history = mergeWikiHistoryFromSave(
      history,
      mergedRow,
      structure.rawHeaders,
      structure.uniqueHeaders,
      new Set(Object.keys(updates))
    );
    saveWikiHistory(history);
  }

  const statusUnique = rowPayload.columns.find((c) => c.isStatus)?.uniqueName;
  if (statusUnique && updates[statusUnique] !== undefined) {
    patchQueueIndex(payload.sheetRowNumber, updates[statusUnique], "");
  }

  // patch 反映後のキャッシュから最新キューを再計算（シート I/O なし）。
  // skipDone 有効時は完了行が除外されるため、次の行・前の行判定の単一の基準になる。
  const records = hasQueueIndex(payload.options.indexRows) ? loadQueueIndex() : null;
  const queueSheetRows = records
    ? filterQueueRows(records, payload.options)
    : payload.queueSheetRows;

  // 現在行より後ろの最初の行（=次の未完了行）。queueSheetRows は行番号昇順。
  const nextSheetRowNumber =
    queueSheetRows.find((r) => r > payload.sheetRowNumber) ?? null;

  return {
    savedCells: plan.length,
    nextSheetRowNumber,
    atEnd: nextSheetRowNumber === null,
    queueSheetRows,
  };
}

export async function refreshCache(): Promise<void> {
  clearCache();
  const structure = await loadSheetStructure();
  setStructure(structure);
}
