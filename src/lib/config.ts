const DEFAULT_SPREADSHEET_ID = "1Mc3pX949vlO_uxWpimn7_DsUAYr87GmroqXft6fvB4I";

/** 環境変数から ID を取り出す（URL 貼り付け・空文字にも対応） */
export function resolveSpreadsheetId(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_SPREADSHEET_ID;

  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (fromUrl) return fromUrl;

  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;

  throw new Error(
    "SPREADSHEET_ID が不正です。ID のみ（例: 1Mc3pX949vlO_...）か Google スプレッドシート URL を設定してください。"
  );
}

export const SPREADSHEET_ID = resolveSpreadsheetId(process.env.SPREADSHEET_ID);
/** 画面上部に表示するスプレッドシート名（API のファイル名とは別に固定可） */
export const SPREADSHEET_DISPLAY_TITLE =
  process.env.SPREADSHEET_DISPLAY_TITLE ?? "PJ140_wiki付与_view_test";
export const SHEET_NAME = "wiki付与作業シート（第一弾）";
export const ASSIGN_SHEET_NAME = "アサイン";
export const DISCORD_NAME_COLUMN = "discord名";

export const COL_STATUS_WORK = "Status.1";
export const COL_ASSIGNEE = "Assignee";

export const ENABLE_SHEET_WRITES = process.env.ENABLE_SHEET_WRITES !== "false";

export const STATUS_NOT_STARTED = "未着手";
export const STATUS_DONE = "完了";
export const STATUS_NEEDS_REVIEW = "要確認";
export const WORK_STATUS_OPTIONS = [
  STATUS_NOT_STARTED,
  STATUS_DONE,
  STATUS_NEEDS_REVIEW,
] as const;

export const LEADING_COLUMN_PAIRS = [
  ["head_page", "tail_page"],
  ["通し番号", "連番"],
  ["STARTDATE", "ENDDATE"],
] as const;

export const LEADING_FIXED_HEADERS = LEADING_COLUMN_PAIRS.flat();

export const WORK_TABLE_START_HEADER = "ENTITY_NAME";
export const WORK_STATUS_COL_LETTER = "FG";
export const WORK_ASSIGNEE_COL_LETTER = "FH";
export const DEFAULT_INDEX_ROWS = 10000;
export const WRITE_DENYLIST_COL_LETTERS = new Set(["AE"]);

/** 全列表示・編集モード: 表示する列の範囲（列レター, 両端含む） */
export const FULL_EDIT_DISPLAY_RANGE: [string, string] = ["AN", "FT"];
/** 全列表示・編集モード: 自由入力で編集可能にする列レター範囲（両端含む） */
export const FULL_EDIT_COLUMN_RANGES: [string, string][] = [
  ["AN", "FD"],
  ["FJ", "FT"],
];

export const MEMO_WORK_HEADERS = [
  "Agent_memo",
  "Place_memo",
  "Patient-Theme_memo",
  "Territory_memo",
] as const;

export const MEMO_SECTION_BY_HEADER: Record<string, string> = {
  Agent_memo: "Agent",
  Place_memo: "Place",
  "Patient-Theme_memo": "Patient-Theme",
  Territory_memo: "Territory",
};

function buildLightBlueWorkHeaders(): Set<string> {
  const names = new Set<string>([
    "Agent_memo",
    "Place_memo",
    "Patient-Theme_memo",
    "Territory_memo",
  ]);
  for (let i = 1; i <= 5; i++) names.add(`A_name${i}`);
  for (let i = 6; i <= 8; i++) names.add(`A_${i}`);
  for (let i = 1; i <= 8; i++) {
    names.add(`A_Wiki${i}`);
    names.add(`A_正しいwiki${i}`);
  }
  for (let i = 1; i <= 5; i++) {
    names.add(`Pl_name${i}`);
    names.add(`Pl_Wiki${i}`);
    names.add(`Pl_正しいwiki${i}`);
  }
  for (let i = 1; i <= 7; i++) {
    names.add(`P-T_${i}`);
    names.add(`P-T_Wiki${i}`);
    names.add(`P-T_正しいwiki${i}`);
  }
  for (let i = 1; i <= 9; i++) {
    names.add(`Te_name${i}`);
    names.add(`Te_Wiki${i}`);
    names.add(`Te_正しいwiki${i}`);
  }
  return names;
}

export const LIGHT_BLUE_WORK_HEADERS = buildLightBlueWorkHeaders();

export function buildWikiTripletRules(): [string, string, string][] {
  const rules: [string, string, string][] = [];
  for (let i = 1; i <= 5; i++) {
    rules.push([`A_name${i}`, `A_Wiki${i}`, `A_正しいwiki${i}`]);
  }
  for (let i = 6; i <= 8; i++) {
    rules.push([`A_${i}`, `A_Wiki${i}`, `A_正しいwiki${i}`]);
  }
  for (let i = 1; i <= 5; i++) {
    rules.push([`Pl_name${i}`, `Pl_Wiki${i}`, `Pl_正しいwiki${i}`]);
  }
  for (let i = 1; i <= 7; i++) {
    rules.push([`P-T_${i}`, `P-T_Wiki${i}`, `P-T_正しいwiki${i}`]);
  }
  for (let i = 1; i <= 9; i++) {
    rules.push([`Te_name${i}`, `Te_Wiki${i}`, `Te_正しいwiki${i}`]);
  }
  return rules;
}

export const WIKI_TRIPLET_RULES = buildWikiTripletRules();

export function workSheetEditUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
}
