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
  fetchCandidateRowValues,
  fetchQueueIndex,
  fetchRowStatusAndAssignee,
  fetchRowStatuses,
  fetchRowValues,
  fetchWikiHistoryFromSheet,
  loadAssignDiscordNames,
  loadSheetStructure,
} from "./sheets";
import {
  cachedRowNumbers,
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
  patchWikiHistory,
  saveQueueIndex,
  saveRowValues,
  saveWikiHistory,
  setStructure,
  touchLastAccessAt,
  type QueueRecord,
} from "./store";
import {
  acquireSharedLock,
  releaseSharedLock,
  sharedCacheKey,
  sharedDelete,
  sharedGetJson,
  sharedHashGetAll,
  sharedHashSet,
  sharedSetJson,
  waitForSharedJson,
} from "./shared-cache";
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
  wikiHistoryEntryKey,
  type WikiHistoryEntry,
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
const pendingCacheBuilds = new Map<string, Promise<unknown>>();

async function singleFlight<T>(key: string, build: () => Promise<T>): Promise<T> {
  const pending = pendingCacheBuilds.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const promise = build().finally(() => pendingCacheBuilds.delete(key));
  pendingCacheBuilds.set(key, promise);
  return promise;
}

type SharedNavPatch = { status?: string; assignee?: string };

async function applySharedNavDelta(
  sheetId: string,
  records: QueueRecord[]
): Promise<QueueRecord[]> {
  const delta = await sharedHashGetAll<SharedNavPatch>(
    sharedCacheKey("nav", sheetId, "delta")
  );
  if (!Object.keys(delta).length) return records;
  return records.map((record) => {
    const patch = delta[String(record.sheetRowNumber)];
    return patch ? { ...record, ...patch } : record;
  });
}

async function applySharedWikiDelta(
  sheetId: string,
  index: WikiHistoryIndex
): Promise<WikiHistoryIndex> {
  const delta = await sharedHashGetAll<WikiHistoryEntry>(
    sharedCacheKey("wiki", sheetId, "delta")
  );
  if (!Object.keys(delta).length) return index;
  const entries = new Map(
    index.entries.map((entry) => [
      wikiHistoryEntryKey(entry.name, entry.wiki, entry.correctWiki),
      entry,
    ])
  );
  for (const [key, entry] of Object.entries(delta)) {
    const current = entries.get(key);
    entries.set(
      key,
      current && current.count > entry.count ? current : entry
    );
  }
  patchWikiHistory(sheetId, index.indexRows, Object.values(delta));
  return {
    ...index,
    entries: [...entries.values()].sort((a, b) => b.count - a.count),
  };
}

