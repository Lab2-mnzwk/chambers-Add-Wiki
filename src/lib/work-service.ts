import {
  ASSIGN_ALL_ROWS_NAME,
  ASSIGN_NAME_EXCLUDE,
  DEFAULT_INDEX_ROWS,
  DEFAULT_SHEET,
  ENABLE_SHEET_WRITES,
  getSheetById,
  IDLE_CACHE_CLEAR_MS,
  SPREADSHEET_DISPLAY_TITLE,
  WORK_SHEETS,
  WORK_STATUS_OPTIONS,
  workSheetEditUrl,
  type SheetConfig,
} from "./config";
import { auth, isOAuthConfigured } from "@/auth";
import { isCredentialError, isPermissionError, PERMISSION_MESSAGE } from "./api-error";
import {
  buildRowPayload,
  buildWritePlan,
  collectEditableUpdates,
  filterQueueRows,
  rowByUniqueFromValues,
} from "./columns";
import { buildSheetRules } from "./sheet-rules";
import {
  executeWritePlan,
  fetchQueueIndex,
  fetchRowStatus,
  fetchRowValues,
  fetchWikiHistoryFromSheet,
  loadAssignDiscordNames,
  loadSheetStructure,
} from "./sheets";
import {
  cacheStats as storeCacheStats,
  clearAllCaches,
  getLastAccessAt,
  getRowValues,
  getStructure,
  getWikiHistory,
  hasQueueIndex,
  hasWikiHistory,
  loadQueueIndex,
  patchRowValues,
  saveQueueIndex,
  saveWikiHistory,
  setStructure,
  touchLastAccessAt,
  withBundle,
} from "./store";
import type {
  BootstrapPayload,
  QueueEntry,
  RowPayload,
  RowProbePayload,
  SavePayload,
  SaveResult,
  SheetRules,
  SheetStructure,
  WorkOptions,
} from "./types";
import {
  aggregateWikiHistory,
  combineWikiHistories,
  mergeWikiHistoryFromSave,
  suggestWikiHistory,
  type WikiHistoryIndex,
  type WikiHistorySuggestion,
} from "./wiki-history";

/**
 * アクセスが IDLE_CACHE_CLEAR_MS 以上空いていたら全シートのキャッシュをクリアする。
 * 直後の ensureStructure / getQueue / getRow / ensureWikiHistory がシートから作り直す。
 */
function clearCacheIfIdle(now: number = Date.now()): void {
  let latest: number | null = null;
  for (const sheet of WORK_SHEETS) {
    const t = getLastAccessAt(sheet.id);
    if (t !== null) latest = latest === null ? t : Math.max(latest, t);
  }
  if (latest !== null && now - latest >= IDLE_CACHE_CLEAR_MS) {
    clearAllCaches();
    rulesCache.clear();
  }
}

/** シートごとの SheetRules（structure 不変の間は再利用）。 */
const rulesCache = new Map<string, SheetRules>();

async function ensureStructure(sheet: SheetConfig): Promise<SheetStructure> {
  let structure = getStructure(sheet.id);
  if (!structure) {
    structure = await loadSheetStructure(sheet);
    setStructure(sheet.id, structure);
  }
  return structure;
}

function rulesFor(sheet: SheetConfig, structure: SheetStructure): SheetRules {
  const key = structure.rawHeaders.join("\0");
  const cached = rulesCache.get(sheet.id);
  if (cached && cached.rawHeaders.join("\0") === key) return cached;
  const rules = buildSheetRules(structure, sheet.assigneeHeader);
  rulesCache.set(sheet.id, rules);
  return rules;
}

async function ensureQueueIndex(
  sheet: SheetConfig,
  indexRows: number,
  forceRefresh: boolean
) {
  if (!forceRefresh && hasQueueIndex(sheet.id, indexRows)) {
    return loadQueueIndex(sheet.id);
  }
  const structure = await ensureStructure(sheet);
  const rules = rulesFor(sheet, structure);
  const records = await fetchQueueIndex(sheet, rules, indexRows);
  saveQueueIndex(sheet.id, records, indexRows);
  return records;
}

/**
 * 各作業シートの Assignee 列に実在する担当名のうち、既知（アサインシート由来）に
 * 無いものを収集する。キュー index（担当列を含む）をシートから取得済みならそれを使う。
 */
async function collectExtraAssignees(
  indexRows: number,
  known: Set<string>
): Promise<string[]> {
  const seen = new Set(known);
  const excluded = new Set(ASSIGN_NAME_EXCLUDE);
  const extras: string[] = [];
  for (const sheet of WORK_SHEETS) {
    const records = await ensureQueueIndex(sheet, indexRows, false);
    for (const r of records) {
      const name = r.assignee.trim();
      if (!name || seen.has(name) || excluded.has(name)) continue;
      if (name === ASSIGN_ALL_ROWS_NAME) continue;
      seen.add(name);
      extras.push(name);
    }
  }
  return extras;
}

