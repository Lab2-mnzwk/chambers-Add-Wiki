import {
  ASSIGN_ALL_ROWS_NAME,
  COL_ASSIGNEE,
  COL_STATUS_WORK,
  FULL_EDIT_COLUMN_RANGES,
  FULL_EDIT_DISPLAY_RANGE,
  FULL_EDIT_HIDDEN_RANGES,
  LEADING_FIXED_HEADERS,
  LIGHT_BLUE_WORK_HEADERS,
  MEMO_SECTION_BY_HEADER,
  MEMO_WORK_HEADERS,
  STATUS_DONE,
  STATUS_NOT_STARTED,
  WIKI_TRIPLET_RULES,
  WORK_STATUS_COL_LETTER,
  WORK_ASSIGNEE_COL_LETTER,
  WORK_STATUS_OPTIONS,
  WORK_TABLE_START_HEADER,
  WRITE_DENYLIST_COL_LETTERS,
} from "./config";

import type { ColumnPayload, WorkOptions } from "./types";

const LEADING = LEADING_FIXED_HEADERS;
const WIKI_NAME_HEADERS = new Set(WIKI_TRIPLET_RULES.map(([name]) => name));

const FULL_EDIT_DISPLAY_BOUNDS: [number, number] = [
  columnIndexFromLetter(FULL_EDIT_DISPLAY_RANGE[0]),
  columnIndexFromLetter(FULL_EDIT_DISPLAY_RANGE[1]),
];
const FULL_EDIT_BOUNDS: [number, number][] = FULL_EDIT_COLUMN_RANGES.map(
  ([from, to]) => [columnIndexFromLetter(from), columnIndexFromLetter(to)]
);
const FULL_EDIT_HIDDEN_BOUNDS: [number, number][] = FULL_EDIT_HIDDEN_RANGES.map(
  ([from, to]) => [columnIndexFromLetter(from), columnIndexFromLetter(to)]
);

/** 全列表示モードで明示的に非表示とする列か */
export function isFullHiddenColIndex(colIndex: number): boolean {
  return FULL_EDIT_HIDDEN_BOUNDS.some(([a, b]) => colIndex >= a && colIndex <= b);
}

/** 全列表示モードで表示対象とする列か（AN〜FT、ただし除外範囲を除く） */
export function isFullDisplayColIndex(colIndex: number): boolean {
  return (
    colIndex >= FULL_EDIT_DISPLAY_BOUNDS[0] &&
    colIndex <= FULL_EDIT_DISPLAY_BOUNDS[1] &&
    !isFullHiddenColIndex(colIndex)
  );
}

/** 全列編集モードで自由入力編集を許可する列か（AN〜FD, FJ〜FT） */
export function isFullEditableColIndex(colIndex: number): boolean {
  return FULL_EDIT_BOUNDS.some(([a, b]) => colIndex >= a && colIndex <= b);
}

