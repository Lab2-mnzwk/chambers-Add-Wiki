import fs from "fs";
import path from "path";
import { SPREADSHEET_ID } from "./config";
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

function cacheFile(): string {
  return path.join(cacheDir(), `${SPREADSHEET_ID}.json`);
}

function readBundle(): CacheBundle {
  const file = cacheFile();
  if (!fs.existsSync(file)) {
    return {
      structure: null,
      indexRows: 0,
      queueIndex: [],
      rows: {},
      wikiHistory: null,
      lastAccessAt: null,
    };
  }
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

function writeBundle(bundle: CacheBundle): void {
  fs.writeFileSync(cacheFile(), JSON.stringify(bundle));
}

export function clearCache(): void {
  const file = cacheFile();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** 最終アクセス時刻（epoch ms）。キャッシュが無い・未設定なら null。 */
export function getLastAccessAt(): number | null {
  const file = cacheFile();
  if (!fs.existsSync(file)) return null;
  return readBundle().lastAccessAt;
}

/** 最終アクセス時刻を現在時刻で更新する（キャッシュが無ければ生成）。 */
export function touchLastAccessAt(now: number = Date.now()): void {
  const bundle = readBundle();
  bundle.lastAccessAt = now;
  writeBundle(bundle);
}

export function cacheStats(): {
  indexRowsCached: number;
  dataRowsCached: number;
  wikiHistoryEntries: number;
} {
  const bundle = readBundle();
  return {
    indexRowsCached: bundle.queueIndex.length,
    dataRowsCached: Object.keys(bundle.rows).length,
    wikiHistoryEntries: bundle.wikiHistory?.entries.length ?? 0,
  };
}

export function getStructure(): SheetStructure | null {
  return readBundle().structure;
}

export function setStructure(structure: SheetStructure): void {
  const bundle = readBundle();
  bundle.structure = structure;
  writeBundle(bundle);
}

export function hasQueueIndex(indexRows: number): boolean {
  const bundle = readBundle();
  return bundle.indexRows === indexRows && bundle.queueIndex.length > 0;
}

export function saveQueueIndex(records: QueueRecord[], indexRows: number): void {
  const bundle = readBundle();
  bundle.queueIndex = records;
  bundle.indexRows = indexRows;
  writeBundle(bundle);
}

export function loadQueueIndex(): QueueRecord[] {
  return readBundle().queueIndex;
}

export function getRowValues(sheetRowNumber: number): string[] | null {
  const bundle = readBundle();
  return bundle.rows[String(sheetRowNumber)] ?? null;
}

export function saveRowValues(sheetRowNumber: number, values: string[]): void {
  const bundle = readBundle();
  bundle.rows[String(sheetRowNumber)] = values;
  writeBundle(bundle);
}

export function patchRowValues(
  sheetRowNumber: number,
  uniqueHeaders: string[],
  updates: Record<string, string>
): void {
  const existing = getRowValues(sheetRowNumber);
  if (!existing) return;
  const padded = [...existing];
  while (padded.length < uniqueHeaders.length) padded.push("");
  for (const [uniqueName, value] of Object.entries(updates)) {
    const idx = uniqueHeaders.indexOf(uniqueName);
    if (idx >= 0) padded[idx] = value;
  }
  saveRowValues(sheetRowNumber, padded);
}

export function patchQueueIndex(
  sheetRowNumber: number,
  status: string,
  assignee: string
): void {
  const bundle = readBundle();
  const row = bundle.queueIndex.find((r) => r.sheetRowNumber === sheetRowNumber);
  if (!row) return;
  if (status) row.status = status;
  if (assignee) row.assignee = assignee;
  writeBundle(bundle);
}

export function getWikiHistory(): WikiHistoryIndex | null {
  return readBundle().wikiHistory;
}

export function hasWikiHistory(indexRows: number): boolean {
  const history = readBundle().wikiHistory;
  return Boolean(history && history.indexRows === indexRows);
}

export function saveWikiHistory(index: WikiHistoryIndex): void {
  const bundle = readBundle();
  bundle.wikiHistory = index;
  writeBundle(bundle);
}