async function ensureStructure(sheet: SheetConfig): Promise<SheetStructure> {
  let structure = getStructure(sheet.id);
  if (structure) return structure;
  const key = sharedCacheKey("struct", sheet.id);
  return singleFlight(key, async () => {
    structure = await sharedGetJson<SheetStructure>(key);
    if (structure) {
      setStructure(sheet.id, structure);
      return structure;
    }
    const lock = await acquireSharedLock(key);
    if (lock === "") {
      structure = await waitForSharedJson<SheetStructure>(key);
      if (structure) {
        setStructure(sheet.id, structure);
        return structure;
      }
    }
    try {
      structure = await loadSheetStructure(sheet);
      setStructure(sheet.id, structure);
      await sharedSetJson(key, structure, 86_400);
      return structure;
    } finally {
      if (lock) await releaseSharedLock(key, lock);
    }
  });
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
    return applySharedNavDelta(sheet.id, loadQueueIndex(sheet.id));
  }
  const key = sharedCacheKey("nav", sheet.id, indexRows);
  return singleFlight(`${key}:${forceRefresh}`, async () => {
    if (!forceRefresh) {
      const shared = await sharedGetJson<QueueRecord[]>(key);
      if (shared?.length) {
        const merged = await applySharedNavDelta(sheet.id, shared);
        saveQueueIndex(sheet.id, merged, indexRows, false);
        return merged;
      }
    }
    const lock = await acquireSharedLock(key, 60_000);
    if (!forceRefresh && lock === "") {
      const shared = await waitForSharedJson<QueueRecord[]>(key, 8, 300);
      if (shared?.length) {
        const merged = await applySharedNavDelta(sheet.id, shared);
        saveQueueIndex(sheet.id, merged, indexRows, false);
        return merged;
      }
    }
    try {
      const structure = await ensureStructure(sheet);
      const rules = rulesFor(sheet, structure);
      const records = await fetchQueueIndex(sheet, rules, indexRows);
      saveQueueIndex(sheet.id, records, indexRows);
      await sharedDelete(sharedCacheKey("nav", sheet.id, "delta"));
      await sharedSetJson(key, records, 180);
      return records;
    } finally {
      if (lock) await releaseSharedLock(key, lock);
    }
  });
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
    return applySharedWikiDelta(sheet.id, getWikiHistory(sheet.id)!);
  }
  const key = sharedCacheKey("wiki", sheet.id, indexRows);
  return singleFlight(key, async () => {
    const shared = await sharedGetJson<WikiHistoryIndex>(key);
    if (shared?.indexRows === indexRows) {
      saveWikiHistory(sheet.id, shared);
      return applySharedWikiDelta(sheet.id, shared);
    }
    const lock = await acquireSharedLock(key, 120_000);
    if (lock === "") {
      const waited = await waitForSharedJson<WikiHistoryIndex>(key, 10, 500);
      if (waited?.indexRows === indexRows) {
        saveWikiHistory(sheet.id, waited);
        return applySharedWikiDelta(sheet.id, waited);
      }
    }
    try {
      const structure = await ensureStructure(sheet);
      const rules = rulesFor(sheet, structure);
      const raw = await fetchWikiHistoryFromSheet(sheet, rules, indexRows);
      const index = aggregateWikiHistory(raw, indexRows);
      saveWikiHistory(sheet.id, index);
      await sharedDelete(sharedCacheKey("wiki", sheet.id, "delta"));
      await sharedSetJson(key, index, 900);
      return index;
    } finally {
      if (lock) await releaseSharedLock(key, lock);
    }
  });
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

