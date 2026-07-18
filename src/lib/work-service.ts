import {
  ASSIGN_ALL_ROWS_NAME,
  ASSIGN_NAME_EXCLUDE,
  DEFAULT_INDEX_ROWS,
  DEFAULT_SHEET,
  ENABLE_SHEET_WRITES,
  getSheetById,
  IDLE_CACHE_CLEAR_MS,
  isDoneStatus,
  SPREADSHEET_DISPLAY_TITLE,
  STATUS_NOT_STARTED,
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
  fetchRowStatuses,
  fetchRowValues,
  fetchWikiHistoryFromSheet,
  loadAssignDiscordNames,
  loadSheetStructure,
} from "./sheets";
import {
  cacheStats as storeCacheStats,
  clearAllCaches,
  clearNavCache,
  clearRowsCache,
  clearWikiCache,
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
  NavigateResult,
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
  // 探索は読み取り専用: 作業 Status の 1 セルのみ取得し、巨大な nav キャッシュは書き換えない。
  const status = await fetchRowStatus(sheet, rules, sheetRowNumber);
  touchLastAccessAt(sheet.id);
  return { sheet: sheet.id, sheetRowNumber, status };
}

/**
 * 複数行の作業 Status をまとめて返す（移動探索の先読み）。
 * B: 行データがキャッシュ済みの行は API を使わずキャッシュから status を求め、
 *    未キャッシュの行だけを 1 リクエスト（batchGet）で取得する。
 */
export async function getRowStatuses(
  sheetId: string,
  rowNumbers: number[]
): Promise<{ sheet: string; statuses: Record<number, string> }> {
  const sheet = getSheetById(sheetId) ?? DEFAULT_SHEET;
  const structure = await ensureStructure(sheet);
  const rules = rulesFor(sheet, structure);
  const statusUnique = rules.statusUnique;

  const statuses: Record<number, string> = {};
  const uncached: number[] = [];
  for (const row of rowNumbers) {
    const cached = statusUnique ? getRowValues(sheet.id, row) : null;
    if (cached) {
      const map = rowByUniqueFromValues(rules.uniqueHeaders, cached);
      statuses[row] = String(map[statusUnique!] ?? "").trim();
    } else {
      uncached.push(row);
    }
  }
  if (uncached.length) {
    Object.assign(statuses, await fetchRowStatuses(sheet, rules, uncached));
  }
  touchLastAccessAt(sheet.id);
  return { sheet: sheet.id, statuses };
}

/** 進捗フィルタで、この Status の行を移動時にスキップすべきか（クライアントと同一判定）。 */
function shouldSkipStatus(
  status: string,
  statusFilter: WorkOptions["statusFilter"]
): boolean {
  if (statusFilter === "incomplete") return isDoneStatus(status);
  if (statusFilter === "notStarted") return status.trim() !== STATUS_NOT_STARTED;
  return false;
}

/**
 * A: 移動探索の集約。候補（travel 方向に並んだ行）を順に走査し、進捗フィルタで
 * スキップすべき行を飛ばして **最初の着地行を1リクエストで確定し、その全データも返す**。
 * status はキャッシュ優先 + シートごと1回の batchGet で取得（Sheets 往復を最小化）。
 * 窓内に着地が無ければ landing=null（呼び出し側が次窓を要求 or refresh する）。
 */
export async function navigateToTarget(
  candidates: QueueEntry[],
  statusFilter: WorkOptions["statusFilter"],
  rowOpts: Pick<WorkOptions, "lightBlueOnly" | "fullEditMode" | "showNamedTriplets">
): Promise<NavigateResult> {
  const statuses: Record<string, string> = {};
  const filtered = statusFilter !== "all";

  if (filtered && candidates.length) {
    const bySheet = new Map<string, number[]>();
    for (const c of candidates) {
      const list = bySheet.get(c.sheet) ?? [];
      list.push(c.row);
      bySheet.set(c.sheet, list);
    }
    for (const [sheet, rows] of bySheet) {
      const { statuses: st } = await getRowStatuses(sheet, rows);
      for (const [row, s] of Object.entries(st)) statuses[`${sheet}#${row}`] = s;
    }
  }

  let landingIndex = -1;
  for (let i = 0; i < candidates.length; i++) {
    if (!filtered) {
      landingIndex = i;
      break;
    }
    const c = candidates[i];
    const status = statuses[`${c.sheet}#${c.row}`] ?? "";
    if (!shouldSkipStatus(status, statusFilter)) {
      landingIndex = i;
      break;
    }
  }

  if (landingIndex < 0) {
    return { landing: null, landingIndex: -1, payload: null, statuses };
  }

  const landing = candidates[landingIndex];
  const payload = await getRow(landing.sheet, landing.row, rowOpts);
  return { landing, landingIndex, payload, statuses };
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
    // 作業用キャッシュ（rows）にその行だけ書く。nav/wiki は触らない。
    saveRowValues(sheet.id, sheetRowNumber, rowValues);
  }
  touchLastAccessAt(sheet.id);

  const rowByUnique = rowByUniqueFromValues(rules.uniqueHeaders, rowValues);
  return buildRowPayload(
    rules,
    { id: sheet.id, label: sheet.label },
    rowByUnique,
    sheetRowNumber,
    options
  );
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
    patchQueueIndex(sheet.id, payload.sheetRowNumber, updates[statusUnique], "");
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

/** ナビ（キュー）用キャッシュのみ再構築（構造 + キュー index。次回キュー構築で作り直す）。 */
export async function rebuildNavCache(): Promise<void> {
  rulesCache.clear();
  for (const sheet of WORK_SHEETS) {
    clearNavCache(sheet.id);
    const structure = await loadSheetStructure(sheet);
    setStructure(sheet.id, structure);
  }
}

/** 作業用キャッシュ（行データ）のみ破棄。行を開くと個別に再取得する。 */
export function clearRowsCacheAll(): void {
  for (const sheet of WORK_SHEETS) clearRowsCache(sheet.id);
}

/** 候補用キャッシュ（正しいwiki 候補学習）のみ破棄。次回候補表示で作り直す。 */
export function clearWikiCacheAll(): void {
  for (const sheet of WORK_SHEETS) clearWikiCache(sheet.id);
}

export type CacheTarget = "all" | "nav" | "rows" | "wiki";

/** 用途別にキャッシュをクリア/再構築する。 */
export async function clearCacheByTarget(target: CacheTarget): Promise<void> {
  switch (target) {
    case "nav":
      await rebuildNavCache();
      return;
    case "rows":
      clearRowsCacheAll();
      return;
    case "wiki":
      clearWikiCacheAll();
      return;
    default:
      await refreshCache();
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
