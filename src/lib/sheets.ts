import fs from "fs";
import { google, sheets_v4 } from "googleapis";
import path from "path";
import { isOAuthConfigured } from "@/auth";
import {
  ASSIGN_ALL_ROWS_NAME,
  ASSIGN_ALL_ROWS_SHEET_LABEL,
  ASSIGN_NAME_EXCLUDE,
  ASSIGN_SHEET_NAME,
  DISCORD_NAME_COLUMN,
  isDoneStatus,
  SPREADSHEET_ID,
  type SheetConfig,
} from "./config";
import {
  columnLetter,
  deweyCellHasValue,
  effectiveColCount,
  makeUniqueHeaders,
} from "./columns";
import { requireGoogleAccessToken } from "./google-session";
import type { SheetRules, SheetStructure } from "./types";
import type { WikiHistoryRawRow } from "./wiki-history";

let serviceAccountSheets: sheets_v4.Sheets | null = null;

function getServiceAccountCredentials(): Record<string, unknown> {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json) {
    return JSON.parse(json) as Record<string, unknown>;
  }
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(process.cwd(), "service_account.json"),
    path.join(process.cwd(), "credentials", "service_account.json"),
  ].filter(Boolean) as string[];

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    }
  }
  throw new Error(
    "GOOGLE_SERVICE_ACCOUNT_JSON または service_account.json が見つかりません。"
  );
}

export function hasServiceAccountCredentials(): boolean {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return true;
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(process.cwd(), "service_account.json"),
    path.join(process.cwd(), "credentials", "service_account.json"),
  ].filter(Boolean) as string[];

  return candidates.some((file) => fs.existsSync(file));
}

async function getSheets(): Promise<sheets_v4.Sheets> {
  if (isOAuthConfigured()) {
    const accessToken = await requireGoogleAccessToken();
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2.setCredentials({ access_token: accessToken });
    return google.sheets({ version: "v4", auth: oauth2 });
  }

  if (!serviceAccountSheets) {
    const auth = new google.auth.GoogleAuth({
      credentials: getServiceAccountCredentials(),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    serviceAccountSheets = google.sheets({ version: "v4", auth });
  }
  return serviceAccountSheets;
}

export async function loadSheetStructure(
  sheet: SheetConfig
): Promise<SheetStructure> {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const title = meta.data.properties?.title ?? SPREADSHEET_ID;

  const sheetMeta = meta.data.sheets?.find(
    (s) => s.properties?.title === sheet.name
  );
  const colCount = sheetMeta?.properties?.gridProperties?.columnCount ?? 1;

  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheet.name}'!1:1`,
  });
  const rawHeaders = (headerResp.data.values?.[0] ?? []).map((v) =>
    String(v ?? "")
  );
  const uniqueHeaders = makeUniqueHeaders(rawHeaders);

  return { title, rawHeaders, uniqueHeaders, colCount };
}

