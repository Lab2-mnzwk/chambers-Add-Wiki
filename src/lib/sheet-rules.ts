import {
  MEMO_HEADER_SUFFIX,
  ROLE_HEADERS,
  SECTION_HEADERS,
  WORK_TABLE_START_HEADER,
} from "./config";
import { resolveHeaderToUnique } from "./columns";
import type { SheetRules, SheetStructure, WikiTriplet } from "./types";

const SECTION_SET = new Set<string>(SECTION_HEADERS);
const ROLE_SET = new Set<string>(ROLE_HEADERS);

/** deweyID 列の命名バリエーション（A_deweyID1 / A_dID_1 / PT_dID_1 / Pl_dID1 ...）。 */
function looksLikeDeweyHeader(header: string): boolean {
  return /d(?:ewey)?id/i.test(header);
}

/** memo 列か（末尾 _memo）。 */
export function isMemoHeaderName(header: string): boolean {
  return header.endsWith(MEMO_HEADER_SUFFIX);
}

/** memo 列のセクション名（Agent_memo → Agent, Patient-Theme_memo → Patient-Theme）。 */
export function memoSectionOf(header: string): string {
  return header.slice(0, header.length - MEMO_HEADER_SUFFIX.length);
}

/**
 * 全列編集モードで隠すヘルパー列か。
 * _lang / __auto / 〜数 / wiki結合 / wiki統合 / _Category / 先頭 `_`（言語・メタ列）を隠す。
 */
function isHelperHeader(header: string): boolean {
  return (
    /_lang$/.test(header) ||
    header.includes("__auto") ||
    /数$/.test(header) ||
    header.includes("wiki結合") ||
    header.includes("wiki統合") ||
    header.includes("_Category") ||
    header.startsWith("_")
  );
}

