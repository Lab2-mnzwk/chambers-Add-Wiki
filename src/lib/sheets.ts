import fs from "fs";
import { AsyncLocalStorage } from "async_hooks";
import { sign } from "crypto";
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

type GoogleValueRange = { range?: string; values?: unknown[][] };
type GoogleBatchGetResponse = { valueRanges?: GoogleValueRange[] };
type ServiceAccountCredentials = {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

let serviceTokenCache: { accessToken: string; expiresAt: number } | null = null;
const requestAccessToken = new AsyncLocalStorage<string>();

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

async function getServiceAccountAccessToken(): Promise<string> {
  if (serviceTokenCache && Date.now() < serviceTokenCache.expiresAt - 60_000) {
    return serviceTokenCache.accessToken;
  }
  const credentials = getServiceAccountCredentials() as ServiceAccountCredentials;
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("サービスアカウントの client_email / private_key が不足しています。");
  }
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = credentials.token_uri ?? "https://oauth2.googleapis.com/token";
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(unsigned),
    credentials.private_key
  ).toString("base64url");
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new Error(
      `Googleサービスアカウント認証に失敗しました: ${
        data.error_description ?? response.status
      }`
    );
  }
  serviceTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

async function getAccessToken(): Promise<string> {
  return isOAuthConfigured()
    ? requireGoogleAccessToken()
    : getServiceAccountAccessToken();
}

/** 統合API内の並列Sheets操作で認証・Cookie/JWT解析を1回だけ共有する。 */
export async function withSheetsAccessToken<T>(work: () => Promise<T>): Promise<T> {
  const existing = requestAccessToken.getStore();
  if (existing) return work();
  const token = await getAccessToken();
  return requestAccessToken.run(token, work);
}

