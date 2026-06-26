"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import styles from "./WorkApp.module.css";
import { LoginPanel } from "./LoginPanel";
import { WorkRowTable } from "./WorkRowTable";
import type {
  BootstrapPayload,
  RowPayload,
  WorkOptions,
} from "@/lib/types";
import { applyTheme, loadThemeMode, type ThemeMode } from "@/lib/theme";
import { ASSIGN_ALL_ROWS_NAME, isDoneStatus, STATUS_NOT_STARTED } from "@/lib/config";

const PREFS_KEY = "wikiWorkNext";
const LAST_ROW_KEY = "wikiWorkLastRow";

function loadStoredLastRow(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ROW_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

function saveLastRow(row: number): void {
  try {
    localStorage.setItem(LAST_ROW_KEY, String(row));
  } catch {
    // localStorage 不可環境は黙って無視。
  }
}

const defaultOptions: WorkOptions = {
  // 初回（localStorage 無し）の既定。作業者名は「全件表示」、
  // 表示は Entity値有りのみ ON / DeweyID付与除く ON（=確認必要な白セルのみ）。
  worker: ASSIGN_ALL_ROWS_NAME,
  queueFilter: "自分担当",
  statusFilter: "incomplete",
  lightBlueOnly: true,
  showNamedTriplets: false,
  fullEditMode: false,
  indexRows: 30000,
};

function loadStoredOptions(): WorkOptions {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaultOptions;
    // 旧バージョンは skipDone / onlyNotStarted の2 boolean を保持。statusFilter へ移行する。
    const prefs = JSON.parse(raw) as Partial<WorkOptions> & {
      skipDone?: boolean;
      onlyNotStarted?: boolean;
    };
    const { skipDone, onlyNotStarted, ...rest } = prefs;
    const statusFilter: WorkOptions["statusFilter"] =
      rest.statusFilter ??
      (onlyNotStarted ? "notStarted" : skipDone === false ? "all" : "incomplete");
    return { ...defaultOptions, ...rest, statusFilter, queueFilter: "自分担当" };
  } catch {
    return defaultOptions;
  }
}

function optionsQuery(options: WorkOptions): string {
  const params = new URLSearchParams({
    worker: options.worker,
    queueFilter: options.queueFilter,
    statusFilter: options.statusFilter,
    lightBlueOnly: String(options.lightBlueOnly),
    indexRows: String(options.indexRows),
  });
  return params.toString();
}

function rowQuery(options: WorkOptions): string {
  return `lightBlueOnly=${options.lightBlueOnly}&fullEditMode=${options.fullEditMode}&showNamedTriplets=${options.showNamedTriplets}`;
}

/** 編集内容が読込時のスナップショットから変化しているか（未保存判定）。 */
function editsDiffer(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? "") !== (b[key] ?? "")) return true;
  }
  return false;
}

// 「表示する列」の排他モード。内部フラグ lightBlueOnly / showNamedTriplets /
// fullEditMode の組み合わせを 1 つの選択値として扱う。
type ColumnMode = "whiteOnly" | "entityValue" | "allColumns" | "fullEdit";

const COLUMN_MODE_FLAGS: Record<
  ColumnMode,
  Pick<WorkOptions, "lightBlueOnly" | "showNamedTriplets" | "fullEditMode">
> = {
  // 確認が必要な白セルのみ（Entity値あり かつ DeweyID 未付与）。
  whiteOnly: { lightBlueOnly: true, showNamedTriplets: false, fullEditMode: false },
  // Entity値ありの列（DeweyID 付与済みも含む）。
  entityValue: { lightBlueOnly: false, showNamedTriplets: true, fullEditMode: false },
  // すべての列（AC 以降をフィルタなしで表示）。
  allColumns: { lightBlueOnly: false, showNamedTriplets: false, fullEditMode: false },
  // 全列を編集（AN〜GU）。
  fullEdit: { lightBlueOnly: false, showNamedTriplets: false, fullEditMode: true },
};

