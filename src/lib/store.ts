import fs from "fs";
import path from "path";
import { SPREADSHEET_ID, WORK_SHEETS } from "./config";
import type { SheetStructure } from "./types";
import type { WikiHistoryIndex } from "./wiki-history";

export type QueueRecord = {
  sheetRowNumber: number;
  renban: string;
  status: string;
  assignee: string;
};

/**
 * キャッシュは用途ごとに別ファイルへ分割する（行移動のホットパスで巨大 JSON を
 * 読み書きしないため）。1 シートあたり以下の 5 ファイル:
 * - struct: ヘッダー構造（小・読み取り頻繁・refresh 時のみ書込）
 * - nav:    キュー index（status/assignee。大・キュー構築/保存時のみ書込）
 * - rows:   開いた行データ（作業用。行を開くたびに書込）
 * - wiki:   正しいwiki 候補学習（保存/候補構築時のみ書込）
 * - meta:   最終アクセス時刻（極小・アクセスのたびに書込）
 */
type CacheDomain = "struct" | "nav" | "rows" | "wiki" | "meta";
const ALL_DOMAINS: CacheDomain[] = ["struct", "nav", "rows", "wiki", "meta"];

type StructFile = { structure: SheetStructure | null };
type NavFile = { indexRows: number; queueIndex: QueueRecord[] };
type RowsFile = { rows: Record<string, string[]> };
type WikiFile = { wikiHistory: WikiHistoryIndex | null };
type MetaFile = { lastAccessAt: number | null };