async function ensureWikiHistory(
  sheet: SheetConfig,
  indexRows: number
): Promise<WikiHistoryIndex> {
  if (hasWikiHistory(sheet.id, indexRows)) {
    return getWikiHistory(sheet.id)!;
  }
  const structure = await ensureStructure(sheet);
  const rules = rulesFor(sheet, structure);
  const raw = await fetchWikiHistoryFromSheet(sheet, rules, indexRows);
  const index = aggregateWikiHistory(raw, indexRows);
  saveWikiHistory(sheet.id, index);
  return index;
}

export async function getWikiHistorySuggestions(
  name: string,
  wiki: string,
  query: string,
  indexRows: number
): Promise<WikiHistorySuggestion[]> {
  const indexes: WikiHistoryIndex[] = [];
  for (const sheet of WORK_SHEETS) {
    indexes.push(await ensureWikiHistory(sheet, indexRows));
  }
  const combined = combineWikiHistories(indexes);
  return suggestWikiHistory(combined, name, wiki, query);
}

export async function getBootstrap(): Promise<BootstrapPayload> {
  const oauth = isOAuthConfigured();
  const session = oauth ? await auth() : null;
  const sheets = WORK_SHEETS.map((s) => ({ id: s.id, label: s.label, name: s.name }));

  const authRequiredPayload = (authMessage?: string): BootstrapPayload => ({
    authMode: "oauth",
    authRequired: true,
    authMessage,
    userEmail: session?.user?.email ?? null,
    spreadsheetTitle: SPREADSHEET_DISPLAY_TITLE,
    sheets,
    sheetUrl: workSheetEditUrl(),
    discordNames: [],
    extraAssignees: [],
    statusOptions: [...WORK_STATUS_OPTIONS],
    defaultIndexRows: DEFAULT_INDEX_ROWS,
    enableWrites: ENABLE_SHEET_WRITES,
  });

  if (oauth && (!session?.user || session.error)) {
    return authRequiredPayload();
  }

  try {
    clearCacheIfIdle();
    for (const sheet of WORK_SHEETS) await ensureStructure(sheet);
    const discordNames = await loadAssignDiscordNames();
    // アサインシートに無いが作業シートの Assignee 列に実在する担当名を追加。
    // シート間で表記が違う担当（例: 「けにち」/「mnmzwkenichi」）でも、
    // 実在名を選べば該当シートの担当行を拾える。
    const extraAssignees = await collectExtraAssignees(
      DEFAULT_INDEX_ROWS,
      new Set(discordNames)
    );
    for (const sheet of WORK_SHEETS) touchLastAccessAt(sheet.id);
    return {
      authMode: oauth ? "oauth" : "service_account",
      authRequired: false,
      userEmail: session?.user?.email ?? null,
      spreadsheetTitle: SPREADSHEET_DISPLAY_TITLE,
      sheets,
      sheetUrl: workSheetEditUrl(),
      discordNames,
      extraAssignees,
      statusOptions: [...WORK_STATUS_OPTIONS],
      defaultIndexRows: DEFAULT_INDEX_ROWS,
      enableWrites: ENABLE_SHEET_WRITES,
    };
  } catch (e) {
    if (oauth && isCredentialError(e)) {
      return authRequiredPayload();
    }
    if (oauth && isPermissionError(e)) {
      return authRequiredPayload(PERMISSION_MESSAGE);
    }
    throw e;
  }
}

/** 全シートを通した統合キュー（第一二弾 → 第三弾の順）。 */
export async function getQueue(
  options: WorkOptions,
  forceRefresh = false,
  refreshSheets?: string[]
): Promise<QueueEntry[]> {
  const result: QueueEntry[] = [];
  for (const sheet of WORK_SHEETS) {
    const doRefresh =
      forceRefresh &&
      (!refreshSheets?.length || refreshSheets.includes(sheet.id));
    touchLastAccessAt(sheet.id);
    const records = await ensureQueueIndex(sheet, options.indexRows, doRefresh);
    const rows = filterQueueRows(records, options);
    for (const row of rows) result.push({ sheet: sheet.id, row });
  }
  return result;
}

/** 保存後、キャッシュ済みの index から統合キューを再計算（シート I/O なし）。 */
function recomputeQueueAfterSave(
  options: WorkOptions,
  clientQueue: QueueEntry[]
): QueueEntry[] {
  const result: QueueEntry[] = [];
  for (const sheet of WORK_SHEETS) {
    if (hasQueueIndex(sheet.id, options.indexRows)) {
      const rows = filterQueueRows(loadQueueIndex(sheet.id), options);
      for (const row of rows) result.push({ sheet: sheet.id, row });
    } else {
      // index 未構築のシートはクライアントのキューをそのまま残す。
      for (const e of clientQueue) if (e.sheet === sheet.id) result.push(e);
    }
  }
  return result;
}

