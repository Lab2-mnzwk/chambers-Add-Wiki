export type QueueFilter =
  | "未担当＋自分担当"
  | "未担当"
  | "自分担当"
  | "すべて";

export type WorkOptions = {
  worker: string;
  queueFilter: QueueFilter;
  skipDone: boolean;
  lightBlueOnly: boolean;
  /** 作業対象列＋名称に値がある三つ組を丸ごと表示する排他モード */
  showNamedTriplets: boolean;
  fullEditMode: boolean;
  indexRows: number;
};

export type SheetStructure = {
  title: string;
  rawHeaders: string[];
  uniqueHeaders: string[];
  colCount: number;
};

export type QueueRow = {
  sheetRowNumber: number;
  renban: string;
  status: string;
  assignee: string;
};

export type ColumnPayload = {
  uniqueName: string;
  rawHeader: string;
  letter: string;
  display: string;
  value: string;
  inline: boolean;
  isStatus: boolean;
  isMemo: boolean;
  isWiki: boolean;
  isWikiEdit: boolean;
  isWikiName: boolean;
  isLeading: boolean;
  /** 正しいwiki 列用: 対応する name 列の値 */
  tripletName: string;
  /** 正しいwiki 列用: 対応する wiki 列の値 */
  tripletWiki: string;
  /** 正しいwiki 列用: 対応する deweyID 列に値があるか（確認不要） */
  tripletDeweyHasValue: boolean;
};

export type RowPayload = {
  sheetRowNumber: number;
  summary: string;
  assignee: string;
  columns: ColumnPayload[];
};

export type BootstrapPayload = {
  authMode: "oauth" | "service_account";
  authRequired: boolean;
  userEmail: string | null;
  spreadsheetTitle: string;
  sheetName: string;
  sheetUrl: string;
  discordNames: string[];
  statusOptions: string[];
  defaultIndexRows: number;
  enableWrites: boolean;
};

export type SavePayload = {
  sheetRowNumber: number;
  worker: string;
  edits: Record<string, string>;
  queueSheetRows: number[];
  options: WorkOptions;
};

export type SaveResult = {
  savedCells: number;
  nextSheetRowNumber: number | null;
  atEnd: boolean;
  /** patch 反映後のキャッシュから再計算した最新キュー（行番号昇順） */
  queueSheetRows: number[];
};
