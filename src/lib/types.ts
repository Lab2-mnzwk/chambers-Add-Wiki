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

/** API転送用の圧縮キュー。シートIDを行ごとに繰り返さない。 */
export type CompactQueue = Array<[sheet: string, rows: number[]]>;

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

/** 保存時のWiki候補学習に必要な最小スナップショット（行全体の再取得を避ける）。 */
export type WikiLearningSnapshot = {
  correctUniqueName: string;
  nameUniqueName: string;
  wikiUniqueName: string;
  deweyUniqueName: string | null;
  name: string;
  wiki: string;
  correctWiki: string;
  deweyHasValue: boolean;
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
  /** 全三つ組の候補学習用データ。表示列とは独立して保持する。 */
  wikiLearning: WikiLearningSnapshot[];
};

/** 移動探索用の軽量応答（Status / Assignee のみ。行全体は取得しない）。 */
export type RowProbePayload = {
  sheet: string;
  sheetRowNumber: number;
  status: string;
  assignee: string;
};

/**
 * 移動探索の集約応答（A）。候補列を順に走査してスキップ判定し、
 * 最初に着地する行の payload をまとめて返す（往復を1回に集約）。
 */
export type NavigateResult = {
  /** 着地行（見つからなければ null）。 */
  landing: QueueEntry | null;
  /** candidates 内での着地インデックス（見つからなければ -1）。 */
  landingIndex: number;
  /** 着地行の全データ（landing が null なら null）。 */
  payload: RowPayload | null;
  /** 取得できた候補の作業 Status（キー: `${sheet}#${row}`）。 */
  statuses: Record<string, string>;
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
  /** 読込時から実際に変化したセルだけ。 */
  edits: Record<string, string>;
  wikiLearning: WikiLearningSnapshot[];
  fullEditMode: boolean;
  indexRows: number;
};

export type SaveResult = {
  savedCells: number;
  /** Status が今回更新された場合のみ、サーバーが受理した値を返す。 */
  status?: string;
};

export type SaveMoveAction =
  | {
      kind: "navigate";
      candidates: QueueEntry[];
      statusFilter: WorkStatusFilter;
      rowOptions: Pick<
        WorkOptions,
        "lightBlueOnly" | "fullEditMode" | "showNamedTriplets"
      >;
    }
  | {
      kind: "jump";
      target: QueueEntry;
      rowOptions: Pick<
        WorkOptions,
        "lightBlueOnly" | "fullEditMode" | "showNamedTriplets"
      >;
    };

export type SaveMoveResponse = {
  save:
    | { ok: true; result: SaveResult }
    | { ok: false; error: string };
  move:
    | { ok: true; kind: "navigate"; result: NavigateResult }
    | { ok: true; kind: "jump"; result: RowPayload }
    | { ok: false; kind: SaveMoveAction["kind"]; error: string };
};