export async function getRowProbe(
  sheetId: string,
  sheetRowNumber: number
): Promise<RowProbePayload> {
  const sheet = getSheetById(sheetId) ?? DEFAULT_SHEET;
  const structure = await ensureStructure(sheet);
  const rules = rulesFor(sheet, structure);
  // 探索は読み取り専用: 判定に必要な Status / Assignee の2セルだけ取得し、
  // 巨大な nav キャッシュは書き換えない。
  const { status, assignee } = await fetchRowStatusAndAssignee(
    sheet,
    rules,
    sheetRowNumber
  );
  touchLastAccessAt(sheet.id);
  return { sheet: sheet.id, sheetRowNumber, status, assignee };
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
 * A: 候補行全体を Sheets の 1 回の batchGet で取得し、その応答内の Status で
 * スキップ判定して着地 payload を組み立てる。Status と着地行を直列取得しない。
 * 窓内に着地が無ければ landing=null（呼び出し側が次窓を要求 or refresh する）。
 */
export async function navigateToTarget(
  candidates: QueueEntry[],
  statusFilter: WorkOptions["statusFilter"],
  rowOpts: Pick<WorkOptions, "lightBlueOnly" | "fullEditMode" | "showNamedTriplets">
): Promise<NavigateResult> {
  const statuses: Record<string, string> = {};
  const filtered = statusFilter !== "all";
  // 「すべて」は先頭へ着地するだけなので、余分な候補行を取得しない。
  const requested = filtered ? candidates : candidates.slice(0, 1);
  const structures = new Map<string, SheetStructure>();
  for (const candidate of requested) {
    if (structures.has(candidate.sheet)) continue;
    const sheet = getSheetById(candidate.sheet);
    if (!sheet) continue;
    structures.set(candidate.sheet, await ensureStructure(sheet));
  }
  const prepared = requested.flatMap((candidate, requestedIndex) => {
    const sheet = getSheetById(candidate.sheet);
    const structure = structures.get(candidate.sheet);
    if (!sheet || !structure) return [];
    return [{ candidate, requestedIndex, sheet, structure, rules: rulesFor(sheet, structure) }];
  });
  const rowValuesByKey = await fetchCandidateRowValues(
    prepared.map(({ candidate, sheet, structure }) => ({
      sheet,
      structure,
      sheetRowNumber: candidate.row,
    }))
  );
  let landingIndex = -1;
  let landingPrepared: (typeof prepared)[number] | null = null;
  for (const item of prepared) {
    const { candidate, requestedIndex, rules } = item;
    const key = `${candidate.sheet}#${candidate.row}`;
    const rowValues = rowValuesByKey[key] ?? [];
    const rowMap = rowByUniqueFromValues(rules.uniqueHeaders, rowValues);
    const status = rules.statusUnique
      ? String(rowMap[rules.statusUnique] ?? "").trim()
      : "";
    statuses[key] = status;
    if (!shouldSkipStatus(status, statusFilter)) {
      landingIndex = requestedIndex;
      landingPrepared = item;
      break;
    }
  }

  if (landingIndex < 0 || !landingPrepared) {
    return { landing: null, landingIndex: -1, payload: null, statuses };
  }

  const { candidate: landing, sheet, rules } = landingPrepared;
  const landingValues = rowValuesByKey[`${landing.sheet}#${landing.row}`] ?? [];
  saveRowValues(sheet.id, landing.row, landingValues);
  touchLastAccessAt(sheet.id);
  const payload = buildRowPayload(
    rules,
    { id: sheet.id, label: sheet.label },
    rowByUniqueFromValues(rules.uniqueHeaders, landingValues),
    landing.row,
    rowOpts
  );
  return { landing, landingIndex, payload, statuses };
}

export async function getRow(
  sheetId: string,
  sheetRowNumber: number,
  options: Pick<WorkOptions, "lightBlueOnly" | "fullEditMode" | "showNamedTriplets">,
  forceFresh = false,
  // 背景の裏読み用: レート制限（429）時にリトライで粘らず即諦める。
  background = false
): Promise<RowPayload> {
  const sheet = getSheetById(sheetId) ?? DEFAULT_SHEET;
  const structure = await ensureStructure(sheet);
  const rules = rulesFor(sheet, structure);

  let rowValues = forceFresh ? null : getRowValues(sheet.id, sheetRowNumber);
  if (!rowValues) {
    const sharedKey = sharedCacheKey("row", sheet.id, sheetRowNumber);
    rowValues = forceFresh ? null : await sharedGetJson<string[]>(sharedKey);
    if (!rowValues) {
      rowValues = await fetchRowValues(sheet, structure, sheetRowNumber, {
        noRetry: background,
      });
      // 同一行の保存直後は、レスポンス後の旧共有キー削除と競合させない。
      if (!forceFresh) await sharedSetJson(sharedKey, rowValues, 60);
    }
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

export async function saveRow(
  payload: SavePayload,
  deferSharedWork?: (work: () => Promise<void>) => void
): Promise<SaveResult> {
  if (!ENABLE_SHEET_WRITES) {
    throw new Error("ENABLE_SHEET_WRITES=false のため書き込みできません。");
  }

  const sheet = getSheetById(payload.sheet) ?? DEFAULT_SHEET;
  const structure = await ensureStructure(sheet);
  const rules = rulesFor(sheet, structure);
  // 移行中に古い画面から保存されても動作するよう、旧 options も一時的に受理する。
  const legacyOptions = (
    payload as SavePayload & { options?: Pick<WorkOptions, "fullEditMode" | "indexRows"> }
  ).options;
  const fullEditMode = payload.fullEditMode ?? legacyOptions?.fullEditMode ?? false;
  const indexRows = payload.indexRows ?? legacyOptions?.indexRows ?? DEFAULT_INDEX_ROWS;
  // クライアントは変更セルだけを送る。キーは列ルールで再検証するため、
  // 保存前に行全体を getRow して表示列を復元する必要はない。
  const updates = collectEditableUpdates(
    rules,
    payload.edits,
    Object.keys(payload.edits),
    fullEditMode
  );

  const plan = buildWritePlan(rules, payload.sheetRowNumber, updates, fullEditMode);

  if (!plan.length) {
    throw new Error("書き込み対象セルがありません。");
  }

  await executeWritePlan(sheet, plan);
  patchRowValues(sheet.id, payload.sheetRowNumber, rules.uniqueHeaders, updates);

  // Wiki候補学習は、行表示時に作成した全三つ組の小さなスナップショットへ
  // 今回の更新値を重ねて行う。Sheetsから行全体を読み直さない。
  const learning = payload.wikiLearning ?? [];
  const editedNames = new Set(Object.keys(updates));
  const validCorrect = new Set(
    rules.triplets
      .map((triplet) => rules.headerMap[triplet.ok])
      .filter((unique): unique is string => Boolean(unique))
  );
  const shouldLearnWiki =
    (rules.statusUnique ? editedNames.has(rules.statusUnique) : false) ||
    [...validCorrect].some((unique) => editedNames.has(unique));
  let learnedEntries: WikiHistoryEntry[] = [];
  if (learning.length && shouldLearnWiki) {
    const mergedRow: Record<string, string> = {};
    for (const item of learning) {
      if (!validCorrect.has(item.correctUniqueName)) continue;
      mergedRow[item.nameUniqueName] =
        updates[item.nameUniqueName] ?? String(item.name ?? "");
      mergedRow[item.wikiUniqueName] =
        updates[item.wikiUniqueName] ?? String(item.wiki ?? "");
      mergedRow[item.correctUniqueName] =
        updates[item.correctUniqueName] ?? String(item.correctWiki ?? "");
      if (item.deweyUniqueName) {
        const editedDewey = updates[item.deweyUniqueName];
        mergedRow[item.deweyUniqueName] =
          editedDewey !== undefined
            ? editedDewey
            : item.deweyHasValue
              ? "1"
              : "";
      }
    }
    if (rules.statusUnique) {
      mergedRow[rules.statusUnique] = updates[rules.statusUnique] ?? "";
    }
    let history = getWikiHistory(sheet.id);
    if (!history || history.indexRows !== indexRows) {
      history = {
        indexRows,
        builtAt: Date.now(),
        entries: [],
      };
      saveWikiHistory(sheet.id, history);
    }
    const countsBefore = new Map(
      history.entries.map((entry) => [
        `${entry.name}\0${entry.wiki}\0${entry.correctWiki}`,
        entry.count,
      ])
    );
    const mergedHistory = mergeWikiHistoryFromSave(
      history,
      rules,
      mergedRow,
      editedNames
    );
    const changedEntries = mergedHistory.entries.filter(
      (entry) =>
        countsBefore.get(`${entry.name}\0${entry.wiki}\0${entry.correctWiki}`) !==
        entry.count
    );
    learnedEntries = changedEntries;
    patchWikiHistory(sheet.id, indexRows, changedEntries);
  }

  const statusUnique = rules.statusUnique;
  let status: string | undefined;
  if (statusUnique && updates[statusUnique] !== undefined) {
    status = updates[statusUnique];
    patchQueueIndex(sheet.id, payload.sheetRowNumber, status, "");
  }

  const syncSharedCache = async () => {
    const sharedWrites: Promise<void>[] = [
      sharedDelete(sharedCacheKey("row", sheet.id, payload.sheetRowNumber)),
    ];
    if (status !== undefined) {
      sharedWrites.push(
        sharedHashSet(sharedCacheKey("nav", sheet.id, "delta"), {
          [String(payload.sheetRowNumber)]: { status },
        })
      );
    }
    if (learnedEntries.length) {
      sharedWrites.push(
        sharedHashSet(
          sharedCacheKey("wiki", sheet.id, "delta"),
          Object.fromEntries(
            learnedEntries.map((entry) => [
              wikiHistoryEntryKey(entry.name, entry.wiki, entry.correctWiki),
              entry,
            ])
          )
        )
      );
    }
    await Promise.all(sharedWrites);
  };
  if (deferSharedWork) deferSharedWork(syncSharedCache);
  else await syncSharedCache();

  return { savedCells: plan.length, status };
}

export async function refreshCache(): Promise<void> {
  clearAllCaches();
  rulesCache.clear();
  await sharedDelete(
    ...WORK_SHEETS.flatMap((sheet) => [
      sharedCacheKey("struct", sheet.id),
      sharedCacheKey("nav", sheet.id, DEFAULT_INDEX_ROWS),
      sharedCacheKey("nav", sheet.id, "delta"),
      sharedCacheKey("wiki", sheet.id, DEFAULT_INDEX_ROWS),
      sharedCacheKey("wiki", sheet.id, "delta"),
    ])
  );
  for (const sheet of WORK_SHEETS) {
    const structure = await loadSheetStructure(sheet);
    setStructure(sheet.id, structure);
    await sharedSetJson(sharedCacheKey("struct", sheet.id), structure, 86_400);
  }
}

/** ナビ（キュー）用キャッシュのみ再構築（構造 + キュー index。次回キュー構築で作り直す）。 */
export async function rebuildNavCache(): Promise<void> {
  rulesCache.clear();
  await sharedDelete(
    ...WORK_SHEETS.flatMap((sheet) => [
      sharedCacheKey("struct", sheet.id),
      sharedCacheKey("nav", sheet.id, DEFAULT_INDEX_ROWS),
      sharedCacheKey("nav", sheet.id, "delta"),
    ])
  );
  for (const sheet of WORK_SHEETS) {
    clearNavCache(sheet.id);
    const structure = await loadSheetStructure(sheet);
    setStructure(sheet.id, structure);
    await sharedSetJson(sharedCacheKey("struct", sheet.id), structure, 86_400);
  }
}

/** 作業用キャッシュ（行データ）のみ破棄。行を開くと個別に再取得する。 */
export async function clearRowsCacheAll(): Promise<void> {
  const sharedKeys: string[] = [];
  for (const sheet of WORK_SHEETS) {
    for (const row of cachedRowNumbers(sheet.id)) {
      sharedKeys.push(sharedCacheKey("row", sheet.id, row));
    }
    clearRowsCache(sheet.id);
  }
  await sharedDelete(...sharedKeys);
}

/** 候補用キャッシュ（正しいwiki 候補学習）のみ破棄。次回候補表示で作り直す。 */
export async function clearWikiCacheAll(): Promise<void> {
  for (const sheet of WORK_SHEETS) clearWikiCache(sheet.id);
  await sharedDelete(
    ...WORK_SHEETS.map((sheet) =>
      sharedCacheKey("wiki", sheet.id, DEFAULT_INDEX_ROWS)
    ),
    ...WORK_SHEETS.map((sheet) => sharedCacheKey("wiki", sheet.id, "delta"))
  );
}

export type CacheTarget = "all" | "nav" | "rows" | "wiki";

/** 用途別にキャッシュをクリア/再構築する。 */
export async function clearCacheByTarget(target: CacheTarget): Promise<void> {
  switch (target) {
    case "nav":
      await rebuildNavCache();
      return;
    case "rows":
      await clearRowsCacheAll();
      return;
    case "wiki":
      await clearWikiCacheAll();
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
