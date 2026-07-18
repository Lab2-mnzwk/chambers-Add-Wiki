import {
  ASSIGN_ALL_ROWS_NAME,
  LEADING_FIXED_HEADERS,
  isDoneStatus,
  STATUS_NOT_STARTED,
  WORK_STATUS_OPTIONS,
  WORK_TABLE_START_HEADER,
  WRITE_DENYLIST_COL_LETTERS,
} from "./config";

import type { ColumnPayload, SheetRules, WorkOptions } from "./types";

const LEADING = LEADING_FIXED_HEADERS;

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

/** 名称セルが「Entity値あり」か。空 と "-" は値なし扱い（Entity値有りに含めない）。 */
export function nameCellHasValue(value: unknown): boolean {
  const v = String(value ?? "").trim();
  return v !== "" && v !== "-";
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
  return rawHeader.endsWith("_memo");
}

/** memo 列のセクション名（Agent_memo → Agent）。 */
function memoSectionOf(rawHeader: string): string {
  return rawHeader.replace(/_memo$/, "");
}

export function isCorrectWikiHeader(rawHeader: string): boolean {
  return rawHeader.includes("正しいwiki");
}

/** Wiki 三つ組の名称列（A_name1, Pl_1, Pl_name5 等） */
export function isWikiNameHeader(rawHeader: string, rules: SheetRules): boolean {
  return rules.wikiNameHeaders.has(rawHeader);
}

/** 作業 Status 列（uniqueName で判定） */
export function isStatusUnique(uniqueName: string, rules: SheetRules): boolean {
  return rules.statusUnique != null && uniqueName === rules.statusUnique;
}

/** 担当 Assignee 列（uniqueName で判定） */
export function isAssigneeUnique(uniqueName: string, rules: SheetRules): boolean {
  return rules.assigneeUnique != null && uniqueName === rules.assigneeUnique;
}

/** 作業対象（水色）列か（名称/Wiki/正しいwiki/memo/Status/Assignee） */
export function isLightBlueWorkColumn(
  uniqueName: string,
  rules: SheetRules
): boolean {
  return rules.lightBlueUnique.has(uniqueName);
}

export function isWritableColumn(
  rules: SheetRules,
  uniqueName: string,
  colIndex: number,
  fullEditMode = false
): boolean {
  const letter = columnLetter(colIndex);
  if (WRITE_DENYLIST_COL_LETTERS.has(letter)) return false;
  if (isStatusUnique(uniqueName, rules)) return true;
  if (fullEditMode && rules.fullEditableIdx.has(colIndex - 1)) return true;
  return rules.lightBlueUnique.has(uniqueName);
}

export function isInlineEditableColumn(
  rules: SheetRules,
  uniqueName: string,
  rawHeader: string,
  colIndex: number,
  fullEditMode = false
): boolean {
  if (isStatusUnique(uniqueName, rules)) return true;
  if (isMemoWorkColumn(rawHeader) || isCorrectWikiHeader(rawHeader)) {
    return isWritableColumn(rules, uniqueName, colIndex, fullEditMode);
  }
  if (
    fullEditMode &&
    rules.fullEditableIdx.has(colIndex - 1) &&
    isWritableColumn(rules, uniqueName, colIndex, fullEditMode)
  ) {
    return true;
  }
  return false;
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
  rules: SheetRules,
  okRawHeader: string,
  rowByUnique: Record<string, string>
): { name: string; wiki: string } | null {
  for (const t of rules.triplets) {
    if (t.ok !== okRawHeader) continue;
    const nameUnique = rules.headerMap[t.name];
    const wikiUnique = rules.headerMap[t.wiki];
    if (!nameUnique || !wikiUnique) return null;
    return {
      name: String(rowByUnique[nameUnique] ?? "").trim(),
      wiki: String(rowByUnique[wikiUnique] ?? "").trim(),
    };
  }
  return null;
}