const COLUMN_MODE_LABELS: ReadonlyArray<readonly [ColumnMode, string]> = [
  ["entityValue", "Entity値あり"],
  ["whiteOnly", "要確認（DeweyIDなし）"],
  ["fullEdit", "編集（AN〜GU）"],
  ["allColumns", "すべて"],
];

const HELP_ACTIONS: ReadonlyArray<readonly [string, string]> = [
  ["作業者名", "割り当てられた行だけを表示"],
  ["全件表示", "すべての行を表示"],
  ["前の行", "変更を保存して前の行へ"],
  ["次の行", "変更を保存して次の行へ"],
  ["開く", "変更を保存して指定した行を開く"],
  ["リセット", "今の行の変更を読み込み時の状態に戻す"],
  ["キュー再読込", "担当者・Status など、最新状態をシートから読み直す"],
  ["キャッシュクリア", "アプリが一時保存している情報を削除し再生成、正しいwiki の候補を更新"],
  ["表示設定等", "スマホでの利用時に表示設定等を開く"],
];

const HELP_CHECKS: ReadonlyArray<readonly [string, string]> = [
  ["表示する行（進捗）", "すべて / 完了を除く（完了系を除外）/ 未着手のみ（未着手だけ）"],
  [
    "表示する列",
    "Entity値あり / 要確認（DeweyIDなし・既定）/ 編集（AN〜GU）/ すべて",
  ],
  [
    "表示する行を変更した直後",
    "今の行の表示はそのままです。次の行/前の行へ進むと絞り込みが反映されます。",
  ],
];