async function sheetsFetch<T>(
  pathAndQuery: string,
  init: RequestInit = {},
  accessToken?: string
): Promise<T> {
  const token =
    accessToken ?? requestAccessToken.getStore() ?? (await getAccessToken());
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch(`https://sheets.googleapis.com/v4/${pathAndQuery}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (response.ok) return (await response.json()) as T;
    if (![429, 503].includes(response.status) || attempt > 0) break;
    const retryAfter = Number(response.headers.get("retry-after") ?? 0);
    await new Promise((resolve) =>
      setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 300 + Math.random() * 300)
    );
  }
  const text = await response!.text();
  let message = text;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    message = parsed.error?.message ?? text;
  } catch {
    // 非JSONエラーは本文をそのまま利用。
  }
  throw new Error(`Google Sheets API ${response!.status}: ${message}`);
}

function valuesPath(range: string): string {
  return `spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;
}

async function getValues(
  range: string,
  accessToken?: string
): Promise<GoogleValueRange> {
  return sheetsFetch<GoogleValueRange>(valuesPath(range), {}, accessToken);
}

async function batchGetValues(
  ranges: string[],
  accessToken?: string
): Promise<GoogleBatchGetResponse> {
  const query = new URLSearchParams();
  for (const range of ranges) query.append("ranges", range);
  return sheetsFetch<GoogleBatchGetResponse>(
    `spreadsheets/${SPREADSHEET_ID}/values:batchGet?${query}`,
    {},
    accessToken
  );
}

export async function loadSheetStructure(
  sheet: SheetConfig
): Promise<SheetStructure> {
  const accessToken = await getAccessToken();
  const meta = await sheetsFetch<{
    properties?: { title?: string };
    sheets?: { properties?: { title?: string; gridProperties?: { columnCount?: number } } }[];
  }>(
    `spreadsheets/${SPREADSHEET_ID}?fields=properties.title,sheets.properties(title,gridProperties.columnCount)`,
    {},
    accessToken
  );
  const title = meta.properties?.title ?? SPREADSHEET_ID;
  const sheetMeta = meta.sheets?.find(
    (s) => s.properties?.title === sheet.name
  );
  const colCount = sheetMeta?.properties?.gridProperties?.columnCount ?? 1;
  const headerResp = await getValues(`'${sheet.name}'!1:1`, accessToken);
  const rawHeaders = (headerResp.values?.[0] ?? []).map((v) =>
    String(v ?? "")
  );
  const uniqueHeaders = makeUniqueHeaders(rawHeaders);

  return { title, rawHeaders, uniqueHeaders, colCount };
}

export async function loadAssignDiscordNames(): Promise<string[]> {
  const accessToken = await getAccessToken();
  const headerResp = await getValues(`'${ASSIGN_SHEET_NAME}'!1:1`, accessToken);
  const headers = headerResp.values?.[0] ?? [];
  const colIndex = headers.indexOf(DISCORD_NAME_COLUMN);
  if (colIndex < 0) return [];

  const colLetter = columnLetter(colIndex + 1);
  const valuesResp = await getValues(
    `'${ASSIGN_SHEET_NAME}'!${colLetter}2:${colLetter}`,
    accessToken
  );
  const excluded = new Set(ASSIGN_NAME_EXCLUDE);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of valuesResp.values ?? []) {
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

  const batch = await batchGetValues(ranges);

  const colData: Record<string, string[]> = {};
  (batch.valueRanges ?? []).forEach((vr, i) => {
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
  const valueRanges: GoogleValueRange[] = [];
  const accessToken = await getAccessToken();
  for (let i = 0; i < ranges.length; i += BATCH_RANGE_CHUNK) {
    const chunk = ranges.slice(i, i + BATCH_RANGE_CHUNK);
    const batch = await batchGetValues(chunk, accessToken);
    valueRanges.push(...(batch.valueRanges ?? []));
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
  const letter = columnLetter(idx + 1);
  const resp = await getValues(
    `'${sheet.name}'!${letter}${sheetRowNumber}:${letter}${sheetRowNumber}`
  );
  return String(resp.values?.[0]?.[0] ?? "").trim();
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
  const RANGE_CHUNK = 200;
  const accessToken = await getAccessToken();
  for (let i = 0; i < rowNumbers.length; i += RANGE_CHUNK) {
    const chunk = rowNumbers.slice(i, i + RANGE_CHUNK);
    const ranges = chunk.map(
      (r) => `'${sheet.name}'!${letter}${r}:${letter}${r}`
    );
    const batch = await batchGetValues(ranges, accessToken);
    (batch.valueRanges ?? []).forEach((vr, j) => {
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
  const readCount = effectiveColCount(structure.colCount, structure.uniqueHeaders);
  const endCol = columnLetter(readCount);
  const resp = await getValues(
    `'${sheet.name}'!A${sheetRowNumber}:${endCol}${sheetRowNumber}`
  );
  return (resp.values?.[0] ?? []).map((v) => String(v ?? ""));
}

/**
 * 移動候補の行全体を Sheets API の 1 回の batchGet で取得する。
 * Status 探索と着地行取得を同じ応答で完結させ、直列 2 リクエストを避ける。
 */
export async function fetchCandidateRowValues(
  targets: {
    sheet: SheetConfig;
    structure: SheetStructure;
    sheetRowNumber: number;
  }[]
): Promise<Record<string, string[]>> {
  if (!targets.length) return {};
  const ranges = targets.map(({ sheet, structure, sheetRowNumber }) => {
    const readCount = effectiveColCount(structure.colCount, structure.uniqueHeaders);
    const endCol = columnLetter(readCount);
    return `'${sheet.name}'!A${sheetRowNumber}:${endCol}${sheetRowNumber}`;
  });
  const response = await batchGetValues(ranges);
  const result: Record<string, string[]> = {};
  targets.forEach(({ sheet, sheetRowNumber }, index) => {
    result[`${sheet.id}#${sheetRowNumber}`] = (
      response.valueRanges?.[index]?.values?.[0] ?? []
    ).map((value) => String(value ?? ""));
  });
  return result;
}

export async function executeWritePlan(
  sheet: SheetConfig,
  plan: { cell: string; value: string }[]
): Promise<void> {
  if (!plan.length) return;
  await sheetsFetch(`spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: plan.map((item) => ({
        range: `'${sheet.name}'!${item.cell}`,
        values: [[item.value]],
      })),
    }),
  });
}