/** 正しいwiki 列に対応する三つ組の deweyID 有無 */
export function tripletDeweyHasValueForOkHeader(
  rules: SheetRules,
  okRawHeader: string,
  rowByUnique: Record<string, string>
): boolean {
  for (const t of rules.triplets) {
    if (t.ok !== okRawHeader) continue;
    return tripletDeweyHasValue(rules, t.name, rowByUnique);
  }
  return false;
}

export function sectionForWorkRawHeader(
  rawHeader: string,
  rules: SheetRules
): string | null {
  return rules.sectionByHeader[rawHeader] ?? null;
}

export function activeWorkSections(
  workCols: string[],
  rules: SheetRules
): Set<string> {
  const headerByUnique: Record<string, string> = {};
  for (let i = 0; i < rules.uniqueHeaders.length; i++) {
    headerByUnique[rules.uniqueHeaders[i]] = rules.rawHeaders[i];
  }
  const sections = new Set<string>();
  for (const colName of workCols) {
    const rawHeader = headerByUnique[colName] ?? colName;
    if (isMemoWorkColumn(rawHeader)) continue;
    const section = sectionForWorkRawHeader(rawHeader, rules);
    if (section) sections.add(section);
  }
  return sections;
}

export function shouldShowMemoColumn(
  rawHeader: string,
  activeSections: Set<string>
): boolean {
  if (!isMemoWorkColumn(rawHeader)) return false;
  return activeSections.has(memoSectionOf(rawHeader));
}

/** 読み取るべき最大列数（ヘッダー幅を必ずカバー）。 */
export function effectiveColCount(
  colCount: number,
  uniqueHeaders: string[]
): number {
  return Math.max(colCount, uniqueHeaders.length);
}

/** Wiki 三つ組の表示状態（作業表の列抽出用） */
export type WikiTripletDisplayState = "empty_name" | "wiki_dash" | "active";

export function wikiTripletDisplayState(
  rules: SheetRules,
  nameHeader: string,
  wikiHeader: string,
  rowByUnique: Record<string, string>
): WikiTripletDisplayState {
  const nameUnique = rules.headerMap[nameHeader];
  const wikiUnique = rules.headerMap[wikiHeader];
  if (!nameUnique || !(nameUnique in rowByUnique)) return "empty_name";
  if (!nameCellHasValue(rowByUnique[nameUnique])) return "empty_name";
  if (
    wikiUnique &&
    wikiUnique in rowByUnique &&
    isWikiDash(rowByUnique[wikiUnique])
  ) {
    return "wiki_dash";
  }
  return "active";
}

export function deweyCellHasValue(value: unknown): boolean {
  const v = String(value ?? "").trim();
  return v !== "" && v !== "-";
}

/**
 * 三つ組の deweyID 列に値があるか（空・`-` は「値無し」扱い）。
 * 「deweyID有りを除く」モードの判定にのみ使用（deweyID 列自体は表示しない）。
 */
export function tripletDeweyHasValue(
  rules: SheetRules,
  nameHeader: string,
  rowByUnique: Record<string, string>
): boolean {
  const deweyHeader = rules.deweyByName[nameHeader];
  if (!deweyHeader) return false;
  const unique = rules.headerMap[deweyHeader];
  if (!unique || !(unique in rowByUnique)) return false;
  return deweyCellHasValue(rowByUnique[unique]);
}

