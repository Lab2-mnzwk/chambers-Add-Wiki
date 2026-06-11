import type { SheetStructure } from "./types";
import { isCellEmpty, isHttpUrl, resolveHeaderToUnique } from "./columns";
import { WIKI_TRIPLET_RULES } from "./config";

export type WikiHistoryEntry = {
  name: string;
  wiki: string;
  correctWiki: string;
  count: number;
};

export type WikiHistorySuggestion = {
  correctWiki: string;
  name: string;
  wiki: string;
  match: "exact" | "name";
  count: number;
};

export type WikiHistoryIndex = {
  indexRows: number;
  builtAt: number;
  entries: WikiHistoryEntry[];
};

export function normalizeHistoryText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeHistoryWiki(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const path = decodeURIComponent(parsed.pathname).replace(/\/+$/, "");
    return `${parsed.hostname.toLowerCase()}${path}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function entryKey(name: string, wiki: string, correctWiki: string): string {
  return [
    normalizeHistoryText(name),
    normalizeHistoryWiki(wiki),
    normalizeHistoryWiki(correctWiki),
  ].join("\0");
}

/** 生データから重複を集計した履歴インデックスを作る */
export function aggregateWikiHistory(
  raw: Array<{ name: string; wiki: string; correctWiki: string }>,
  indexRows: number
): WikiHistoryIndex {
  const map = new Map<string, WikiHistoryEntry>();

  for (const row of raw) {
    const name = row.name.trim();
    const wiki = row.wiki.trim();
    const correctWiki = row.correctWiki.trim();
    if (!name || !wiki || !correctWiki) continue;
    if (!isHttpUrl(correctWiki)) continue;

    const key = entryKey(name, wiki, correctWiki);
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, { name, wiki, correctWiki, count: 1 });
    }
  }

  return {
    indexRows,
    builtAt: Date.now(),
    entries: [...map.values()].sort((a, b) => b.count - a.count),
  };
}

/** シート行データから正しいwiki が入っている三つ組だけ抽出 */
export function extractWikiHistoryFromRow(
  rowByUnique: Record<string, string>,
  rawHeaders: string[],
  uniqueHeaders: string[]
): Array<{ name: string; wiki: string; correctWiki: string }> {
  const headerMap = resolveHeaderToUnique(rawHeaders, uniqueHeaders);
  const found: Array<{ name: string; wiki: string; correctWiki: string }> = [];

  for (const [nameHeader, wikiHeader, okHeader] of WIKI_TRIPLET_RULES) {
    const nameUnique = headerMap[nameHeader];
    const wikiUnique = headerMap[wikiHeader];
    const okUnique = headerMap[okHeader];
    if (!nameUnique || !wikiUnique || !okUnique) continue;

    const name = String(rowByUnique[nameUnique] ?? "").trim();
    const wiki = String(rowByUnique[wikiUnique] ?? "").trim();
    const correctWiki = String(rowByUnique[okUnique] ?? "").trim();
    if (isCellEmpty(name) || isCellEmpty(wiki) || isCellEmpty(correctWiki)) continue;

    found.push({ name, wiki, correctWiki });
  }

  return found;
}

export function mergeWikiHistoryEntry(
  index: WikiHistoryIndex,
  name: string,
  wiki: string,
  correctWiki: string
): WikiHistoryIndex {
  const trimmedName = name.trim();
  const trimmedWiki = wiki.trim();
  const trimmedCorrect = correctWiki.trim();
  if (!trimmedName || !trimmedWiki || !trimmedCorrect || !isHttpUrl(trimmedCorrect)) {
    return index;
  }

  const key = entryKey(trimmedName, trimmedWiki, trimmedCorrect);
  const entries = [...index.entries];
  const existing = entries.find(
    (e) => entryKey(e.name, e.wiki, e.correctWiki) === key
  );
  if (existing) {
    existing.count += 1;
  } else {
    entries.push({
      name: trimmedName,
      wiki: trimmedWiki,
      correctWiki: trimmedCorrect,
      count: 1,
    });
  }
  entries.sort((a, b) => b.count - a.count);
  return { ...index, entries, builtAt: Date.now() };
}

/** 保存された正しいwiki 列だけ履歴にマージ */
export function mergeWikiHistoryFromSave(
  index: WikiHistoryIndex,
  rowByUnique: Record<string, string>,
  rawHeaders: string[],
  uniqueHeaders: string[],
  editedUniqueNames: Set<string>
): WikiHistoryIndex {
  const headerMap = resolveHeaderToUnique(rawHeaders, uniqueHeaders);
  let result = index;

  for (const [nameHeader, wikiHeader, okHeader] of WIKI_TRIPLET_RULES) {
    const okUnique = headerMap[okHeader];
    if (!okUnique || !editedUniqueNames.has(okUnique)) continue;

    const nameUnique = headerMap[nameHeader];
    const wikiUnique = headerMap[wikiHeader];
    if (!nameUnique || !wikiUnique) continue;

    const name = String(rowByUnique[nameUnique] ?? "").trim();
    const wiki = String(rowByUnique[wikiUnique] ?? "").trim();
    const correctWiki = String(rowByUnique[okUnique] ?? "").trim();
    result = mergeWikiHistoryEntry(result, name, wiki, correctWiki);
  }

  return result;
}

/** name + wiki に基づく候補（正しいwiki が過去に記録されたもののみ） */
export function suggestWikiHistory(
  index: WikiHistoryIndex,
  name: string,
  wiki: string,
  query = "",
  limit = 8
): WikiHistorySuggestion[] {
  const nameKey = normalizeHistoryText(name);
  const wikiKey = normalizeHistoryWiki(wiki);
  const queryKey = normalizeHistoryText(query);
  if (!nameKey) return [];

  const exact: WikiHistorySuggestion[] = [];
  const byName: WikiHistorySuggestion[] = [];
  const seenCorrect = new Set<string>();

  for (const entry of index.entries) {
    const entryNameKey = normalizeHistoryText(entry.name);
    if (entryNameKey !== nameKey) continue;

    const correctKey = normalizeHistoryWiki(entry.correctWiki);
    if (seenCorrect.has(correctKey)) continue;

    if (queryKey && !normalizeHistoryText(entry.correctWiki).includes(queryKey)) {
      continue;
    }

    const entryWikiKey = normalizeHistoryWiki(entry.wiki);
    const suggestion: WikiHistorySuggestion = {
      correctWiki: entry.correctWiki,
      name: entry.name,
      wiki: entry.wiki,
      match: entryWikiKey === wikiKey && wikiKey ? "exact" : "name",
      count: entry.count,
    };

    if (suggestion.match === "exact") {
      exact.push(suggestion);
    } else {
      byName.push(suggestion);
    }
    seenCorrect.add(correctKey);
  }

  exact.sort((a, b) => b.count - a.count);
  byName.sort((a, b) => b.count - a.count);

  return [...exact, ...byName].slice(0, limit);
}

export function wikiHistoryStats(index: WikiHistoryIndex): {
  entryCount: number;
  indexRows: number;
  builtAt: number;
} {
  return {
    entryCount: index.entries.length,
    indexRows: index.indexRows,
    builtAt: index.builtAt,
  };
}

/** 列構造から三つ組の unique 名リストを返す（Sheets 読取準備用） */
export function listWikiTripletColumns(structure: SheetStructure): Array<{
  nameUnique: string;
  wikiUnique: string;
  okUnique: string;
}> {
  const headerMap = resolveHeaderToUnique(
    structure.rawHeaders,
    structure.uniqueHeaders
  );
  const cols: Array<{ nameUnique: string; wikiUnique: string; okUnique: string }> =
    [];

  for (const [nameHeader, wikiHeader, okHeader] of WIKI_TRIPLET_RULES) {
    const nameUnique = headerMap[nameHeader];
    const wikiUnique = headerMap[wikiHeader];
    const okUnique = headerMap[okHeader];
    if (!nameUnique || !wikiUnique || !okUnique) continue;
    cols.push({ nameUnique, wikiUnique, okUnique });
  }
  return cols;
}