export async function getRowProbe(
  sheetId: string,
  sheetRowNumber: number
): Promise<RowProbePayload> {
  const sheet = getSheetById(sheetId) ?? DEFAULT_SHEET;
  const structure = await ensureStructure(sheet);
  const rules = rulesFor(sheet, structure);
  const status = await fetchRowStatus(sheet, rules, sheetRowNumber);

  withBundle(sheet.id, (bundle) => {
    bundle.lastAccessAt = Date.now();
    if (status) {
      const row = bundle.queueIndex.find(
        (r) => r.sheetRowNumber === sheetRowNumber
      );
      if (row) row.status = status;
    }
  });

  return { sheet: sheet.id, sheetRowNumber, status };
}

export async function getRow(
  sheetId: string,
  sheetRowNumber: number,
  options: Pick<WorkOptions, "lightBlueOnly" | "fullEditMode" | "showNamedTriplets">
): Promise<RowPayload> {
  const sheet = getSheetById(sheetId) ?? DEFAULT_SHEET;
  const structure = await ensureStructure(sheet);
  const rules = rulesFor(sheet, structure);

  let rowValues = getRowValues(sheet.id, sheetRowNumber);
  if (!rowValues) {
    rowValues = await fetchRowValues(sheet, structure, sheetRowNumber);
  }

  const rowByUnique = rowByUniqueFromValues(rules.uniqueHeaders, rowValues);
  const payload = buildRowPayload(
    rules,
    { id: sheet.id, label: sheet.label },
    rowByUnique,
    sheetRowNumber,
    options
  );

  const statusValue = payload.columns.find((c) => c.isStatus)?.value ?? "";

  withBundle(sheet.id, (bundle) => {
    bundle.lastAccessAt = Date.now();
    bundle.rows[String(sheetRowNumber)] = rowValues;
    if (statusValue) {
      const row = bundle.queueIndex.find(
        (r) => r.sheetRowNumber === sheetRowNumber
      );
      if (row) row.status = statusValue;
    }
  });

  return payload;
}

export async function saveRow(payload: SavePayload): Promise<SaveResult> {
  if (!ENABLE_SHEET_WRITES) {
    throw new Error("ENABLE_SHEET_WRITES=false のため書き込みできません。");
  }

  const sheet = getSheetById(payload.sheet) ?? DEFAULT_SHEET;
  const structure = await ensureStructure(sheet);
  const rules = rulesFor(sheet, structure);
  const rowPayload = await getRow(sheet.id, payload.sheetRowNumber, payload.options);
  const workColNames = rowPayload.columns.map((c) => c.uniqueName);

  const fullEditMode = payload.options.fullEditMode === true;
  const updates = collectEditableUpdates(
    rules,
    payload.edits,
    workColNames,
    fullEditMode
  );

  const plan = buildWritePlan(rules, payload.sheetRowNumber, updates, fullEditMode);

  if (!plan.length) {
    throw new Error("書き込み対象セルがありません。");
  }

  await executeWritePlan(sheet, plan);
  patchRowValues(sheet.id, payload.sheetRowNumber, rules.uniqueHeaders, updates);

  const updatedValues = getRowValues(sheet.id, payload.sheetRowNumber);
  if (updatedValues) {
    const mergedRow = rowByUniqueFromValues(rules.uniqueHeaders, updatedValues);
    let history = getWikiHistory(sheet.id);
    if (!history || history.indexRows !== payload.options.indexRows) {
      history = {
        indexRows: payload.options.indexRows,
        builtAt: Date.now(),
        entries: [],
      };
    }
    history = mergeWikiHistoryFromSave(
      history,
      rules,
      mergedRow,
      new Set(Object.keys(updates))
    );
    saveWikiHistory(sheet.id, history);
  }

  const statusUnique = rowPayload.columns.find((c) => c.isStatus)?.uniqueName;
  if (statusUnique && updates[statusUnique] !== undefined) {
    withBundle(sheet.id, (bundle) => {
      const row = bundle.queueIndex.find(
        (r) => r.sheetRowNumber === payload.sheetRowNumber
      );
      if (row) row.status = updates[statusUnique];
    });
  }

  const queue = recomputeQueueAfterSave(payload.options, payload.queue);

  return { savedCells: plan.length, queue };
}

export async function refreshCache(): Promise<void> {
  clearAllCaches();
  rulesCache.clear();
  for (const sheet of WORK_SHEETS) {
    const structure = await loadSheetStructure(sheet);
    setStructure(sheet.id, structure);
  }
}

export function cacheStats(): {
  indexRowsCached: number;
  dataRowsCached: number;
  wikiHistoryEntries: number;
} {
  let indexRowsCached = 0;
  let dataRowsCached = 0;
  let wikiHistoryEntries = 0;
  for (const sheet of WORK_SHEETS) {
    const s = storeCacheStats(sheet.id);
    indexRowsCached += s.indexRowsCached;
    dataRowsCached += s.dataRowsCached;
    wikiHistoryEntries += s.wikiHistoryEntries;
  }
  return { indexRowsCached, dataRowsCached, wikiHistoryEntries };
}