export function columnLetter(colIndex: number): string {
  let letter = "";
  let n = colIndex;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

export function columnIndexFromLetter(letter: string): number {
  let n = 0;
  for (const ch of letter) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

export function isCellEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return String(value).trim() === "";
}

export function normalizeWorkStatus(value: unknown): string {
  const val = String(value ?? "").trim();
  if (!val) return STATUS_NOT_STARTED;
  if ((WORK_STATUS_OPTIONS as readonly string[]).includes(val)) return val;
  return STATUS_NOT_STARTED;
}

export function isWikiDash(value: unknown): boolean {
  return String(value).trim() === "-";
}

/** 前後空白を除いた文字列が http(s) URL か */
export function isHttpUrl(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

export function hasDisplayWikiValue(value: unknown): boolean {
  return !isCellEmpty(value) && !isWikiDash(value);
}

export function isMemoWorkColumn(rawHeader: string): boolean {
  return (
    (MEMO_WORK_HEADERS as readonly string[]).includes(rawHeader) ||
    rawHeader.endsWith("_memo")
  );
}

export function isWorkStatusColumn(rawHeader: string, colIndex: number): boolean {
  return columnLetter(colIndex) === WORK_STATUS_COL_LETTER && rawHeader === "Status";
}

export function isCorrectWikiHeader(rawHeader: string): boolean {
  return rawHeader.includes("正しいwiki");
}

/** Wiki 三つ組の名称列（A_name1, Pl_name1 等） */
export function isWikiNameHeader(rawHeader: string): boolean {
  return WIKI_NAME_HEADERS.has(rawHeader);
}

export function isLightBlueWorkColumn(rawHeader: string, colIndex: number): boolean {
  const letter = columnLetter(colIndex);
  if (letter === WORK_STATUS_COL_LETTER && rawHeader === "Status") return true;
  if (letter === WORK_ASSIGNEE_COL_LETTER && rawHeader === COL_ASSIGNEE) return true;
  return LIGHT_BLUE_WORK_HEADERS.has(rawHeader);
}

export function isWritableColumn(
  rawHeader: string,
  colIndex: number,
  fullEditMode = false
): boolean {
  const letter = columnLetter(colIndex);
  if (WRITE_DENYLIST_COL_LETTERS.has(letter)) return false;
  if (isWorkStatusColumn(rawHeader, colIndex)) return true;
  if (fullEditMode && isFullEditableColIndex(colIndex)) return true;
  return LIGHT_BLUE_WORK_HEADERS.has(rawHeader) || rawHeader === COL_ASSIGNEE;
}

export function isInlineEditableColumn(
  uniqueName: string,
  rawHeader: string,
  colIndex: number,
  fullEditMode = false
): boolean {
  if (isWorkStatusColumn(rawHeader, colIndex)) return true;
  if (isMemoWorkColumn(rawHeader) || isCorrectWikiHeader(rawHeader)) {
    return isWritableColumn(rawHeader, colIndex, fullEditMode);
  }
  if (
    fullEditMode &&
    isFullEditableColIndex(colIndex) &&
    isWritableColumn(rawHeader, colIndex, fullEditMode)
  ) {
    return true;
  }
  return false;
}

export function isWikiStyleHeader(header: string): boolean {
  return LIGHT_BLUE_WORK_HEADERS.has(header);
}

export function makeUniqueHeaders(headers: string[]): string[] {
  const seen: Record<string, number> = {};
  const unique: string[] = [];
  for (const header of headers) {
    const name = header || "(空列名)";
    if (!(name in seen)) {
      seen[name] = 0;
      unique.push(name);
      continue;
    }
    seen[name] += 1;
    unique.push(`${name}.${seen[name]}`);
  }
  return unique;
}

export function resolveHeaderToUnique(
  rawHeaders: string[],
  uniqueHeaders: string[]
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (let i = 0; i < rawHeaders.length; i++) {
    const raw = rawHeaders[i];
    if (!(raw in mapping)) mapping[raw] = uniqueHeaders[i];
  }
  return mapping;
}

/** 正しいwiki 列に対応する name / wiki の現在値 */
export function tripletValuesForOkHeader(
  okRawHeader: string,
  rowByUnique: Record<string, string>,
  rawHeaders: string[],
  uniqueHeaders: string[]
): { name: string; wiki: string } | null {
  const headerMap = resolveHeaderToUnique(rawHeaders, uniqueHeaders);
  for (const [nameHeader, wikiHeader, okHeader] of WIKI_TRIPLET_RULES) {
    if (okHeader !== okRawHeader) continue;
    const nameUnique = headerMap[nameHeader];
    const wikiUnique = headerMap[wikiHeader];
    if (!nameUnique || !wikiUnique) return null;
    return {
      name: String(rowByUnique[nameUnique] ?? "").trim(),
      wiki: String(rowByUnique[wikiUnique] ?? "").trim(),
    };
  }
  return null;
}

export function sectionForWorkRawHeader(rawHeader: string): string | null {
  if (rawHeader.startsWith("Pl_")) return "Place";
  if (rawHeader.startsWith("P-T_")) return "Patient-Theme";
  if (rawHeader.startsWith("Te_")) return "Territory";
  if (
    rawHeader.startsWith("A_name") ||
    rawHeader.startsWith("A_Wiki") ||
    rawHeader.startsWith("A_正しいwiki") ||
    rawHeader === "A_6" ||
    rawHeader === "A_7" ||
    rawHeader === "A_8"
  ) {
    return "Agent";
  }
  return null;
}

export function activeWorkSections(
  workCols: string[],
  rawHeaders: string[],
  uniqueHeaders: string[]
): Set<string> {
  const headerByUnique: Record<string, string> = {};
  for (let i = 0; i < uniqueHeaders.length; i++) {
    headerByUnique[uniqueHeaders[i]] = rawHeaders[i];
  }
  const sections = new Set<string>();
  for (const colName of workCols) {
    const rawHeader = headerByUnique[colName] ?? colName;
    if (isMemoWorkColumn(rawHeader)) continue;
    const section = sectionForWorkRawHeader(rawHeader);
    if (section) sections.add(section);
  }
  return sections;
}

export function shouldShowMemoColumn(
  rawHeader: string,
  activeSections: Set<string>
): boolean {
  const section = MEMO_SECTION_BY_HEADER[rawHeader];
  if (!section) return false;
  return activeSections.has(section);
}

export function resolveWorkStatusUnique(
  rawHeaders: string[],
  uniqueHeaders: string[]
): string | null {
  for (let i = 0; i < rawHeaders.length; i++) {
    if (isWorkStatusColumn(rawHeaders[i], i + 1)) {
      return uniqueHeaders[i];
    }
  }
  return uniqueHeaders.includes(COL_STATUS_WORK) ? COL_STATUS_WORK : null;
}

/** FH列の Assignee（unique 名は Assignee または Assignee.1 など） */
export function resolveWorkAssigneeUnique(
  rawHeaders: string[],
  uniqueHeaders: string[]
): string | null {
  for (let i = 0; i < rawHeaders.length; i++) {
    if (
      columnLetter(i + 1) === WORK_ASSIGNEE_COL_LETTER &&
      rawHeaders[i] === COL_ASSIGNEE
    ) {
      return uniqueHeaders[i];
    }
  }
  return uniqueHeaders.includes(COL_ASSIGNEE) ? COL_ASSIGNEE : null;
}

export function effectiveColCount(colCount: number, uniqueHeaders: string[]): number {
  let maxIndex = colCount;
  for (const letter of [WORK_STATUS_COL_LETTER, WORK_ASSIGNEE_COL_LETTER]) {
    const idx = columnIndexFromLetter(letter);
    if (idx > maxIndex) maxIndex = idx;
  }
  return Math.max(colCount, maxIndex, uniqueHeaders.length);
}

function findWikiTripletByRawHeader(
  rawHeader: string
): [string, string, string] | null {
  for (const rule of WIKI_TRIPLET_RULES) {
    if (rule.includes(rawHeader)) return rule;
  }
  return null;
}

/** Wiki 三つ組の表示状態（作業表の列抽出用） */
export type WikiTripletDisplayState =
  | "empty_name"
  | "wiki_dash"
  | "active";

export function wikiTripletDisplayState(
  nameHeader: string,
  wikiHeader: string,
  rowByUnique: Record<string, string>,
  headerMap: Record<string, string>
): WikiTripletDisplayState {
  const nameUnique = headerMap[nameHeader];
  const wikiUnique = headerMap[wikiHeader];
  if (!nameUnique || !(nameUnique in rowByUnique)) return "empty_name";
  if (isCellEmpty(rowByUnique[nameUnique])) return "empty_name";
  if (
    wikiUnique &&
    wikiUnique in rowByUnique &&
    isWikiDash(rowByUnique[wikiUnique])
  ) {
    return "wiki_dash";
  }
  return "active";
}

/**
 * AC 以降の作業列を表示するか。
 * - 水色列のみ は options.lightBlueOnly で制御
 * - 空セルの列は非表示
 * - Wiki 三つ組: active（名称あり・Wiki が `-` 以外）かつ値ありのみ表示
 */
export function shouldIncludeWorkColumn(
  rawHeader: string,
  uniqueName: string,
  rowByUnique: Record<string, string>,
  headerMap: Record<string, string>,
  colIndex: number,
  options: Pick<WorkOptions, "lightBlueOnly" | "showNamedTriplets">
): boolean {
  const showNamedTriplets = options.showNamedTriplets === true;
  // 名称表示モードも「作業対象列（水色）」が基準。
  const lightBlueOnly = showNamedTriplets || options.lightBlueOnly !== false;

  if (lightBlueOnly && !isLightBlueWorkColumn(rawHeader, colIndex)) return false;
  if (isMemoWorkColumn(rawHeader)) return false;

  const triplet = findWikiTripletByRawHeader(rawHeader);
  if (triplet) {
    const [nameHeader, wikiHeader] = triplet;
    const state = wikiTripletDisplayState(
      nameHeader,
      wikiHeader,
      rowByUnique,
      headerMap
    );
    // 三つ組は常に3列（名称/Wiki/正しいwiki）セットで表示/非表示。
    if (showNamedTriplets) {
      // 名称に値あり（empty_name 以外）→ Wiki「-」含めセット表示。
      return state !== "empty_name";
    }
    // 確認対象列のみ: active（名称有・Wiki≠「-」）のみセット表示。
    return state === "active";
  }

  return !isCellEmpty(rowByUnique[uniqueName]);
}

function expandWikiTripletColumns(
  rowByUnique: Record<string, string>,
  rawHeaders: string[],
  uniqueHeaders: string[],
  cols: string[],
  lightBlueOnly: boolean,
  showNamedTriplets = false
): string[] {
  const headerMap = resolveHeaderToUnique(rawHeaders, uniqueHeaders);
  const colSet = new Set(cols);

  for (const [nameHeader, wikiHeader, okHeader] of WIKI_TRIPLET_RULES) {
    const nameUnique = headerMap[nameHeader];
    const wikiUnique = headerMap[wikiHeader];
    if (!nameUnique || !(nameUnique in rowByUnique)) continue;
    if (!wikiUnique || !(wikiUnique in rowByUnique)) continue;
    if (
      isCellEmpty(rowByUnique[nameUnique]) ||
      !hasDisplayWikiValue(rowByUnique[wikiUnique])
    ) {
      continue;
    }
    if (!rawHeaders.includes(okHeader)) continue;
    if (
      lightBlueOnly &&
      !isLightBlueWorkColumn(okHeader, rawHeaders.indexOf(okHeader) + 1)
    ) {
      continue;
    }
    const okUnique = headerMap[okHeader];
    if (okUnique && okUnique in rowByUnique) colSet.add(okUnique);
  }

  // 名称表示モードでは Wiki「-」の三つ組も残す（名称に値があれば丸ごと表示）。
  if (!showNamedTriplets) {
    for (const [nameHeader, wikiHeader, okHeader] of WIKI_TRIPLET_RULES) {
      const nameUnique = headerMap[nameHeader];
      const wikiUnique = headerMap[wikiHeader];
      const okUnique = headerMap[okHeader];
      if (!nameUnique || !(nameUnique in rowByUnique)) continue;
      if (isCellEmpty(rowByUnique[nameUnique])) continue;
      if (!wikiUnique || !(wikiUnique in rowByUnique)) continue;
      if (!isWikiDash(rowByUnique[wikiUnique])) continue;
      colSet.delete(nameUnique);
      colSet.delete(wikiUnique);
      if (okUnique) colSet.delete(okUnique);
    }
  }

  const leading = LEADING.map((h) => headerMap[h]).filter(
    (u): u is string => !!u && colSet.has(u)
  );
  const leadingSet = new Set(leading);
  const rest = uniqueHeaders.filter((u) => colSet.has(u) && !leadingSet.has(u));
  return [...leading, ...rest];
}

/** 全列表示モード（Entity値有り OFF・全列編集 OFF・水色フィルタ OFF） */
export function isAllColsMode(
  options: Pick<WorkOptions, "lightBlueOnly" | "fullEditMode" | "showNamedTriplets">
): boolean {
  return (
    options.fullEditMode !== true &&
    options.showNamedTriplets !== true &&
    options.lightBlueOnly === false
  );
}

export function workDisplayColumns(
  rowByUnique: Record<string, string>,
  rawHeaders: string[],
  uniqueHeaders: string[],
  options: Pick<WorkOptions, "lightBlueOnly" | "fullEditMode" | "showNamedTriplets">
): string[] {
  const headerMap = resolveHeaderToUnique(rawHeaders, uniqueHeaders);
  const cols: string[] = [];

  for (const header of LEADING) {
    const uniqueName = headerMap[header];
    if (uniqueName && uniqueName in rowByUnique) cols.push(uniqueName);
  }

  if (options.fullEditMode) {
    for (let i = 0; i < uniqueHeaders.length; i++) {
      const uniqueName = uniqueHeaders[i];
      if (!(uniqueName in rowByUnique) || cols.includes(uniqueName)) continue;
      if (!isFullDisplayColIndex(i + 1)) continue;
      cols.push(uniqueName);
    }
    return cols;
  }

  let startIndex = rawHeaders.indexOf(WORK_TABLE_START_HEADER);
  if (startIndex < 0) startIndex = rawHeaders.length;

  // 全列表示（Entity値有り OFF）: AC 以降の全列をフィルタなしで表示（空列・三つ組も全部）。
  if (isAllColsMode(options)) {
    for (let i = startIndex; i < uniqueHeaders.length; i++) {
      const uniqueName = uniqueHeaders[i];
      if (!(uniqueName in rowByUnique) || cols.includes(uniqueName)) continue;
      cols.push(uniqueName);
    }
    return cols;
  }

  for (let i = startIndex; i < uniqueHeaders.length; i++) {
    const uniqueName = uniqueHeaders[i];
    const rawHeader = rawHeaders[i];
    if (!(uniqueName in rowByUnique) || cols.includes(uniqueName)) continue;
    if (
      !shouldIncludeWorkColumn(
        rawHeader,
        uniqueName,
        rowByUnique,
        headerMap,
        i + 1,
        options
      )
    ) {
      continue;
    }
    cols.push(uniqueName);
  }

  return expandWikiTripletColumns(
    rowByUnique,
    rawHeaders,
    uniqueHeaders,
    cols,
    options.lightBlueOnly !== false || options.showNamedTriplets === true,
    options.showNamedTriplets === true
  );
}

export function filterMemoDisplayColumns(
  workCols: string[],
  rawHeaders: string[],
  uniqueHeaders: string[]
): string[] {
  const headerByUnique: Record<string, string> = {};
  for (let i = 0; i < uniqueHeaders.length; i++) {
    headerByUnique[uniqueHeaders[i]] = rawHeaders[i];
  }
  const nonMemo = workCols.filter(
    (col) => !isMemoWorkColumn(headerByUnique[col] ?? col)
  );
  const active = activeWorkSections(nonMemo, rawHeaders, uniqueHeaders);
  const filteredSet = new Set(nonMemo);
  for (let j = 0; j < rawHeaders.length; j++) {
    const rawHeader = rawHeaders[j];
    if (!isMemoWorkColumn(rawHeader)) continue;
    if (shouldShowMemoColumn(rawHeader, active)) {
      filteredSet.add(uniqueHeaders[j]);
    }
  }
  return uniqueHeaders.filter((name) => filteredSet.has(name));
}

export function ensureWorkDisplayCols(
  workCols: string[],
  rawHeaders: string[],
  uniqueHeaders: string[]
): string[] {
  const colSet = new Set(workCols);
  const statusUnique = resolveWorkStatusUnique(rawHeaders, uniqueHeaders);
  if (statusUnique) colSet.add(statusUnique);
  const ordered = uniqueHeaders.filter((name) => colSet.has(name));
  return filterMemoDisplayColumns(ordered, rawHeaders, uniqueHeaders);
}

export function rowSummary(
  rowByUnique: Record<string, string>,
  sheetRowNumber: number
): string {
  const renban = isCellEmpty(rowByUnique["連番"])
    ? ""
    : String(rowByUnique["連番"]).trim();
  const entity = isCellEmpty(rowByUnique["ENTITY_NAME"])
    ? ""
    : String(rowByUnique["ENTITY_NAME"]).trim();
  return `行 ${sheetRowNumber} | ${renban} | ${entity}`;
}

export function buildColumnPayload(
  rowByUnique: Record<string, string>,
  workCols: string[],
  rawHeaders: string[],
  uniqueHeaders: string[],
  fullEditMode = false
): ColumnPayload[] {
  const headerByUnique: Record<string, string> = {};
  for (let i = 0; i < uniqueHeaders.length; i++) {
    headerByUnique[uniqueHeaders[i]] = rawHeaders[i];
  }

  return workCols.map((uniqueName) => {
    const colIndex = uniqueHeaders.indexOf(uniqueName) + 1;
    const rawHeader = headerByUnique[uniqueName] ?? uniqueName;
    const value = rowByUnique[uniqueName];
    const display = isCellEmpty(value) ? "—" : String(value).trim();
    const inline = isInlineEditableColumn(
      uniqueName,
      rawHeader,
      colIndex,
      fullEditMode
    );
    const isStatus = isWorkStatusColumn(rawHeader, colIndex);
    let editValue = isCellEmpty(value) ? "" : String(value);
    if (isStatus) editValue = normalizeWorkStatus(value);
    const triplet = isCorrectWikiHeader(rawHeader)
      ? tripletValuesForOkHeader(rawHeader, rowByUnique, rawHeaders, uniqueHeaders)
      : null;

    return {
      uniqueName,
      rawHeader,
      letter: columnLetter(colIndex),
      display,
      value: editValue,
      inline,
      isStatus,
      isMemo: isMemoWorkColumn(rawHeader),
      isWiki: isWikiStyleHeader(rawHeader) && !isMemoWorkColumn(rawHeader),
      isWikiEdit: isCorrectWikiHeader(rawHeader),
      isWikiName: isWikiNameHeader(rawHeader),
      isLeading: (LEADING as readonly string[]).includes(rawHeader),
      tripletName: triplet?.name ?? "",
      tripletWiki: triplet?.wiki ?? "",
    };
  });
}

export function buildWritePlan(
  sheetRowNumber: number,
  rawHeaders: string[],
  uniqueHeaders: string[],
  updates: Record<string, string>,
  fullEditMode = false
): { cell: string; value: string }[] {
  const plan: { cell: string; value: string }[] = [];
  for (const [uniqueName, value] of Object.entries(updates)) {
    const colIndex = uniqueHeaders.indexOf(uniqueName);
    if (colIndex < 0) continue;
    const rawHeader = rawHeaders[colIndex];
    if (!isWritableColumn(rawHeader, colIndex + 1, fullEditMode)) continue;
    const letter = columnLetter(colIndex + 1);
    plan.push({ cell: `${letter}${sheetRowNumber}`, value });
  }
  return plan;
}

export function collectEditableUpdates(
  edits: Record<string, string>,
  workCols: string[],
  rawHeaders: string[],
  uniqueHeaders: string[],
  fullEditMode = false
): Record<string, string> {
  const headerByUnique: Record<string, string> = {};
  for (let i = 0; i < uniqueHeaders.length; i++) {
    headerByUnique[uniqueHeaders[i]] = rawHeaders[i];
  }
  const updates: Record<string, string> = {};
  for (const uniqueName of workCols) {
    if (!(uniqueName in edits)) continue;
    const colIndex = uniqueHeaders.indexOf(uniqueName) + 1;
    const rawHeader = headerByUnique[uniqueName];
    if (!isInlineEditableColumn(uniqueName, rawHeader, colIndex, fullEditMode)) {
      continue;
    }
    updates[uniqueName] = edits[uniqueName];
  }
  return updates;
}

export function rowByUniqueFromValues(
  uniqueHeaders: string[],
  rowValues: string[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < uniqueHeaders.length; i++) {
    map[uniqueHeaders[i]] = i < rowValues.length ? rowValues[i] : "";
  }
  return map;
}

export function filterQueueRows(
  rows: { sheetRowNumber: number; renban: string; status: string; assignee: string }[],
  options: WorkOptions
): number[] {
  const worker = options.worker.trim();
  let filtered = rows;

  if (options.skipDone) {
    filtered = filtered.filter((r) => r.status.trim() !== STATUS_DONE);
  }

  // 「全体」は全件表示（Assignee で絞らない）
  if (worker === ASSIGN_ALL_ROWS_NAME) {
    return filtered.map((r) => r.sheetRowNumber);
  }

  if (options.queueFilter === "未担当") {
    filtered = filtered.filter((r) => isCellEmpty(r.assignee));
  } else if (options.queueFilter === "自分担当") {
    filtered = filtered.filter((r) => r.assignee.trim() === worker);
  } else if (options.queueFilter === "未担当＋自分担当") {
    filtered = filtered.filter(
      (r) => isCellEmpty(r.assignee) || r.assignee.trim() === worker
    );
  }

  return filtered.map((r) => r.sheetRowNumber);
}

export function buildRowPayload(
  rowByUnique: Record<string, string>,
  rawHeaders: string[],
  uniqueHeaders: string[],
  sheetRowNumber: number,
  options: Pick<WorkOptions, "lightBlueOnly" | "fullEditMode" | "showNamedTriplets">
) {
  const fullEditMode = options.fullEditMode === true;
  let workCols = workDisplayColumns(rowByUnique, rawHeaders, uniqueHeaders, options);
  // 全列表示は memo フィルタ・status 補完を行わず、範囲内の全列をそのまま表示。
  if (!fullEditMode && !isAllColsMode(options)) {
    workCols = ensureWorkDisplayCols(workCols, rawHeaders, uniqueHeaders);
  }
  const assigneeUnique = resolveWorkAssigneeUnique(rawHeaders, uniqueHeaders);
  const assignee =
    assigneeUnique && assigneeUnique in rowByUnique
      ? String(rowByUnique[assigneeUnique] ?? "").trim()
      : "";
  return {
    sheetRowNumber,
    summary: rowSummary(rowByUnique, sheetRowNumber),
    assignee,
    columns: buildColumnPayload(
      rowByUnique,
      workCols,
      rawHeaders,
      uniqueHeaders,
      fullEditMode
    ),
  };
}
