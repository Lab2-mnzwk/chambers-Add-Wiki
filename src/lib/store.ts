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

type CacheBundle = {
  structure: SheetStructure | null;
  indexRows: number;
  queueIndex: QueueRecord[];
  rows: Record<string, string[]>;
  wikiHistory: WikiHistoryIndex | null;
  /** 最終アクセス時刻（epoch ms）。アイドル判定に使用。未設定の旧キャッシュは null。 */
  lastAccessAt: number | null;
};

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

/** キャッシュファイル名はスプレッドシート ID + シート ID（両方のシートを別々に保持）。 */
function cacheFile(sheetId: string): string {
  return path.join(cacheDir(), `${SPREADSHEET_ID}__${sheetId}.json`);
}

function emptyBundle(): CacheBundle {
  return {
    structure: null,
    indexRows: 0,
    queueIndex: [],
    rows: {},
    wikiHistory: null,
    lastAccessAt: null,
  };
}

function readBundle(sheetId: string): CacheBundle {
  const file = cacheFile(sheetId);
  if (!fs.existsSync(file)) return emptyBundle();
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CacheBundle>;
  return {
    structure: parsed.structure ?? null,
    indexRows: parsed.indexRows ?? 0,
    queueIndex: parsed.queueIndex ?? [],
    rows: parsed.rows ?? {},
    wikiHistory: parsed.wikiHistory ?? null,
    lastAccessAt: parsed.lastAccessAt ?? null,
  };
}

function writeBundle(sheetId: string, bundle: CacheBundle): void {
  fs.writeFileSync(cacheFile(sheetId), JSON.stringify(bundle));
}

export function clearCache(sheetId: string): void {
  const file = cacheFile(sheetId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function clearAllCaches(): void {
  for (const sheet of WORK_SHEETS) clearCache(sheet.id);
}

/** 最終アクセス時刻（epoch ms）。キャッシュが無い・未設定なら null。 */
export function getLastAccessAt(sheetId: string): number | null {
  const file = cacheFile(sheetId);
  if (!fs.existsSync(file)) return null;
  return readBundle(sheetId).lastAccessAt;
}

/** 最終アクセス時刻を現在時刻で更新する（キャッシュが無ければ生成）。 */
export function touchLastAccessAt(sheetId: string, now: number = Date.now()): void {
  const bundle = readBundle(sheetId);
  bundle.lastAccessAt = now;
  writeBundle(sheetId, bundle);
}

export function cacheStats(sheetId: string): {
  indexRowsCached: number;
  dataRowsCached: number;
  wikiHistoryEntries: number;
} {
  const bundle = readBundle(sheetId);
  return {
    indexRowsCached: bundle.queueIndex.length,
    dataRowsCached: Object.keys(bundle.rows).length,
    wikiHistoryEntries: bundle.wikiHistory?.entries.length ?? 0,
  };
}

export function getStructure(sheetId: string): SheetStructure | null {
  return readBundle(sheetId).structure;
}

export function setStructure(sheetId: string, structure: SheetStructure): void {
  const bundle = readBundle(sheetId);
  bundle.structure = structure;
  writeBundle(sheetId, bundle);
}

export function hasQueueIndex(sheetId: string, indexRows: number): boolean {
  const bundle = readBundle(sheetId);
  return bundle.indexRows === indexRows && bundle.queueIndex.length > 0;
}

export function saveQueueIndex(
  sheetId: string,
  records: QueueRecord[],
  indexRows: number
): void {
  const bundle = readBundle(sheetId);
  bundle.queueIndex = records;
  bundle.indexRows = indexRows;
  writeBundle(sheetId, bundle);
}

export function loadQueueIndex(sheetId: string): QueueRecord[] {
  return readBundle(sheetId).queueIndex;
}

export function getRowValues(sheetId: string, sheetRowNumber: number): string[] | null {
  const bundle = readBundle(sheetId);
  return bundle.rows[String(sheetRowNumber)] ?? null;
}

export function saveRowValues(
  sheetId: string,
  sheetRowNumber: number,
  values: string[]
): void {
  const bundle = readBundle(sheetId);
  bundle.rows[String(sheetRowNumber)] = values;
  writeBundle(sheetId, bundle);
}

export function patchRowValues(
  sheetId: string,
  sheetRowNumber: number,
  uniqueHeaders: string[],
  updates: Record<string, string>
): void {
  const bundle = readBundle(sheetId);
  const existing = bundle.rows[String(sheetRowNumber)];
  if (!existing) return;
  const padded = [...existing];
  while (padded.length < uniqueHeaders.length) padded.push("");
  for (const [uniqueName, value] of Object.entries(updates)) {
    const idx = uniqueHeaders.indexOf(uniqueName);
    if (idx >= 0) padded[idx] = value;
  }
  bundle.rows[String(sheetRowNumber)] = padded;
  writeBundle(sheetId, bundle);
}

export function patchQueueIndex(
  sheetId: string,
  sheetRowNumber: number,
  status: string,
  assignee: string
): void {
  const bundle = readBundle(sheetId);
  const row = bundle.queueIndex.find((r) => r.sheetRowNumber === sheetRowNumber);
  if (!row) return;
  if (status) row.status = status;
  if (assignee) row.assignee = assignee;
  writeBundle(sheetId, bundle);
}

export function getWikiHistory(sheetId: string): WikiHistoryIndex | null {
  return readBundle(sheetId).wikiHistory;
}

export function hasWikiHistory(sheetId: string, indexRows: number): boolean {
  const history = readBundle(sheetId).wikiHistory;
  return Boolean(history && history.indexRows === indexRows);
}

export function saveWikiHistory(sheetId: string, index: WikiHistoryIndex): void {
  const bundle = readBundle(sheetId);
  bundle.wikiHistory = index;
  writeBundle(sheetId, bundle);
}