export async function loadAssignDiscordNames(): Promise<string[]> {
  const sheets = await getSheets();
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${ASSIGN_SHEET_NAME}'!1:1`,
  });
  const headers = headerResp.data.values?.[0] ?? [];
  const colIndex = headers.indexOf(DISCORD_NAME_COLUMN);
  if (colIndex < 0) return [];

  const colLetter = columnLetter(colIndex + 1);
  const valuesResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${ASSIGN_SHEET_NAME}'!${colLetter}2:${colLetter}`,
  });
  const excluded = new Set(ASSIGN_NAME_EXCLUDE);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of valuesResp.data.values ?? []) {
    const raw = String(row[0] ?? "").trim();
    const name = raw === ASSIGN_ALL_ROWS_SHEET_LABEL ? ASSIGN_ALL_ROWS_NAME : raw;
    if (name && !seen.has(name) && !excluded.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

export async function fetchQueueIndex(
  sheet: SheetConfig,
  rules: SheetRules,
  indexRows: number
): Promise<
  { sheetRowNumber: number; renban: string; status: string; assignee: string }[]
> {
  const sheets = await getSheets();
  const { uniqueHeaders } = rules;
  const startRow = 2;
  const endRow = indexRows + 1;

  const ranges: string[] = [];
  const keys: string[] = [];
  const cols: Array<[string, string | null]> = [
    ["連番", "連番"],
    ["status", rules.statusUnique],
    ["assignee", rules.assigneeUnique],
  ];
  for (const [key, headerName] of cols) {
    if (!headerName) continue;
    const idx = uniqueHeaders.indexOf(headerName);
    if (idx < 0) continue;
    const letter = columnLetter(idx + 1);
    ranges.push(`'${sheet.name}'!${letter}${startRow}:${letter}${endRow}`);
    keys.push(key);
  }

  if (!ranges.length) return [];

  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges,
  });

  const colData: Record<string, string[]> = {};
  (batch.data.valueRanges ?? []).forEach((vr, i) => {
    const flat = (vr.values ?? []).map((row) => String(row[0] ?? ""));
    colData[keys[i]] = flat;
  });

  const rowCount = Math.max(...Object.values(colData).map((v) => v.length), 0);
  const records: {
    sheetRowNumber: number;
    renban: string;
    status: string;
    assignee: string;
  }[] = [];

  for (let i = 0; i < rowCount; i++) {
    records.push({
      sheetRowNumber: startRow + i,
      renban: colData["連番"]?.[i] ?? "",
      status: colData["status"]?.[i] ?? "",
      assignee: colData["assignee"]?.[i] ?? "",
    });
  }
  return records;
}

/** 正しいwiki / 空欄正解学習用に三つ組列＋deweyID 列を、インデックス行数ぶん一括読取 */
export async function fetchWikiHistoryFromSheet(
  sheet: SheetConfig,
  rules: SheetRules,
  indexRows: number
): Promise<WikiHistoryRawRow[]> {
  const { headerMap, uniqueHeaders } = rules;
  const startRow = 2;
  const endRow = indexRows + 1;
  const ranges: string[] = [];
  type TripletRange = {
    nameIdx: number;
    wikiIdx: number;
    okIdx: number;
    deweyIdx: number | null;
  };
  const tripletRanges: TripletRange[] = [];

  const pushRange = (unique: string | undefined): number => {
    if (!unique) return -1;
    const idx = uniqueHeaders.indexOf(unique);
    if (idx < 0) return -1;
    const letter = columnLetter(idx + 1);
    ranges.push(`'${sheet.name}'!${letter}${startRow}:${letter}${endRow}`);
    return ranges.length - 1;
  };

  for (const t of rules.triplets) {
    const nameUnique = headerMap[t.name];
    const wikiUnique = headerMap[t.wiki];
    const okUnique = headerMap[t.ok];
    if (!nameUnique || !wikiUnique || !okUnique) continue;

    const nameIdx = pushRange(nameUnique);
    const wikiIdx = pushRange(wikiUnique);
    const okIdx = pushRange(okUnique);
    if (nameIdx < 0 || wikiIdx < 0 || okIdx < 0) continue;

    const deweyUnique = t.dewey ? headerMap[t.dewey] : undefined;
    const deweyIdx = deweyUnique ? pushRange(deweyUnique) : null;

    tripletRanges.push({ nameIdx, wikiIdx, okIdx, deweyIdx });
  }

  if (!ranges.length) return [];

  const sheets = await getSheets();

  // 「完了行で正しいWiki空欄 = Wiki欄変更不要」の判定用に作業 Status 列も読む。
  let statusRangeIndex = -1;
  if (rules.statusUnique) {
    const sIdx = uniqueHeaders.indexOf(rules.statusUnique);
    if (sIdx >= 0) {
      const letter = columnLetter(sIdx + 1);
      statusRangeIndex = ranges.length;
      ranges.push(`'${sheet.name}'!${letter}${startRow}:${letter}${endRow}`);
    }
  }

  // レンジ数 × 行数が大きいと単一 batchGet が応答過大・タイムアウトで 500 になるため、
  // レンジを分割して複数回 batchGet し、元の順序で valueRanges を結合する。
  const BATCH_RANGE_CHUNK = 20;
  const valueRanges: sheets_v4.Schema$ValueRange[] = [];
  for (let i = 0; i < ranges.length; i += BATCH_RANGE_CHUNK) {
    const chunk = ranges.slice(i, i + BATCH_RANGE_CHUNK);
    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges: chunk,
    });
    valueRanges.push(...(batch.data.valueRanges ?? []));
  }

  const colAt = (idx: number): string[] =>
    (valueRanges[idx]?.values ?? []).map((row) => String(row[0] ?? "").trim());

  const statusCol = statusRangeIndex >= 0 ? colAt(statusRangeIndex) : [];

  const results: WikiHistoryRawRow[] = [];

  for (const { nameIdx, wikiIdx, okIdx, deweyIdx } of tripletRanges) {
    const nameCol = colAt(nameIdx);
    const wikiCol = colAt(wikiIdx);
    const okCol = colAt(okIdx);
    const deweyCol = deweyIdx != null ? colAt(deweyIdx) : [];
    const rowCount = Math.max(
      nameCol.length,
      wikiCol.length,
      okCol.length,
      deweyCol.length
    );

    for (let i = 0; i < rowCount; i++) {
      const name = nameCol[i] ?? "";
      const wiki = wikiCol[i] ?? "";
      const correctWiki = okCol[i] ?? "";
      if (!name || !wiki) continue;
      const done = isDoneStatus(statusCol[i] ?? "");
      const deweyHasValue = deweyCellHasValue(deweyCol[i] ?? "");
      if (correctWiki === "" && !done) continue;
      results.push({ name, wiki, correctWiki, done, deweyHasValue });
    }
  }

  return results;
}

