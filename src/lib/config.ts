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

/**
 * 作業対象シート（タブ）の定義。複数シートを 1 本の通しキューとして扱う。
 * 列レイアウト（三つ組の名称・個数・Status/Assignee 列名）はシートごとに異なるため、
 * 実際の列ルールは各シートのヘッダーから構造検出する（sheet-rules.ts）。
 * ここでは検出に必要な最小限（タブ名・表示名・担当列ヘッダー名）だけを持つ。
 */
export type SheetConfig = {
  /** URL/キャッシュキー等で使う安定 ID */
  id: string;
  /** スプレッドシート上のタブ名 */
  name: string;
  /** 画面表示用の短い名称 */
  label: string;
  /** 担当（Assignee）列のヘッダー名。作業 Status は「この列の直前の Status」で解決する。 */
  assigneeHeader: string;
};

/** キューの通し順（第一二弾 → 第三弾）。 */
export const WORK_SHEETS: SheetConfig[] = [
  {
    id: "s12",
    name: process.env.SHEET_NAME ?? "wiki付与作業シート（第一弾、第二弾）",
    label: "第一二弾",
    assigneeHeader: "Assignee",
  },
  {
    id: "s3",
    name: process.env.SHEET_NAME_3 ?? "wiki付与作業シート（第三弾）",
    label: "第三弾",
    assigneeHeader: "wiki付与Assignee",
  },
];

export const DEFAULT_SHEET: SheetConfig = WORK_SHEETS[0];

export function getSheetById(id: string | null | undefined): SheetConfig | null {
  if (!id) return null;
  return WORK_SHEETS.find((s) => s.id === id) ?? null;
}

export function getSheetByName(name: string): SheetConfig | null {
  return WORK_SHEETS.find((s) => s.name === name) ?? null;
}

/** 後方互換: 単一シート参照が残る箇所向けの既定タブ名。 */
export const SHEET_NAME = DEFAULT_SHEET.name;

export const ASSIGN_SHEET_NAME = process.env.ASSIGN_SHEET_NAME ?? "アサイン";
export const DISCORD_NAME_COLUMN = "discord名";
/** アサインシートの discord名 列に含まれる作業者以外の集計ラベル（作業者リストから除外） */
export const ASSIGN_NAME_EXCLUDE = ["合計", "端数チェック（総件数との差）"];
/** 作業者名の特別値: Assignee で絞らず全行をキューにする（ドロップダウン表示名） */
export const ASSIGN_ALL_ROWS_NAME = "全件表示";
/** アサインシート上の全件ラベル（表示名 ASSIGN_ALL_ROWS_NAME に変換） */
export const ASSIGN_ALL_ROWS_SHEET_LABEL = "全体";

/** 後方互換の既定 Status/Assignee ヘッダー名（実際は sheet-rules が解決）。 */
export const COL_STATUS_WORK = "Status.1";
export const COL_ASSIGNEE = "Assignee";

export const ENABLE_SHEET_WRITES = process.env.ENABLE_SHEET_WRITES !== "false";

/**
 * アクセスが空いた（アイドル）と判定する閾値（ミリ秒）。
 * 最終アクセスからこの時間以上経過した状態で次のアクセスがあると、
 * 起動時に全キャッシュをクリアしてシートから作り直す。
 * 既定 30 分。環境変数 IDLE_CACHE_CLEAR_MINUTES で分単位に上書き可。
 */
export const IDLE_CACHE_CLEAR_MS = (() => {
  const raw = Number(process.env.IDLE_CACHE_CLEAR_MINUTES);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : 30;
  return minutes * 60 * 1000;
})();

export const STATUS_NOT_STARTED = "未着手";
export const STATUS_DONE = "完了";
/** シート由来の完了バリエーション（正規化変更により完了扱い） */
export const STATUS_DONE_NORMALIZED = "完了（正規化変更）";
export const STATUS_NEEDS_REVIEW = "要確認";
export const WORK_STATUS_OPTIONS = [
  STATUS_NOT_STARTED,
  STATUS_DONE,
  STATUS_DONE_NORMALIZED,
  STATUS_NEEDS_REVIEW,
] as const;

/** 完了とみなすステータス（「完了をスキップ」の対象）。 */
export const DONE_STATUSES: readonly string[] = [
  STATUS_DONE,
  STATUS_DONE_NORMALIZED,
];

/** ステータスが完了系（「完了」または「完了（正規化変更）」）か。 */
export function isDoneStatus(status: string): boolean {
  return DONE_STATUSES.includes(status.trim());
}

export const LEADING_COLUMN_PAIRS = [
  ["head_page", "tail_page"],
  ["通し番号", "連番"],
  ["STARTDATE", "ENDDATE"],
] as const;

export const LEADING_FIXED_HEADERS = LEADING_COLUMN_PAIRS.flat();

export const WORK_TABLE_START_HEADER = "ENTITY_NAME";

/** 三つ組のカテゴリ見出し列（構造検出でセクション対応付けに使用）。両シート共通。 */
export const SECTION_HEADERS = [
  "Agent",
  "Patient-Theme",
  "Place",
  "Territory",
] as const;

/** 役割列（全列編集モードで自由入力可にする）。両シート共通。 */
export const ROLE_HEADERS = [
  "Action",
  "Instrument",
  "Manner",
  "Cause",
  "Purpose",
  "Probability",
] as const;

/** memo 列ヘッダーの接尾辞。 */
export const MEMO_HEADER_SUFFIX = "_memo";

/**
 * キュー index / Wiki 履歴で読み取る最大データ行数（2行目以降）。
 * 各シートの全行をカバーする必要があるため、行数増加に備え環境変数 DEFAULT_INDEX_ROWS で上書き可能。
 * 既定 30000（各シートの総行数を包含）。
 */
export const DEFAULT_INDEX_ROWS = (() => {
  const raw = Number(process.env.DEFAULT_INDEX_ROWS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30000;
})();
export const WRITE_DENYLIST_COL_LETTERS = new Set(["AE"]);

export function workSheetEditUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
}