function findWikiTripletByRawHeader(rawHeader: string, rules: SheetRules) {
  for (const t of rules.triplets) {
    if (t.name === rawHeader || t.wiki === rawHeader || t.ok === rawHeader) {
      return t;
    }
  }
  return null;
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

/**
 * AC 以降の作業列を表示するか。
 * - 水色列のみ は options.lightBlueOnly で制御
 * - 空セルの列は非表示
 * - Wiki 三つ組（名称/Wiki/正しいwiki）は常に3列セットで表示/非表示
 */
export function shouldIncludeWorkColumn(
  rules: SheetRules,
  rawHeader: string,
  uniqueName: string,
  rowByUnique: Record<string, string>,
  options: Pick<WorkOptions, "lightBlueOnly" | "showNamedTriplets">
): boolean {
  const showNamedTriplets = options.showNamedTriplets === true;
  const lightBlueOnly = showNamedTriplets || options.lightBlueOnly !== false;

  if (lightBlueOnly && !isLightBlueWorkColumn(uniqueName, rules)) return false;
  if (isMemoWorkColumn(rawHeader)) return false;

  const triplet = findWikiTripletByRawHeader(rawHeader, rules);
  if (triplet) {
    const state = wikiTripletDisplayState(
      rules,
      triplet.name,
      triplet.wiki,
      rowByUnique
    );
    if (state === "empty_name") return false;
    if (showNamedTriplets) return true;
    return !tripletDeweyHasValue(rules, triplet.name, rowByUnique);
  }

  return !isCellEmpty(rowByUnique[uniqueName]);
}

function expandWikiTripletColumns(
  rules: SheetRules,
  rowByUnique: Record<string, string>,
  cols: string[],
  lightBlueOnly: boolean,
  showNamedTriplets = false
): string[] {
  const { headerMap, uniqueHeaders } = rules;
  const colSet = new Set(cols);

  for (const t of rules.triplets) {
    const nameUnique = headerMap[t.name];
    if (!nameUnique || !(nameUnique in rowByUnique)) continue;
    if (!nameCellHasValue(rowByUnique[nameUnique])) continue;
    const visible =
      showNamedTriplets || !tripletDeweyHasValue(rules, t.name, rowByUnique);
    if (!visible) continue;
    const okUnique = headerMap[t.ok];
    if (!okUnique) continue;
    if (lightBlueOnly && !isLightBlueWorkColumn(okUnique, rules)) continue;
    if (okUnique in rowByUnique) colSet.add(okUnique);
  }

  // 「deweyID有りを除く」モードでは deweyID 有りの三つ組をセットごと除外する。
  if (!showNamedTriplets) {
    for (const t of rules.triplets) {
      const nameUnique = headerMap[t.name];
      const wikiUnique = headerMap[t.wiki];
      const okUnique = headerMap[t.ok];
      if (!nameUnique || !(nameUnique in rowByUnique)) continue;
      if (!nameCellHasValue(rowByUnique[nameUnique])) continue;
      if (!tripletDeweyHasValue(rules, t.name, rowByUnique)) continue;
      colSet.delete(nameUnique);
      if (wikiUnique) colSet.delete(wikiUnique);
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
  rules: SheetRules,
  rowByUnique: Record<string, string>,
  options: Pick<WorkOptions, "lightBlueOnly" | "fullEditMode" | "showNamedTriplets">
): string[] {
  const { headerMap, rawHeaders, uniqueHeaders } = rules;
  const cols: string[] = [];

  for (const header of LEADING) {
    const uniqueName = headerMap[header];
    if (uniqueName && uniqueName in rowByUnique) cols.push(uniqueName);
  }

  if (options.fullEditMode) {
    for (let i = 0; i < uniqueHeaders.length; i++) {
      const uniqueName = uniqueHeaders[i];
      if (!(uniqueName in rowByUnique) || cols.includes(uniqueName)) continue;
      if (!rules.fullDisplayIdx.has(i)) continue;
      cols.push(uniqueName);
    }
    return cols;
  }

  let startIndex = rawHeaders.indexOf(WORK_TABLE_START_HEADER);
  if (startIndex < 0) startIndex = rawHeaders.length;

  // 全列表示（Entity値有り OFF）: AC 以降の全列をフィルタなしで表示。
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
      !shouldIncludeWorkColumn(rules, rawHeader, uniqueName, rowByUnique, options)
    ) {
      continue;
    }
    cols.push(uniqueName);
  }

  return expandWikiTripletColumns(
    rules,
    rowByUnique,
    cols,
    options.lightBlueOnly !== false || options.showNamedTriplets === true,
    options.showNamedTriplets === true
  );
}

export function filterMemoDisplayColumns(
  rules: SheetRules,
  workCols: string[]
): string[] {
  const { rawHeaders, uniqueHeaders } = rules;
  const headerByUnique: Record<string, string> = {};
  for (let i = 0; i < uniqueHeaders.length; i++) {
    headerByUnique[uniqueHeaders[i]] = rawHeaders[i];
  }
  const nonMemo = workCols.filter(
    (col) => !isMemoWorkColumn(headerByUnique[col] ?? col)
  );
  const active = activeWorkSections(nonMemo, rules);
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
  rules: SheetRules,
  workCols: string[]
): string[] {
  const colSet = new Set(workCols);
  if (rules.statusUnique) colSet.add(rules.statusUnique);
  const ordered = rules.uniqueHeaders.filter((name) => colSet.has(name));
  return filterMemoDisplayColumns(rules, ordered);
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
  rules: SheetRules,
  rowByUnique: Record<string, string>,
  workCols: string[],
  fullEditMode = false
): ColumnPayload[] {
  const { rawHeaders, uniqueHeaders } = rules;
  const headerByUnique: Record<string, string> = {};
  for (let i = 0; i < uniqueHeaders.length; i++) {
    headerByUnique[uniqueHeaders[i]] = rawHeaders[i];
  }

  return workCols.map((uniqueName) => {
    const colIndex = uniqueHeaders.indexOf(uniqueName) + 1;
    const rawHeader = headerByUnique[uniqueName] ?? uniqueName;
    const value = rowByUnique[uniqueName];
    let inline = isInlineEditableColumn(
      rules,
      uniqueName,
      rawHeader,
      colIndex,
      fullEditMode
    );
    const isStatus = isStatusUnique(uniqueName, rules);
    const isAssignee = isAssigneeUnique(uniqueName, rules);
    let editValue = isCellEmpty(value) ? "" : String(value);
    if (isStatus) editValue = normalizeWorkStatus(value);
    const triplet = isCorrectWikiHeader(rawHeader)
      ? tripletValuesForOkHeader(rules, rawHeader, rowByUnique)
      : null;
    const tripletDewey =
      isCorrectWikiHeader(rawHeader) &&
      tripletDeweyHasValueForOkHeader(rules, rawHeader, rowByUnique);
    if (isCorrectWikiHeader(rawHeader) && tripletDewey) {
      inline = false;
    }
    const displayText =
      isCorrectWikiHeader(rawHeader) && tripletDewey
        ? "DeweyIDありのため入力不要"
        : isCellEmpty(value)
          ? "—"
          : String(value).trim();

    const isWiki =
      rules.lightBlueUnique.has(uniqueName) &&
      !isStatus &&
      !isAssignee &&
      !isMemoWorkColumn(rawHeader);

    return {
      uniqueName,
      rawHeader,
      letter: columnLetter(colIndex),
      display: displayText,
      value: editValue,
      inline,
      isStatus,
      isAssignee,
      isMemo: isMemoWorkColumn(rawHeader),
      isWiki,
      isWikiEdit: isCorrectWikiHeader(rawHeader),
      isWikiName: isWikiNameHeader(rawHeader, rules),
      isLeading: (LEADING as readonly string[]).includes(rawHeader),
      tripletName: triplet?.name ?? "",
      tripletWiki: triplet?.wiki ?? "",
      tripletDeweyHasValue: tripletDewey,
    };
  });
}

export function buildWritePlan(
  rules: SheetRules,
  sheetRowNumber: number,
  updates: Record<string, string>,
  fullEditMode = false
): { cell: string; value: string }[] {
  const { uniqueHeaders } = rules;
  const plan: { cell: string; value: string }[] = [];
  for (const [uniqueName, value] of Object.entries(updates)) {
    const colIndex = uniqueHeaders.indexOf(uniqueName);
    if (colIndex < 0) continue;
    if (!isWritableColumn(rules, uniqueName, colIndex + 1, fullEditMode)) continue;
    const letter = columnLetter(colIndex + 1);
    plan.push({ cell: `${letter}${sheetRowNumber}`, value });
  }
  return plan;
}

export function collectEditableUpdates(
  rules: SheetRules,
  edits: Record<string, string>,
  workCols: string[],
  fullEditMode = false
): Record<string, string> {
  const { rawHeaders, uniqueHeaders } = rules;
  const headerByUnique: Record<string, string> = {};
  for (let i = 0; i < uniqueHeaders.length; i++) {
    headerByUnique[uniqueHeaders[i]] = rawHeaders[i];
  }
  const updates: Record<string, string> = {};
  for (const uniqueName of workCols) {
    if (!(uniqueName in edits)) continue;
    const colIndex = uniqueHeaders.indexOf(uniqueName) + 1;
    const rawHeader = headerByUnique[uniqueName];
    if (
      !isInlineEditableColumn(rules, uniqueName, rawHeader, colIndex, fullEditMode)
    ) {
      continue;
    }
    updates[uniqueName] = edits[uniqueName];
  }
  return updates;
}

export function filterQueueRows(
  rows: {
    sheetRowNumber: number;
    renban: string;
    status: string;
    assignee: string;
  }[],
  options: WorkOptions
): number[] {
  const worker = options.worker.trim();
  let filtered = rows;

  if (options.statusFilter === "incomplete") {
    filtered = filtered.filter((r) => !isDoneStatus(r.status));
  } else if (options.statusFilter === "notStarted") {
    filtered = filtered.filter(
      (r) => normalizeWorkStatus(r.status) === STATUS_NOT_STARTED
    );
  }

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
  rules: SheetRules,
  sheet: { id: string; label: string },
  rowByUnique: Record<string, string>,
  sheetRowNumber: number,
  options: Pick<WorkOptions, "lightBlueOnly" | "fullEditMode" | "showNamedTriplets">
) {
  const fullEditMode = options.fullEditMode === true;
  let workCols = workDisplayColumns(rules, rowByUnique, options);
  if (!fullEditMode && !isAllColsMode(options)) {
    workCols = ensureWorkDisplayCols(rules, workCols);
  }
  const assignee =
    rules.assigneeUnique && rules.assigneeUnique in rowByUnique
      ? String(rowByUnique[rules.assigneeUnique] ?? "").trim()
      : "";
  const eventName = isCellEmpty(rowByUnique["ENTITY_NAME"])
    ? ""
    : String(rowByUnique["ENTITY_NAME"]).trim();
  const wikiLearning = rules.triplets.flatMap((triplet) => {
    const correctUniqueName = rules.headerMap[triplet.ok];
    const nameUnique = rules.headerMap[triplet.name];
    const wikiUnique = rules.headerMap[triplet.wiki];
    if (!correctUniqueName || !nameUnique || !wikiUnique) return [];
    const deweyUnique = triplet.dewey ? rules.headerMap[triplet.dewey] : undefined;
    return [
      {
        correctUniqueName,
        nameUniqueName: nameUnique,
        wikiUniqueName: wikiUnique,
        deweyUniqueName: deweyUnique ?? null,
        name: String(rowByUnique[nameUnique] ?? ""),
        wiki: String(rowByUnique[wikiUnique] ?? ""),
        correctWiki: String(rowByUnique[correctUniqueName] ?? ""),
        deweyHasValue: tripletDeweyHasValue(rules, triplet.name, rowByUnique),
      },
    ];
  });
  return {
    sheet: sheet.id,
    sheetLabel: sheet.label,
    sheetRowNumber,
    summary: rowSummary(rowByUnique, sheetRowNumber),
    eventName,
    assignee,
    columns: buildColumnPayload(rules, rowByUnique, workCols, fullEditMode),
    wikiLearning,
  };
}
