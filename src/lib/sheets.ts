import fs from "fs";
import { google, sheets_v4 } from "googleapis";
import path from "path";
import { isOAuthConfigured } from "@/auth";
import {
  ASSIGN_ALL_ROWS_NAME,
  ASSIGN_ALL_ROWS_SHEET_LABEL,
  ASSIGN_NAME_EXCLUDE,
  ASSIGN_SHEET_NAME,
  COL_ASSIGNEE,
  COL_STATUS_WORK,
  DISCORD_NAME_COLUMN,
  SHEET_NAME,
  SPREADSHEET_ID,
} from "./config";
import {
  columnLetter,
  effectiveColCount,
  makeUniqueHeaders,
  resolveWorkAssigneeUnique,
  resolveWorkStatusUnique,
} from "./columns";
import { requireGoogleAccessToken } from "./google-session";
import type { SheetStructure } from "./types";
import { listWikiTripletColumns } from "./wiki-history";

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

export async function loadSheetStructure(): Promise<SheetStructure> {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const title = meta.data.properties?.title ?? SPREADSHEET_ID;

  const sheetMeta = meta.data.sheets?.find(
    (s) => s.properties?.title === SHEET_NAME
  );
  const colCount = sheetMeta?.properties?.gridProperties?.columnCount ?? 1;

  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!1:1`,
  });
  const rawHeaders = (headerResp.data.values?.[0] ?? []).map((v) =>
    String(v ?? "")
  );
  const uniqueHeaders = makeUniqueHeaders(rawHeaders);

  return {
    title,
    rawHeaders,
    uniqueHeaders,
    colCount,
  };
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
  structure: SheetStructure,
  indexRows: number
): Promise<
  { sheetRowNumber: number; renban: string; status: string; assignee: string }[]
> {
  const sheets = await getSheets();
  const { rawHeaders, uniqueHeaders } = structure;
  const statusUnique =
    resolveWorkStatusUnique(rawHeaders, uniqueHeaders) ?? COL_STATUS_WORK;
  const assigneeUnique =
    resolveWorkAssigneeUnique(rawHeaders, uniqueHeaders) ?? COL_ASSIGNEE;
  const startRow = 2;
  const endRow = indexRows + 1;

  const ranges: string[] = [];
  const keys: string[] = [];
  for (const headerName of ["連番", statusUnique, assigneeUnique]) {
    const idx = uniqueHeaders.indexOf(headerName);
    if (idx < 0) continue;
    const letter = columnLetter(idx + 1);
    ranges.push(`'${SHEET_NAME}'!${letter}${startRow}:${letter}${endRow}`);
    keys.push(headerName);
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
      status: colData[statusUnique]?.[i] ?? "",
      assignee: colData[assigneeUnique]?.[i] ?? "",
    });
  }
  return records;
}

/** 正しいwiki が記入された三つ組だけ、インデックス行数ぶん一括読取 */
export async function fetchWikiHistoryFromSheet(
  structure: SheetStructure,
  indexRows: number
): Promise<Array<{ name: string; wiki: string; correctWiki: string }>> {
  const tripletCols = listWikiTripletColumns(structure);
  if (!tripletCols.length) return [];

  const sheets = await getSheets();
  const startRow = 2;
  const endRow = indexRows + 1;
  const ranges: string[] = [];

  for (const triplet of tripletCols) {
    for (const unique of [triplet.nameUnique, triplet.wikiUnique, triplet.okUnique]) {
      const idx = structure.uniqueHeaders.indexOf(unique);
      if (idx < 0) continue;
      const letter = columnLetter(idx + 1);
      ranges.push(`'${SHEET_NAME}'!${letter}${startRow}:${letter}${endRow}`);
    }
  }

  if (!ranges.length) return [];

  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges,
  });

  const results: Array<{ name: string; wiki: string; correctWiki: string }> = [];

  for (let t = 0; t < tripletCols.length; t++) {
    const base = t * 3;
    const nameCol = (batch.data.valueRanges?.[base]?.values ?? []).map((row) =>
      String(row[0] ?? "").trim()
    );
    const wikiCol = (batch.data.valueRanges?.[base + 1]?.values ?? []).map((row) =>
      String(row[0] ?? "").trim()
    );
    const okCol = (batch.data.valueRanges?.[base + 2]?.values ?? []).map((row) =>
      String(row[0] ?? "").trim()
    );
    const rowCount = Math.max(nameCol.length, wikiCol.length, okCol.length);

    for (let i = 0; i < rowCount; i++) {
      const name = nameCol[i] ?? "";
      const wiki = wikiCol[i] ?? "";
      const correctWiki = okCol[i] ?? "";
      if (!name || !wiki || !correctWiki) continue;
      results.push({ name, wiki, correctWiki });
    }
  }

  return results;
}

export async function fetchRowValues(
  structure: SheetStructure,
  sheetRowNumber: number
): Promise<string[]> {
  const sheets = await getSheets();
  const readCount = effectiveColCount(structure.colCount, structure.uniqueHeaders);
  const endCol = columnLetter(readCount);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A${sheetRowNumber}:${endCol}${sheetRowNumber}`,
  });
  return (resp.data.values?.[0] ?? []).map((v) => String(v ?? ""));
}

export async function executeWritePlan(
  plan: { cell: string; value: string }[]
): Promise<void> {
  if (!plan.length) return;
  const sheets = await getSheets();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: plan.map((item) => ({
        range: `'${SHEET_NAME}'!${item.cell}`,
        values: [[item.value]],
      })),
    },
  });
}
