export type QueueFilter =
  | "未担当＋自分担当"
  | "未担当"
  | "自分担当"
  | "すべて";

/** 進捗（作業 Status）によるキュー絞り込み。
 * all=すべて / incomplete=完了を除く（完了系を除外）/ notStarted=未着手のみ */
export type WorkStatusFilter = "all" | "incomplete" | "notStarted";

export type WorkOptions = {
  worker: string;
  queueFilter: QueueFilter;
  /** 進捗（作業 Status）によるキュー絞り込み（すべて/完了を除く/未着手のみ） */
  statusFilter: WorkStatusFilter;
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

/** Wiki 三つ組（名称 / deweyID / Wiki / 正しいwiki）の raw ヘッダー名。 */
export type WikiTriplet = {
  name: string;
  dewey: string | null;
  wiki: string;
  ok: string;
};

/**
 * 1 シートのヘッダーから構造検出した列ルール一式。
 * シートごとに命名・列数が違うため、グローバル定数ではなくシート単位で保持する。
 */
export type SheetRules = {
  rawHeaders: string[];
  uniqueHeaders: string[];
  /** rawHeader → uniqueName（最初の出現） */
  headerMap: Record<string, string>;
  triplets: WikiTriplet[];
  /** 三つ組の名称列 rawHeader 集合 */
  wikiNameHeaders: Set<string>;
  /** 名称列 rawHeader → deweyID 列 rawHeader */
  deweyByName: Record<string, string>;
  /** 作業対象（水色）列の uniqueName 集合（名称/Wiki/正しいwiki/memo/Status/Assignee） */
  lightBlueUnique: Set<string>;
  /** 三つ組すべての列（名称/deweyID/Wiki/正しいwiki）の uniqueName 集合 */
  tripletUnique: Set<string>;
  memoHeaders: string[];
  /** rawHeader → セクション名（Agent/Patient-Theme/Place/Territory） */
  sectionByHeader: Record<string, string>;
  statusUnique: string | null;
  assigneeUnique: string | null;
  assigneeHeader: string;
  /** 全列編集モードで表示する列インデックス（0 始まり） */
  fullDisplayIdx: Set<number>;
  /** 全列編集モードで自由入力可にする列インデックス（0 始まり） */
  fullEditableIdx: Set<number>;
};

export type QueueRow = {
  sheetRowNumber: number;
  renban: string;
  status: string;
  assignee: string;
};

/** 通しキュー上の 1 件（どのシートの何行目か）。 */
export type QueueEntry = {
  sheet: string;
  row: number;
};

export type ColumnPayload = {
  uniqueName: string;
  rawHeader: string;
  letter: string;
  display: string;
  value: string;
  inline: boolean;
  isStatus: boolean;
  isAssignee: boolean;
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
  sheet: string;
  sheetLabel: string;
  sheetRowNumber: number;
  summary: string;
  /** 出来事名（AC列＝ENTITY_NAME）。文脈検索のクエリに使用。 */
  eventName: string;
  assignee: string;
  columns: ColumnPayload[];
};

export type SheetInfo = {
  id: string;
  label: string;
  name: string;
};

export type BootstrapPayload = {
  authMode: "oauth" | "service_account";
  authRequired: boolean;
  /** authRequired 時に画面へ出す理由。未設定なら既定の再ログイン文言。 */
  authMessage?: string;
  userEmail: string | null;
  spreadsheetTitle: string;
  /** 対象シート一覧（通し順）。 */
  sheets: SheetInfo[];
  sheetUrl: string;
  discordNames: string[];
  /** アサインシートに無いが作業シートの Assignee 列に実在する担当名（表記ゆれ吸収用）。 */
  extraAssignees: string[];
  statusOptions: string[];
  defaultIndexRows: number;
  enableWrites: boolean;
};

export type SavePayload = {
  sheet: string;
  sheetRowNumber: number;
  worker: string;
  edits: Record<string, string>;
  queue: QueueEntry[];
  options: WorkOptions;
};

export type SaveResult = {
  savedCells: number;
  /** patch 反映後のキャッシュから再計算した最新の通しキュー */
  queue: QueueEntry[];
};