/** 1 シートのヘッダー構造から列ルールを検出する。 */
export function buildSheetRules(
  structure: SheetStructure,
  assigneeHeader: string
): SheetRules {
  const { rawHeaders, uniqueHeaders } = structure;
  const headerMap = resolveHeaderToUnique(rawHeaders, uniqueHeaders);

  // --- 三つ組検出: `正しいwiki` 列を起点に直前 3 列 [名称, deweyID, Wiki] を取る ---
  const triplets: WikiTriplet[] = [];
  const wikiNameHeaders = new Set<string>();
  const deweyByName: Record<string, string> = {};
  const tripletUnique = new Set<string>();
  const tripletHeaderSet = new Set<string>();

  for (let i = 0; i < rawHeaders.length; i++) {
    if (!rawHeaders[i].includes("正しいwiki")) continue;
    const ok = rawHeaders[i];
    const wiki = rawHeaders[i - 1];
    const maybeDewey = rawHeaders[i - 2];
    let dewey: string | null = null;
    let name: string | undefined;
    if (maybeDewey && looksLikeDeweyHeader(maybeDewey)) {
      dewey = maybeDewey;
      name = rawHeaders[i - 3];
    } else {
      name = maybeDewey;
    }
    if (!name || !wiki) continue;

    triplets.push({ name, dewey, wiki, ok });
    wikiNameHeaders.add(name);
    if (dewey) deweyByName[name] = dewey;
    for (const h of [name, wiki, ok, dewey]) {
      if (h && headerMap[h]) tripletUnique.add(headerMap[h]);
      if (h) tripletHeaderSet.add(h);
    }
  }

  // --- セクション（Agent/Patient-Theme/Place/Territory）を左→右スキャンで対応付け ---
  // 対応付け対象は三つ組・memo 列だけに限定する。Status/Assignee/役割列等の構造列まで
  // 対応付けてしまうと、最後尾のセクション（Territory）が Status 等を拾って
  // 「常にアクティブ」判定になり、Territory_memo が常時表示される不具合になる。
  const sectionByHeader: Record<string, string> = {};
  let currentSection: string | null = null;
  for (let i = 0; i < rawHeaders.length; i++) {
    const h = rawHeaders[i];
    if (SECTION_SET.has(h)) currentSection = h;
    if (
      currentSection &&
      !(h in sectionByHeader) &&
      (tripletHeaderSet.has(h) || isMemoHeaderName(h))
    ) {
      sectionByHeader[h] = currentSection;
    }
  }

  // --- 作業 Status / Assignee の解決（Assignee 列の直前の Status を作業 Status とする） ---
  const assigneeIdx = rawHeaders.indexOf(assigneeHeader);
  const assigneeUnique = assigneeIdx >= 0 ? uniqueHeaders[assigneeIdx] : null;
  let statusUnique: string | null = null;
  if (assigneeIdx > 0 && rawHeaders[assigneeIdx - 1] === "Status") {
    statusUnique = uniqueHeaders[assigneeIdx - 1];
  } else {
    for (let i = rawHeaders.length - 1; i >= 0; i--) {
      if (rawHeaders[i] === "Status") {
        statusUnique = uniqueHeaders[i];
        break;
      }
    }
  }

  // --- 作業対象（水色）列 uniqueName 集合 ---
  const lightBlueUnique = new Set<string>();
  for (const t of triplets) {
    for (const h of [t.name, t.wiki, t.ok]) {
      if (headerMap[h]) lightBlueUnique.add(headerMap[h]);
    }
  }
  const memoHeaders: string[] = [];
  for (const h of rawHeaders) {
    if (isMemoHeaderName(h)) {
      if (!memoHeaders.includes(h)) memoHeaders.push(h);
      if (headerMap[h]) lightBlueUnique.add(headerMap[h]);
    }
  }
  if (statusUnique) lightBlueUnique.add(statusUnique);
  if (assigneeUnique) lightBlueUnique.add(assigneeUnique);

  // --- 全列編集モードの表示・編集範囲（構造ベース） ---
  const startIdx = Math.max(0, rawHeaders.indexOf(WORK_TABLE_START_HEADER));
  let endIdx = startIdx;
  if (statusUnique) {
    endIdx = Math.max(endIdx, uniqueHeaders.indexOf(statusUnique));
  }
  if (assigneeIdx >= 0) endIdx = Math.max(endIdx, assigneeIdx);
  for (const role of ROLE_HEADERS) {
    const ri = rawHeaders.indexOf(role);
    if (ri > endIdx) endIdx = ri;
  }

  const fullDisplayIdx = new Set<number>();
  const fullEditableIdx = new Set<number>();
  for (let i = startIdx; i <= endIdx && i < rawHeaders.length; i++) {
    const h = rawHeaders[i];
    if (isHelperHeader(h)) continue;
    fullDisplayIdx.add(i);
    const unique = uniqueHeaders[i];
    // 編集可: 三つ組（名称/deweyID/Wiki/正しいwiki）・memo・役割列・作業 Status。
    // セクション見出し（Agent 等）・ENTITY_NAME・担当列は文脈用に表示のみ。
    const editable =
      (tripletUnique.has(unique) ||
        isMemoHeaderName(h) ||
        ROLE_SET.has(h) ||
        unique === statusUnique) &&
      !/Assignee/.test(h);
    if (editable) fullEditableIdx.add(i);
  }
  if (statusUnique) {
    const sIdx = uniqueHeaders.indexOf(statusUnique);
    if (sIdx >= 0) {
      fullDisplayIdx.add(sIdx);
      fullEditableIdx.add(sIdx);
    }
  }

  return {
    rawHeaders,
    uniqueHeaders,
    headerMap,
    triplets,
    wikiNameHeaders,
    deweyByName,
    lightBlueUnique,
    tripletUnique,
    memoHeaders,
    sectionByHeader,
    statusUnique,
    assigneeUnique,
    assigneeHeader,
    fullDisplayIdx,
    fullEditableIdx,
  };
}