function cacheDir(): string {
  if (process.env.SHEET_CACHE_DIR) {
    fs.mkdirSync(process.env.SHEET_CACHE_DIR, { recursive: true });
    return process.env.SHEET_CACHE_DIR;
  }
  if (process.env.VERCEL) {
    const dir = path.join("/tmp", "sheet-cache");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const dir = path.join(process.cwd(), ".cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** キャッシュファイル名は スプレッドシートID__シートID__用途.json。 */
function cacheFile(sheetId: string, domain: CacheDomain): string {
  return path.join(cacheDir(), `${SPREADSHEET_ID}__${sheetId}__${domain}.json`);
}

function readJson<T extends object>(
  sheetId: string,
  domain: CacheDomain,
  fallback: T
): T {
  const file = cacheFile(sheetId, domain);
  if (!fs.existsSync(file)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<T>;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function writeJson<T>(sheetId: string, domain: CacheDomain, data: T): void {
  fs.writeFileSync(cacheFile(sheetId, domain), JSON.stringify(data));
}

function removeFile(sheetId: string, domain: CacheDomain): void {
  const file = cacheFile(sheetId, domain);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ---- struct（ヘッダー構造） ----

export function getStructure(sheetId: string): SheetStructure | null {
  return readJson<StructFile>(sheetId, "struct", { structure: null }).structure;
}

export function setStructure(sheetId: string, structure: SheetStructure): void {
  writeJson<StructFile>(sheetId, "struct", { structure });
}

// ---- nav（キュー index） ----

function readNav(sheetId: string): NavFile {
  return readJson<NavFile>(sheetId, "nav", { indexRows: 0, queueIndex: [] });
}

export function hasQueueIndex(sheetId: string, indexRows: number): boolean {
  const nav = readNav(sheetId);
  return nav.indexRows === indexRows && nav.queueIndex.length > 0;
}

export function saveQueueIndex(
  sheetId: string,
  records: QueueRecord[],
  indexRows: number
): void {
  writeJson<NavFile>(sheetId, "nav", { indexRows, queueIndex: records });
}

export function loadQueueIndex(sheetId: string): QueueRecord[] {
  return readNav(sheetId).queueIndex;
}

export function patchQueueIndex(
  sheetId: string,
  sheetRowNumber: number,
  status: string,
  assignee: string
): void {
  const nav = readNav(sheetId);
  const row = nav.queueIndex.find((r) => r.sheetRowNumber === sheetRowNumber);
  if (!row) return;
  if (status) row.status = status;
  if (assignee) row.assignee = assignee;
  writeJson<NavFile>(sheetId, "nav", nav);
}

// ---- rows（作業用の行データ） ----

function readRows(sheetId: string): RowsFile {
  return readJson<RowsFile>(sheetId, "rows", { rows: {} });
}

export function getRowValues(
  sheetId: string,
  sheetRowNumber: number
): string[] | null {
  return readRows(sheetId).rows[String(sheetRowNumber)] ?? null;
}

export function saveRowValues(
  sheetId: string,
  sheetRowNumber: number,
  values: string[]
): void {
  const f = readRows(sheetId);
  f.rows[String(sheetRowNumber)] = values;
  writeJson<RowsFile>(sheetId, "rows", f);
}

export function patchRowValues(
  sheetId: string,
  sheetRowNumber: number,
  uniqueHeaders: string[],
  updates: Record<string, string>
): void {
  const f = readRows(sheetId);
  const existing = f.rows[String(sheetRowNumber)];
  if (!existing) return;
  const padded = [...existing];
  while (padded.length < uniqueHeaders.length) padded.push("");
  for (const [uniqueName, value] of Object.entries(updates)) {
    const idx = uniqueHeaders.indexOf(uniqueName);
    if (idx >= 0) padded[idx] = value;
  }
  f.rows[String(sheetRowNumber)] = padded;
  writeJson<RowsFile>(sheetId, "rows", f);
}

// ---- wiki（正しいwiki 候補学習） ----

export function getWikiHistory(sheetId: string): WikiHistoryIndex | null {
  return readJson<WikiFile>(sheetId, "wiki", { wikiHistory: null }).wikiHistory;
}

export function hasWikiHistory(sheetId: string, indexRows: number): boolean {
  const history = getWikiHistory(sheetId);
  return Boolean(history && history.indexRows === indexRows);
}

export function saveWikiHistory(sheetId: string, index: WikiHistoryIndex): void {
  writeJson<WikiFile>(sheetId, "wiki", { wikiHistory: index });
}

// ---- meta（最終アクセス時刻） ----

export function getLastAccessAt(sheetId: string): number | null {
  return readJson<MetaFile>(sheetId, "meta", { lastAccessAt: null }).lastAccessAt;
}

export function touchLastAccessAt(
  sheetId: string,
  now: number = Date.now()
): void {
  writeJson<MetaFile>(sheetId, "meta", { lastAccessAt: now });
}

// ---- クリア（用途別／全体） ----

/** ナビ（キュー）用: 構造 + キュー index を削除（次回キュー構築で作り直す）。 */
export function clearNavCache(sheetId: string): void {
  removeFile(sheetId, "struct");
  removeFile(sheetId, "nav");
}

/** 作業用: 行データを破棄（行を開くと個別に再取得）。 */
export function clearRowsCache(sheetId: string): void {
  removeFile(sheetId, "rows");
}

/** 候補用: 正しいwiki 候補学習を破棄（次回候補表示で作り直す）。 */
export function clearWikiCache(sheetId: string): void {
  removeFile(sheetId, "wiki");
}

export function clearCache(sheetId: string): void {
  for (const domain of ALL_DOMAINS) removeFile(sheetId, domain);
  // 旧形式（単一バンドル）の残骸も掃除する。
  const legacy = path.join(cacheDir(), `${SPREADSHEET_ID}__${sheetId}.json`);
  if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
}

export function clearAllCaches(): void {
  for (const sheet of WORK_SHEETS) clearCache(sheet.id);
}

export function cacheStats(sheetId: string): {
  indexRowsCached: number;
  dataRowsCached: number;
  wikiHistoryEntries: number;
} {
  const nav = readNav(sheetId);
  const rows = readRows(sheetId);
  const wiki = getWikiHistory(sheetId);
  return {
    indexRowsCached: nav.queueIndex.length,
    dataRowsCached: Object.keys(rows.rows).length,
    wikiHistoryEntries: wiki?.entries.length ?? 0,
  };
}