function HelpPopup({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={styles.helpOverlay}
      role="dialog"
      aria-modal="true"
      aria-label="使い方"
      onClick={onClose}
    >
      <div className={styles.helpModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.helpModalHead}>
          <h2 className={styles.helpHeading}>使い方</h2>
          <button
            type="button"
            className={styles.helpClose}
            onClick={onClose}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <h3 className={styles.helpSection}>ボタン・操作</h3>
        <table className={styles.helpTable}>
          <thead>
            <tr>
              <th>項目</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            {HELP_ACTIONS.map(([name, desc]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className={styles.helpSection}>表示設定</h3>
        <table className={styles.helpTable}>
          <thead>
            <tr>
              <th>項目</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            {HELP_CHECKS.map(([name, desc]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function WorkApp() {
  const { data: session } = useSession();
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  // 初期値は決定論的な defaultOptions（SSR と一致させハイドレーション不一致を防ぐ）。
  // localStorage の保存値はマウント後の loadPrefs で反映する。
  const [options, setOptions] = useState<WorkOptions>(defaultOptions);
  const [queueRows, setQueueRows] = useState<number[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [rowPayload, setRowPayload] = useState<RowPayload | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  // 読込時の値スナップショット。edits と差があれば「未保存」。
  const [originalEdits, setOriginalEdits] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"" | "ok" | "error">("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [moreSettingsOpen, setMoreSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // 直近で「キューに適用済み」の識別子（worker/statusFilter/indexRows）。
  // 適用が成功したときだけ更新する。作業者変更の判定（位置維持の可否）に使う。
  const appliedQueueKeyRef = useRef<{
    worker: string;
    statusFilter: WorkOptions["statusFilter"];
    indexRows: number;
  } | null>(null);
  // queueRows を書き換える非同期処理の世代カウンタ。
  // 後発の書込が常に最新。古い in-flight 応答（例: 進捗フィルタで算出された
  // キュー）が後から届いて上書きするのを防ぐ。
  const queueWriteSeqRef = useRef(0);
  // 前回開いていた行（localStorage 復元用）。初回キュー構築時に一度だけ適用する。
  const pendingRestoreRowRef = useRef<number | null>(null);

  const currentRow = useMemo(() => {
    if (historyIndex >= 0 && history[historyIndex]) return history[historyIndex];
    if (queueRows.length) return queueRows[queueIndex];
    return null;
  }, [history, historyIndex, queueRows, queueIndex]);

  const dirty = useMemo(
    () => editsDiffer(edits, originalEdits),
    [edits, originalEdits]
  );

  // 「前の行」可否: 現在行より小さい行番号がキューにあれば前へ進める。
  const hasPrevRow = useMemo(
    () => currentRow != null && queueRows.some((r) => r < currentRow),
    [currentRow, queueRows]
  );

  // 開いている行を記憶し、次回起動時に同じ行を復元する。
  useEffect(() => {
    if (currentRow != null) saveLastRow(currentRow);
  }, [currentRow]);

  // 背景化・離脱時の自動保存に使う最新値（イベントリスナのクロージャ陳腐化を避ける）。
  const flushStateRef = useRef({
    currentRow: null as number | null,
    edits: {} as Record<string, string>,
    originalEdits: {} as Record<string, string>,
    options,
    queueRows,
  });
  useEffect(() => {
    flushStateRef.current = { currentRow, edits, originalEdits, options, queueRows };
  }, [currentRow, edits, originalEdits, options, queueRows]);

  // タブ非表示化（visibilitychange=hidden）と離脱（pagehide）で、未保存があれば自動保存。
  // hidden 時は keepalive fetch（成功で clean 化）、pagehide は sendBeacon（最後の砦）。
  useEffect(() => {
    const buildBody = (s: typeof flushStateRef.current) =>
      JSON.stringify({
        sheetRowNumber: s.currentRow,
        worker: s.options.worker,
        edits: s.edits,
        queueSheetRows: s.queueRows,
        options: s.options,
      });

    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      const s = flushStateRef.current;
      if (!s.currentRow || !editsDiffer(s.edits, s.originalEdits)) return;
      const cleaned = { ...s.edits };
      fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildBody(s),
        keepalive: true,
      })
        .then((r) => {
          if (!r.ok) return;
          flushStateRef.current = { ...flushStateRef.current, originalEdits: cleaned };
          setOriginalEdits(cleaned);
        })
        .catch(() => {});
    };

    const onPageHide = () => {
      const s = flushStateRef.current;
      if (!s.currentRow || !editsDiffer(s.edits, s.originalEdits)) return;
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/save",
          new Blob([buildBody(s)], { type: "application/json" })
        );
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  const setMessage = (text: string, kind: "" | "ok" | "error" = "") => {
    setStatus(text);
    setStatusKind(kind);
  };

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 3500);
  };

  const loadPrefs = useCallback(() => {
    setOptions(loadStoredOptions());
  }, []);

  const savePrefs = useCallback((next: WorkOptions) => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  }, []);

  /** 読み込んだ行のライブな作業 Status 値（GJ 列）。判定不能時は空。 */
  const rowStatusOf = (payload: RowPayload): string =>
    payload.columns.find((c) => c.isStatus)?.value ?? "";

  /** 移動先のライブ status が現在の進捗フィルタで除外対象か。 */
  const shouldSkipLiveRow = (payload: RowPayload): boolean => {
    const s = rowStatusOf(payload);
    if (options.statusFilter === "incomplete") return isDoneStatus(s);
    if (options.statusFilter === "notStarted") return s !== STATUS_NOT_STARTED;
    return false;
  };

  const syncEditsFromPayload = (payload: RowPayload) => {
    const next: Record<string, string> = {};
    for (const col of payload.columns) {
      if (col.inline) next[col.uniqueName] = col.value;
    }
    setEdits(next);
    setOriginalEdits(next);
  };

  const loadRow = useCallback(
    async (sheetRowNumber: number, opts: WorkOptions): Promise<RowPayload> => {
      setMessage("行を読み込み中…");
      const res = await fetch(`/api/row/${sheetRowNumber}?${rowQuery(opts)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "行の読み込みに失敗");
      setRowPayload(data as RowPayload);
      syncEditsFromPayload(data as RowPayload);
      setMessage("");
      return data as RowPayload;
    },
    []
  );

  const loadQueue = useCallback(
    async (opts: WorkOptions, keepPosition: boolean, forceRefresh = false) => {
      const seq = ++queueWriteSeqRef.current;
      setMessage("キューを読み込み中…");
      const qs = optionsQuery(opts) + (forceRefresh ? "&refresh=true" : "");
      const res = await fetch(`/api/queue?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "キューの読み込みに失敗");
      // 自分より後発の queue 書込が始まっていれば、この古い応答は破棄する。
      if (seq !== queueWriteSeqRef.current) return;
      const rows = (data.sheetRows ?? []) as number[];
      setQueueRows(rows);

      if (!rows.length) {
        setRowPayload(null);
        setMessage("");
        return;
      }

      let nextHistory = history;
      let nextHistoryIndex = historyIndex;
      let nextQueueIndex = queueIndex;

      if (!keepPosition || historyIndex < 0) {
        // 初回起動時は前回開いていた行を復元（キューに含まれる場合のみ）。
        let startRow = rows[0];
        const restore = pendingRestoreRowRef.current;
        if (restore != null) {
          pendingRestoreRowRef.current = null;
          if (rows.includes(restore)) startRow = restore;
        }
        nextHistory = [startRow];
        nextHistoryIndex = 0;
        nextQueueIndex = Math.max(0, rows.indexOf(startRow));
      } else {
        const row = history[historyIndex];
        const idx = rows.indexOf(row);
        if (idx >= 0) nextQueueIndex = idx;
      }

      setHistory(nextHistory);
      setHistoryIndex(nextHistoryIndex);
      setQueueIndex(nextQueueIndex);
      await loadRow(nextHistory[nextHistoryIndex], opts);
    },
    [history, historyIndex, loadRow, queueIndex]
  );

  useEffect(() => {
    setThemeMode(loadThemeMode());
  }, []);

  useEffect(() => {
    applyTheme(themeMode);
    if (themeMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themeMode]);

  useEffect(() => {
    loadPrefs();
    pendingRestoreRowRef.current = loadStoredLastRow();
    let cancelled = false;
    fetch("/api/bootstrap")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setBootstrap(data as BootstrapPayload);
      })
      .catch((e) => {
        if (!cancelled) setMessage(String(e), "error");
      });
    return () => {
      cancelled = true;
    };
  }, [loadPrefs, session?.user?.email]);

  useEffect(() => {
    if (!bootstrap || bootstrap.authRequired) return;
    setOptions((prev) => {
      let next = prev;
      // 作業者の既定補完（保存値が一覧に無ければ先頭の作業者にする）。
      if (
        bootstrap.discordNames.length &&
        !(prev.worker && bootstrap.discordNames.includes(prev.worker))
      ) {
        next = { ...next, worker: bootstrap.discordNames[0] };
      }
      // インデックス行数は .env.local の DEFAULT_INDEX_ROWS（サーバー既定）を正とする。
      // UI からは編集させず、localStorage の古い値があっても常にサーバー既定へ合わせる。
      if (
        bootstrap.defaultIndexRows &&
        prev.indexRows !== bootstrap.defaultIndexRows
      ) {
        next = { ...next, indexRows: bootstrap.defaultIndexRows };
      }
      if (next !== prev) savePrefs(next);
      return next;
    });
  }, [bootstrap, savePrefs]);

  // 正しいWiki補完インデックスの事前ウォームアップ。
  // 行表示前にサーバー側キャッシュ（全行 batchGet）を構築しておき、
  // 入力欄の先読み候補がキャッシュヒットで即返るようにする。
  // indexRows ごとに 1 回だけ実行する（移行で値が変わったら再ウォームアップ）。
  const wikiWarmedRowsRef = useRef<number | null>(null);
  useEffect(() => {
    if (!bootstrap || bootstrap.authRequired) return;
    if (wikiWarmedRowsRef.current === options.indexRows) return;
    wikiWarmedRowsRef.current = options.indexRows;
    void fetch(
      `/api/wiki-history?name=&indexRows=${options.indexRows}`
    ).catch(() => {});
  }, [bootstrap, options.indexRows]);

  useEffect(() => {
    if (!bootstrap || bootstrap.authRequired) return;
    if (!options.worker) return;

    savePrefs(options);

    const prevApplied = appliedQueueKeyRef.current;
    const workerChanged = prevApplied != null && prevApplied.worker !== options.worker;
    const keepPosition = prevApplied != null && !workerChanged;
    void (async () => {
      setLoading(true);
      try {
      // キュー再読込（進捗フィルタ/indexRows・作業者変更）の前に未保存編集を自動保存する。
      // 移動操作と同じ挙動に統一し、再読込で編集（例: Status 変更）が消えるのを防ぐ。
      const saved = await saveCurrentIfDirty();
      if (!saved.ok) {
        // 保存失敗時は選択（進捗フィルタ等）を勝手に巻き戻さない。
        // ここでキュー再読込すると未保存編集が失われるため中断するだけにし、
        // エラーは saveCurrentIfDirty が表示済み。次の移動操作で
        // resolveNavigationQueue が「すべて」なら最新キューを取り直して自己修復する。
        return;
      }
      appliedQueueKeyRef.current = {
        worker: options.worker,
        statusFilter: options.statusFilter,
        indexRows: options.indexRows,
      };
      await loadQueue(options, keepPosition);
      } finally {
        setLoading(false);
      }
    })().catch((e) => setMessage(String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap, options.worker, options.statusFilter, options.indexRows]);

  const updateOption = <K extends keyof WorkOptions>(
    key: K,
    value: WorkOptions[K]
  ) => {
    setOptions((prev) => {
      const next = { ...prev, [key]: value };
      savePrefs(next);
      return next;
    });
  };

  const applyDisplayOptions = async (next: WorkOptions) => {
    // 表示モード変更で行を再読込する前に未保存編集を自動保存（編集消失を防ぐ）。
    const saved = await saveCurrentIfDirty();
    if (!saved.ok) return;
    setOptions(next);
    savePrefs(next);
    if (!currentRow) return;
    try {
      await loadRow(currentRow, next);
    } catch (e) {
      setMessage(String(e), "error");
    }
  };

  // 「表示する列」の現在モード（内部フラグから排他値を導出）。
  const columnMode: ColumnMode = options.fullEditMode
    ? "fullEdit"
    : options.showNamedTriplets
      ? "entityValue"
      : options.lightBlueOnly
        ? "whiteOnly"
        : "allColumns";

  const setColumnMode = (mode: ColumnMode) =>
    void applyDisplayOptions({ ...options, ...COLUMN_MODE_FLAGS[mode] });

  /**
   * 現在行に未保存の変更があれば保存する（変更なしは何もしない＝書き込み負荷を抑える）。
   * 戻り値: ok=保存成功 or 変更なし、失敗時 ok=false。queueRows は保存後の最新キュー。
   * すべての移動操作はこれを先に await し、ok=false なら移動を中止する。
   */
  const saveCurrentIfDirty = async (): Promise<{
    ok: boolean;
    queueRows: number[];
  }> => {
    if (!currentRow || !dirty) return { ok: true, queueRows };
    const seq = ++queueWriteSeqRef.current;
    setMessage("保存中…");
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetRowNumber: currentRow,
          worker: options.worker,
          edits,
          queueSheetRows: queueRows,
          options,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存に失敗");

      // patch 反映後の最新キューでクライアントの基準を更新（次/前の判定を統一）。
      // ただし、この保存より後にキュー再読込が始まっていれば state 反映はしない
      // （古い応答での上書き防止）。戻り値 queueRows は呼び出し側の移動判定に使う。
      const nextQueueRows = (data.queueSheetRows ?? queueRows) as number[];
      if (seq === queueWriteSeqRef.current) setQueueRows(nextQueueRows);
      setOriginalEdits(edits);
      setMessage(`${data.savedCells} セルを保存しました。`, "ok");
      return { ok: true, queueRows: nextQueueRows };
    } catch (e) {
      setMessage(String(e), "error");
      return { ok: false, queueRows };
    }
  };

  /**
   * 移動前のキュー取得。進捗フィルタが「すべて」のときはサーバーから再取得し、
   * 以前の絞り込みでクライアント側から除外された行を復元する。
   */
  const resolveNavigationQueue = async (): Promise<{
    ok: boolean;
    queueRows: number[];
  }> => {
    const saved = await saveCurrentIfDirty();
    if (!saved.ok) return saved;
    // 進捗フィルタ有効時は保存応答のキューがそのまま正。
    // 「すべて」のときだけサーバーから再取得し、除外されていた行を復元する。
    if (options.statusFilter !== "all") return saved;

    const res = await fetch(`/api/queue?${optionsQuery(options)}`);
    const data = await res.json();
    if (!res.ok) {
      setMessage(String(data.error ?? "キューの読み込みに失敗"), "error");
      return { ok: false, queueRows: saved.queueRows };
    }
    const rows = (data.sheetRows ?? []) as number[];
    setQueueRows(rows);
    return { ok: true, queueRows: rows };
  };

  const goPrev = async () => {
    if (loading) return;
    setLoading(true);
    const original = currentRow;
    try {
      const saved = await resolveNavigationQueue();
      if (!saved.ok) return;
      // goNext と対称に「キュー基準」で前の行（現在行より小さい最大の行番号）を探す。
      // 履歴ではなくキューを辿るので、進捗フィルタで積まれなかった行も
      // 「すべて」にすれば前方向でも到達できる（履歴の欠落でスキップされない）。
      let q = saved.queueRows;
      let cursor = original;
      while (true) {
        const from = cursor;
        const prev =
          from != null ? q.filter((r) => r < from).pop() ?? null : null;
        if (prev == null) {
          showToast("前の行がありません");
          if (original != null && cursor !== original) {
            await loadRow(original, options);
          }
          return;
        }
        const payload = await loadRow(prev, options);
        // スキップ設定（完了/未着手以外）に該当するライブ status の行を飛ばす。
        if (shouldSkipLiveRow(payload)) {
          q = q.filter((r) => r !== prev);
          cursor = prev;
          continue;
        }
        const nextHistory = history.slice(0, historyIndex + 1);
        nextHistory.push(prev);
        setHistory(nextHistory);
        setHistoryIndex(nextHistory.length - 1);
        const idx = q.indexOf(prev);
        if (idx >= 0) setQueueIndex(idx);
        break;
      }
    } catch (e) {
      setMessage(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  const goJump = async () => {
    const target = Number(
      (document.getElementById("jumpRow") as HTMLInputElement | null)?.value
    );
    if (!target || target < 2) {
      setMessage("行番号は 2 以上を指定してください。", "error");
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      const saved = await resolveNavigationQueue();
      if (!saved.ok) return;
      const q = saved.queueRows;

      setMessage("行を読み込み中…");
      const res = await fetch(`/api/row/${target}?${rowQuery(options)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "行の読み込みに失敗");
      const payload = data as RowPayload;

      if (
        options.worker &&
        options.worker !== ASSIGN_ALL_ROWS_NAME &&
        payload.assignee &&
        payload.assignee !== options.worker
      ) {
        setMessage(
          `指定行（${target}）は他の作業者「${payload.assignee}」の担当のため開けません。`,
          "error"
        );
        return;
      }

      const nextHistory = history.slice(0, historyIndex + 1);
      nextHistory.push(target);
      setHistory(nextHistory);
      setHistoryIndex(nextHistory.length - 1);
      const idx = q.indexOf(target);
      if (idx >= 0) setQueueIndex(idx);
      if (!q.includes(target)) {
        showToast("現在のキュー外の行です（表示のみ）");
      }
      setRowPayload(payload);
      syncEditsFromPayload(payload);
      setMessage("");
    } catch (e) {
      setMessage(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  const goNext = async () => {
    if (loading) return;
    setLoading(true);
    const original = currentRow;
    try {
      const saved = await resolveNavigationQueue();
      if (!saved.ok) return;
      // キュー・スナップショットは古い可能性がある（外部/別セッションでの完了など）。
      // 移動先のライブ status が完了なら、その行をスナップショットから外して次へ進む。
      let q = saved.queueRows;
      let cursor = original;
      while (true) {
        const from = cursor;
        const next =
          from != null ? q.find((r) => r > from) ?? null : q[0] ?? null;
        if (next == null) {
          setMessage("キューの末尾です。", "ok");
          if (original != null && cursor !== original) {
            await loadRow(original, options);
          }
          return;
        }
        const payload = await loadRow(next, options);
        if (shouldSkipLiveRow(payload)) {
          q = q.filter((r) => r !== next);
          cursor = next;
          continue;
        }
        const nextHistory = history.slice(0, historyIndex + 1);
        nextHistory.push(next);
        setHistory(nextHistory);
        setHistoryIndex(nextHistory.length - 1);
        const idx = q.indexOf(next);
        if (idx >= 0) setQueueIndex(idx);
        break;
      }
    } catch (e) {
      setMessage(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  // 行内の編集を読込時の値へ戻す（自動保存で確定する前の「取り消し」手段）。
  const resetEdits = () => {
    if (!dirty) return;
    setEdits(originalEdits);
    setMessage("変更を破棄しました。");
  };

  const clearCache = async () => {
    await fetch("/api/cache", { method: "DELETE" });
    setMessage("キャッシュをクリアしました。", "ok");
    await loadQueue(options, true);
  };

  if (bootstrap?.authRequired) {
    const signedInEmail = bootstrap.userEmail ?? session?.user?.email ?? null;
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>PJ140 Wiki付与</h1>
          {signedInEmail && (
            <div className={styles.headerActions}>
              <div className={styles.userBlock}>
                <span className={styles.userEmail}>{signedInEmail}</span>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => signOut({ callbackUrl: "/" })}
                >
                  ログアウト
                </button>
              </div>
            </div>
          )}
        </header>
        {(bootstrap.authMessage || session?.error) && (
          <p className={styles.statusError}>
            {bootstrap.authMessage ??
              "Google 認証の有効期限が切れました。再度ログインしてください。"}
          </p>
        )}
        <LoginPanel sheetUrl={bootstrap.sheetUrl} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <h1 className={styles.title}>PJ140 Wiki付与</h1>
          <button
            type="button"
            className={styles.helpButton}
            onClick={() => setHelpOpen(true)}
            aria-label="使い方を表示"
            title="使い方"
          >
            ?
          </button>
        </div>
        <div className={styles.headerActions}>
          {session?.user?.email ? (
            // サインイン中は bootstrap 取得が失敗（権限不足・500 等）しても
            // ログアウト導線を必ず出す（別アカウントで再ログインできるようにする）。
            <div className={styles.userBlock}>
              <span className={styles.userEmail}>
                {bootstrap?.userEmail ?? session.user.email}
              </span>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => signOut({ callbackUrl: "/" })}
              >
                ログアウト
              </button>
            </div>
          ) : !bootstrap ? (
            <p className={styles.metaCompact}>読み込み中…</p>
          ) : null}
          {bootstrap && (
            <a
              className={`${styles.sheetLink} ${styles.sheetLinkDesktop}`}
              href={bootstrap.sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              作業シートを開く ↗
            </a>
          )}
        </div>
      </header>

      {helpOpen && <HelpPopup onClose={() => setHelpOpen(false)} />}

      <div className={styles.layout}>
        <aside className={styles.settings}>
          <div className={styles.settingsPrimary}>
            <label className={styles.label}>作業者名（Discord名）</label>
            <select
              value={options.worker}
              onChange={(e) => updateOption("worker", e.target.value)}
            >
              {(bootstrap?.discordNames.length
                ? bootstrap.discordNames
                : ["（読込中）"]
              ).map((name) => (
                <option key={name} value={name === "（読込中）" ? "" : name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className={styles.settingsMoreToggle}
            aria-expanded={moreSettingsOpen}
            onClick={() => setMoreSettingsOpen((open) => !open)}
          >
            表示設定等
            <span className={styles.settingsMoreIcon} aria-hidden>
              {moreSettingsOpen ? "▲" : "▼"}
            </span>
          </button>

          <div
            className={
              moreSettingsOpen
                ? `${styles.settingsMore} ${styles.settingsMoreOpen}`
                : styles.settingsMore
            }
          >
            <label className={styles.label}>表示する行（進捗）</label>
            <select
              value={options.statusFilter}
              onChange={(e) =>
                updateOption(
                  "statusFilter",
                  e.target.value as WorkOptions["statusFilter"]
                )
              }
            >
              <option value="all">すべて</option>
              <option value="incomplete">完了を除く</option>
              <option value="notStarted">未着手のみ</option>
            </select>

            <label className={styles.label}>表示する列</label>
            <select
              value={columnMode}
              onChange={(e) => setColumnMode(e.target.value as ColumnMode)}
            >
              {COLUMN_MODE_LABELS.map(([mode, label]) => (
                <option key={mode} value={mode}>
                  {label}
                </option>
              ))}
            </select>

            <label className={styles.label}>表示テーマ</label>
            <select
              value={themeMode}
              onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>

            <div className={styles.btnRow}>
              <button
                type="button"
                className={styles.secondary}
                onClick={() =>
                  loadQueue(options, true, true).catch((e) =>
                    setMessage(String(e), "error")
                  )
                }
              >
                キュー再読込
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() =>
                  clearCache().catch((e) => setMessage(String(e), "error"))
                }
              >
                キャッシュクリア
              </button>
            </div>
          </div>
        </aside>

        <main className={styles.main}>
          {!bootstrap && (
            <div className={styles.empty}>読み込み中…</div>
          )}

          {bootstrap && loading && !rowPayload && (
            <div className={styles.empty}>行を読み込み中…</div>
          )}

          {!queueRows.length && bootstrap && options.worker && (
            <div className={styles.empty}>
              担当の行が見つかりません。作業者名を確認してください。
            </div>
          )}

          {!queueRows.length && bootstrap && !options.worker && (
            <div className={styles.empty}>作業者名を選択してください。</div>
          )}

          {rowPayload && (
            <>
              <div className={styles.summary}>{rowPayload.summary}</div>
              <div className={styles.progress}>
                キュー {queueIndex + 1} / {queueRows.length} · シート行{" "}
                {rowPayload.sheetRowNumber}
              </div>
              <WorkRowTable
                columns={rowPayload.columns}
                edits={edits}
                indexRows={options.indexRows}
                rowKey={rowPayload.sheetRowNumber}
                eventName={rowPayload.eventName}
                onEdit={(uniqueName, value) =>
                  setEdits((prev) => ({ ...prev, [uniqueName]: value }))
                }
              />
              <div className={styles.navBar}>
                <button
                  type="button"
                  className={styles.navPrev}
                  disabled={!hasPrevRow || loading}
                  onClick={goPrev}
                >
                  ← 前の行
                </button>
                <div className={styles.navJump}>
                  <input
                    id="jumpRow"
                    type="number"
                    min={2}
                    className={styles.jumpInput}
                    defaultValue={rowPayload.sheetRowNumber}
                    key={rowPayload.sheetRowNumber}
                    aria-label="シート行番号"
                  />
                  <button
                    type="button"
                    className={styles.navOpen}
                    disabled={loading}
                    onClick={goJump}
                  >
                    開く
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={!dirty || loading}
                    onClick={resetEdits}
                    title="この行の編集を読み込み時の値に戻す"
                  >
                    リセット
                  </button>
                </div>
                <button
                  type="button"
                  className={styles.navNext}
                  disabled={loading}
                  onClick={goNext}
                >
                  次の行 →
                </button>
              </div>
            </>
          )}
        </main>
      </div>

      {status && (
        <p
          className={
            statusKind === "error"
              ? styles.statusError
              : statusKind === "ok"
                ? styles.statusOk
                : styles.status
          }
        >
          {status}
        </p>
      )}
      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  );
}
