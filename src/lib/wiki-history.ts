import type { SheetRules } from "./types";
import { isHttpUrl, tripletDeweyHasValue } from "./columns";
import { isDoneStatus } from "./config";

/** 「Wiki値そのまま正解（正しいWiki空欄）」を表す内部 correctWiki 値（空文字）。 */
export const BLANK_CORRECT_VALUE = "";

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

/**
 * 履歴候補として残す正しいwiki 値か。
 * URL に加え、「Wiki が誤りで該当なし」を表す `-` も候補対象にする。
 */
export function isHistoryCorrectWikiValue(value: string): boolean {
  const v = value.trim();
  return v === "-" || isHttpUrl(v);
}

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

export type WikiHistoryRawRow = {
  name: string;
  wiki: string;
  correctWiki: string;
  /** その行の作業 Status が完了系か（空欄正解＝WikiURL正しいの判定に使用）。 */
  done: boolean;
  /** deweyID 付与済みなら true。空欄正解は確認不要行のため学習しない。 */
  deweyHasValue: boolean;
};

/** 生データから重複を集計した履歴インデックスを作る */
export function aggregateWikiHistory(
  raw: WikiHistoryRawRow[],
  indexRows: number
): WikiHistoryIndex {
  const map = new Map<string, WikiHistoryEntry>();

  const upsert = (name: string, wiki: string, correctWiki: string) => {
    const key = entryKey(name, wiki, correctWiki);
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(key, { name, wiki, correctWiki, count: 1 });
    }
  };

  for (const row of raw) {
    const name = row.name.trim();
    const wiki = row.wiki.trim();
    const correctWiki = row.correctWiki.trim();
    if (!name || !wiki) continue;

    if (isHistoryCorrectWikiValue(correctWiki)) {
      // URL または「-」を正解として集計。
      upsert(name, wiki, correctWiki);
    } else if (correctWiki === "" && row.done && !row.deweyHasValue) {
      // 完了行で正しいWiki空欄 = 「WikiURL正しい」。deweyID 付与済みは確認対象外のため除外。
      upsert(name, wiki, BLANK_CORRECT_VALUE);
    }
  }

  return {
    indexRows,
    builtAt: Date.now(),
    entries: [...map.values()].sort((a, b) => b.count - a.count),
  };
}

function upsertHistoryEntry(
  index: WikiHistoryIndex,
  name: string,
  wiki: string,
  correctWiki: string
): WikiHistoryIndex {
  const key = entryKey(name, wiki, correctWiki);
  const entries = [...index.entries];
  const existing = entries.find(
    (e) => entryKey(e.name, e.wiki, e.correctWiki) === key
  );
  if (existing) {
    existing.count += 1;
  } else {
    entries.push({ name, wiki, correctWiki, count: 1 });
  }
  entries.sort((a, b) => b.count - a.count);
  return { ...index, entries, builtAt: Date.now() };
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
  if (
    !trimmedName ||
    !trimmedWiki ||
    !trimmedCorrect ||
    !isHistoryCorrectWikiValue(trimmedCorrect)
  ) {
    return index;
  }
  return upsertHistoryEntry(index, trimmedName, trimmedWiki, trimmedCorrect);
}

/** 完了行で正しいWiki空欄 =「Wiki値そのまま正解」を履歴へマージ */
export function mergeBlankCorrectEntry(
  index: WikiHistoryIndex,
  name: string,
  wiki: string
): WikiHistoryIndex {
  const trimmedName = name.trim();
  const trimmedWiki = wiki.trim();
  if (!trimmedName || !trimmedWiki) return index;
  return upsertHistoryEntry(index, trimmedName, trimmedWiki, BLANK_CORRECT_VALUE);
}

/** 保存された正しいwiki 列だけ履歴にマージ */
export function mergeWikiHistoryFromSave(
  index: WikiHistoryIndex,
  rules: SheetRules,
  rowByUnique: Record<string, string>,
  editedUniqueNames: Set<string>
): WikiHistoryIndex {
  const { headerMap } = rules;
  let result = index;

  // 今回の保存で作業 Status が完了系に変更されたか。完了確定時に、
  // 名称・Wiki があり正しいWiki空欄の三つ組を「Wiki値正しい」として学習する。
  const statusUnique = rules.statusUnique;
  const statusDoneNow =
    !!statusUnique &&
    editedUniqueNames.has(statusUnique) &&
    isDoneStatus(String(rowByUnique[statusUnique] ?? ""));

  for (const t of rules.triplets) {
    const okUnique = headerMap[t.ok];
    const nameUnique = headerMap[t.name];
    const wikiUnique = headerMap[t.wiki];
    if (!okUnique || !nameUnique || !wikiUnique) continue;

    const name = String(rowByUnique[nameUnique] ?? "").trim();
    const wiki = String(rowByUnique[wikiUnique] ?? "").trim();
    const correctWiki = String(rowByUnique[okUnique] ?? "").trim();

    if (editedUniqueNames.has(okUnique)) {
      result = mergeWikiHistoryEntry(result, name, wiki, correctWiki);
    }
    // 正しいWiki空欄のまま完了にした三つ組を学習（deweyID 付与済みは除外）。
    if (
      statusDoneNow &&
      name &&
      wiki &&
      correctWiki === "" &&
      !tripletDeweyHasValue(rules, t.name, rowByUnique)
    ) {
      result = mergeBlankCorrectEntry(result, name, wiki);
    }
  }

  return result;
}

/** 複数シートの履歴インデックスを 1 本に統合（同一 name/wiki/correctWiki は件数合算）。 */
export function combineWikiHistories(
  indexes: WikiHistoryIndex[]
): WikiHistoryIndex {
  const map = new Map<string, WikiHistoryEntry>();
  let indexRows = 0;
  for (const idx of indexes) {
    indexRows = Math.max(indexRows, idx.indexRows);
    for (const e of idx.entries) {
      const key = entryKey(e.name, e.wiki, e.correctWiki);
      const existing = map.get(key);
      if (existing) existing.count += e.count;
      else map.set(key, { ...e });
    }
  }
  return {
    indexRows,
    builtAt: Date.now(),
    entries: [...map.values()].sort((a, b) => b.count - a.count),
  };
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