/** 作業 Status 列の1セルのみ取得（移動探索用）。 */
export async function fetchRowStatus(
  sheet: SheetConfig,
  rules: SheetRules,
  sheetRowNumber: number
): Promise<string> {
  if (!rules.statusUnique) return "";
  const idx = rules.uniqueHeaders.indexOf(rules.statusUnique);
  if (idx < 0) return "";
  const sheets = await getSheets();
  const letter = columnLetter(idx + 1);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheet.name}'!${letter}${sheetRowNumber}:${letter}${sheetRowNumber}`,
  });
  return String(resp.data.values?.[0]?.[0] ?? "").trim();
}

/**
 * 複数行の作業 Status を **1 リクエスト**（batchGet 複数レンジ）で取得（移動探索の先読み用）。
 * レンジ数が多い場合はチャンク分割して複数回に分ける。
 */
export async function fetchRowStatuses(
  sheet: SheetConfig,
  rules: SheetRules,
  rowNumbers: number[]
): Promise<Record<number, string>> {
  const result: Record<number, string> = {};
  if (!rules.statusUnique || !rowNumbers.length) return result;
  const idx = rules.uniqueHeaders.indexOf(rules.statusUnique);
  if (idx < 0) return result;
  const letter = columnLetter(idx + 1);
  const sheets = await getSheets();

  const RANGE_CHUNK = 200;
  for (let i = 0; i < rowNumbers.length; i += RANGE_CHUNK) {
    const chunk = rowNumbers.slice(i, i + RANGE_CHUNK);
    const ranges = chunk.map(
      (r) => `'${sheet.name}'!${letter}${r}:${letter}${r}`
    );
    const batch = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges,
    });
    (batch.data.valueRanges ?? []).forEach((vr, j) => {
      result[chunk[j]] = String(vr.values?.[0]?.[0] ?? "").trim();
    });
  }
  return result;
}

export async function fetchRowValues(
  sheet: SheetConfig,
  structure: SheetStructure,
  sheetRowNumber: number
): Promise<string[]> {
  const sheets = await getSheets();
  const readCount = effectiveColCount(structure.colCount, structure.uniqueHeaders);
  const endCol = columnLetter(readCount);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheet.name}'!A${sheetRowNumber}:${endCol}${sheetRowNumber}`,
  });
  return (resp.data.values?.[0] ?? []).map((v) => String(v ?? ""));
}

export async function executeWritePlan(
  sheet: SheetConfig,
  plan: { cell: string; value: string }[]
): Promise<void> {
  if (!plan.length) return;
  const sheets = await getSheets();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: plan.map((item) => ({
        range: `'${sheet.name}'!${item.cell}`,
        values: [[item.value]],
      })),
    },
  });
}
