"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import styles from "./WorkApp.module.css";
import { LoginPanel } from "./LoginPanel";
import { WorkRowTable } from "./WorkRowTable";
import type {
  BootstrapPayload,
  QueueEntry,
  RowPayload,
  WorkOptions,
} from "@/lib/types";
import { applyTheme, loadThemeMode, type ThemeMode } from "@/lib/theme";
import { ASSIGN_ALL_ROWS_NAME, isDoneStatus, STATUS_NOT_STARTED } from "@/lib/config";

const PREFS_KEY = "wikiWorkNext";
const LAST_ROW_KEY = "wikiWorkLastRow";

// 1回の移動でこの数以上スキップしたら、行を1件ずつ確認し続けず
// キュー index を一度だけ再構築して最新キューで一気にジャンプする（負荷軽減）。
const NAV_REFRESH_SKIP_THRESHOLD = 5;

// 起動直後のリクエスト集中を避けるための候補ウォーム遅延（ミリ秒）。
const WIKI_WARM_DELAY_MS = 6000;

const entryKey = (e: QueueEntry) => `${e.sheet}#${e.row}`;
const indexOfEntry = (q: QueueEntry[], e: QueueEntry | null): number =>
  e ? q.findIndex((x) => x.sheet === e.sheet && x.row === e.row) : -1;

function loadStoredLastRow(): QueueEntry | null {
  try {
    const raw = localStorage.getItem(LAST_ROW_KEY);
    if (!raw) return null;
    const hash = raw.indexOf("#");
    if (hash <= 0) return null; // 旧形式（数値のみ）は無視。
    const sheet = raw.slice(0, hash);
    const row = Number(raw.slice(hash + 1));
    if (!sheet || !Number.isFinite(row) || row <= 0) return null;
    return { sheet, row: Math.floor(row) };
  } catch {
    return null;
  }
}

function saveLastRow(entry: QueueEntry): void {
  try {
    localStorage.setItem(LAST_ROW_KEY, entryKey(entry));
  } catch {
    // localStorage 不可環境は黙って無視。
  }
}

const defaultOptions: WorkOptions = {
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

function rowQuery(sheet: string, options: WorkOptions): string {
  return `sheet=${encodeURIComponent(sheet)}&lightBlueOnly=${options.lightBlueOnly}&fullEditMode=${options.fullEditMode}&showNamedTriplets=${options.showNamedTriplets}`;
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

// 「表示する列」の排他モード。
type ColumnMode = "whiteOnly" | "entityValue" | "allColumns" | "fullEdit";

const COLUMN_MODE_FLAGS: Record<
  ColumnMode,
  Pick<WorkOptions, "lightBlueOnly" | "showNamedTriplets" | "fullEditMode">
> = {
  whiteOnly: { lightBlueOnly: true, showNamedTriplets: false, fullEditMode: false },
  entityValue: { lightBlueOnly: false, showNamedTriplets: true, fullEditMode: false },
  allColumns: { lightBlueOnly: false, showNamedTriplets: false, fullEditMode: false },
  fullEdit: { lightBlueOnly: false, showNamedTriplets: false, fullEditMode: true },
};

const COLUMN_MODE_LABELS: ReadonlyArray<readonly [ColumnMode, string]> = [
  ["entityValue", "Entity値あり"],
  ["whiteOnly", "要確認（DeweyIDなし）"],
  ["fullEdit", "編集（三つ組＋memo＋役割列）"],
  ["allColumns", "すべて"],
];

const HELP_ACTIONS: ReadonlyArray<readonly [string, string]> = [
  ["作業者名", "割り当てられた行だけを表示"],
  ["全件表示", "すべての行を表示"],
  ["前の行", "変更を保存して前の行へ"],
  ["次の行", "変更を保存して次の行へ"],
  ["開く", "変更を保存して指定したシート・行を開く"],
  ["リセット", "今の行の変更を読み込み時の状態に戻す"],
  ["対象行リストを更新", "担当者・Status など、表示対象行の最新状態をシートから読み直す"],
  ["候補再構築", "正しいwiki の入力候補を作り直す（シートから再学習）"],
  ["表示中の行を再取得", "一時保存した行の内容を破棄（次に開くと再取得）。動作が重い/古いとき用"],
  ["表示設定等", "スマホでの利用時に表示設定等を開く"],
];

const HELP_CHECKS: ReadonlyArray<readonly [string, string]> = [
  ["対象シート", "第一二弾・第三弾の両方を 1 本のキューとして通しで表示（第一二弾 → 第三弾の順）"],
  ["表示する行（進捗）", "すべて / 完了を除く（完了系を除外）/ 未着手のみ（未着手だけ）"],
  [
    "表示する列",
    "Entity値あり / 要確認（DeweyIDなし・既定）/ 編集（三つ組＋memo＋役割列）/ すべて",
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

        <p className={styles.helpGuideLink}>
          <a href="/guide" target="_blank" rel="noopener noreferrer">
            詳しい使い方ガイドを開く ↗
          </a>
        </p>

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
  const [options, setOptions] = useState<WorkOptions>(defaultOptions);
  const [queueRows, setQueueRows] = useState<QueueEntry[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [history, setHistory] = useState<QueueEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [rowPayload, setRowPayload] = useState<RowPayload | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [originalEdits, setOriginalEdits] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"" | "ok" | "error">("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [moreSettingsOpen, setMoreSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [jumpSheet, setJumpSheet] = useState("");
  const appliedQueueKeyRef = useRef<{
    worker: string;
    statusFilter: WorkOptions["statusFilter"];
    indexRows: number;
  } | null>(null);
  const queueWriteSeqRef = useRef(0);
  const pendingRestoreRowRef = useRef<QueueEntry | null>(null);
  // 移動探索の status 先読みメモ（キー: シートID#行番号）。対象行リストを更新/保存で破棄。
  const statusMemoRef = useRef<Map<string, string>>(new Map());

  const currentEntry = useMemo<QueueEntry | null>(() => {
    if (historyIndex >= 0 && history[historyIndex]) return history[historyIndex];
    if (queueRows.length) return queueRows[queueIndex] ?? null;
    return null;
  }, [history, historyIndex, queueRows, queueIndex]);

  const dirty = useMemo(
    () => editsDiffer(edits, originalEdits),
    [edits, originalEdits]
  );

  // 「前の行」可否: キュー内で現在行より前の位置に行があれば前へ進める。
  const hasPrevRow = useMemo(() => {
    const pos = indexOfEntry(queueRows, currentEntry);
    return pos > 0;
  }, [currentEntry, queueRows]);

  // 開いている行を記憶し、次回起動時に同じ行を復元する。
  useEffect(() => {
    if (currentEntry != null) saveLastRow(currentEntry);
  }, [currentEntry]);

  // 「開く」のシート選択は、既定で現在行のシートに追従する。
  useEffect(() => {
    if (rowPayload?.sheet) setJumpSheet(rowPayload.sheet);
  }, [rowPayload?.sheet]);

  // 背景化・離脱時の自動保存に使う最新値。
  const flushStateRef = useRef({
    currentEntry: null as QueueEntry | null,
    edits: {} as Record<string, string>,
    originalEdits: {} as Record<string, string>,
    options,
    queueRows,
  });
  useEffect(() => {
    flushStateRef.current = {
      currentEntry,
      edits,
      originalEdits,
      options,
      queueRows,
    };
  }, [currentEntry, edits, originalEdits, options, queueRows]);

  useEffect(() => {
    const buildBody = (s: typeof flushStateRef.current) =>
      JSON.stringify({
        sheet: s.currentEntry?.sheet ?? "",
        sheetRowNumber: s.currentEntry?.row ?? 0,
        worker: s.options.worker,
        edits: s.edits,
        queue: s.queueRows,
        options: s.options,
      });

    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      const s = flushStateRef.current;
      if (!s.currentEntry || !editsDiffer(s.edits, s.originalEdits)) return;
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
      if (!s.currentEntry || !editsDiffer(s.edits, s.originalEdits)) return;
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

  const shouldSkipLiveStatus = (status: string): boolean => {
    if (options.statusFilter === "incomplete") return isDoneStatus(status);
    if (options.statusFilter === "notStarted") return status !== STATUS_NOT_STARTED;
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

  // A+B: 未取得の候補 status を先読みで一括取得し、statusMemo へ格納する。
  // シートごとに 1 リクエスト（batchGet）。キャッシュ済み行はサーバー側で API を使わない。
  const NAV_LOOKAHEAD = 20;
  const primeStatusesAhead = useCallback(
    async (
      q: QueueEntry[],
      startIdx: number,
      dir: "next" | "prev",
      removed: Set<string>
    ): Promise<void> => {
      const memo = statusMemoRef.current;
      const targets: QueueEntry[] = [];
      let i = startIdx;
      while (targets.length < NAV_LOOKAHEAD && i >= 0 && i < q.length) {
        const e = q[i];
        const key = entryKey(e);
        if (!removed.has(key) && !memo.has(key)) targets.push(e);
        i = dir === "next" ? i + 1 : i - 1;
      }
      if (!targets.length) return;

      const bySheet = new Map<string, number[]>();
      for (const e of targets) {
        const list = bySheet.get(e.sheet) ?? [];
        list.push(e.row);
        bySheet.set(e.sheet, list);
      }
      for (const [sheet, rows] of bySheet) {
        const res = await fetch("/api/probe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheet, rows }),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as {
          sheet: string;
          statuses: Record<string, string>;
        };
        for (const [row, status] of Object.entries(data.statuses ?? {})) {
          memo.set(`${sheet}#${row}`, status);
        }
      }
    },
    []
  );

  const fetchRowPayload = useCallback(
    async (entry: QueueEntry, opts: WorkOptions): Promise<RowPayload> => {
      const res = await fetch(`/api/row/${entry.row}?${rowQuery(entry.sheet, opts)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "行の読み込みに失敗");
      return data as RowPayload;
    },
    []
  );

  const loadRow = useCallback(
    async (entry: QueueEntry, opts: WorkOptions): Promise<RowPayload> => {
      setMessage("行を読み込み中…");
      const data = await fetchRowPayload(entry, opts);
      setRowPayload(data);
      syncEditsFromPayload(data);
      setMessage("");
      return data;
    },
    [fetchRowPayload]
  );

  const loadQueue = useCallback(
    async (opts: WorkOptions, keepPosition: boolean, forceRefresh = false) => {
      const seq = ++queueWriteSeqRef.current;
      setMessage("キューを読み込み中…");
      const qs = optionsQuery(opts) + (forceRefresh ? "&refresh=true" : "");
      const res = await fetch(`/api/queue?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "キューの読み込みに失敗");
      if (seq !== queueWriteSeqRef.current) return;
      const rows = (data.queue ?? []) as QueueEntry[];
      setQueueRows(rows);
      statusMemoRef.current.clear();

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
        let startEntry = rows[0];
        const restore = pendingRestoreRowRef.current;
        if (restore != null) {
          pendingRestoreRowRef.current = null;
          if (indexOfEntry(rows, restore) >= 0) startEntry = restore;
        }
        nextHistory = [startEntry];
        nextHistoryIndex = 0;
        nextQueueIndex = Math.max(0, indexOfEntry(rows, startEntry));
      } else {
        const entry = history[historyIndex];
        const idx = indexOfEntry(rows, entry);
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
      const allWorkers = [...bootstrap.discordNames, ...bootstrap.extraAssignees];
      if (
        allWorkers.length &&
        !(prev.worker && allWorkers.includes(prev.worker))
      ) {
        next = { ...next, worker: allWorkers[0] };
      }
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

  const wikiWarmedRowsRef = useRef<number | null>(null);
  useEffect(() => {
    if (!bootstrap || bootstrap.authRequired) return;
    if (wikiWarmedRowsRef.current === options.indexRows) return;
    wikiWarmedRowsRef.current = options.indexRows;
    // E: 候補ウォームは起動直後のリクエスト集中を避けるため遅延実行（背景）。
    // 構造・キュー・初回行の取得が落ち着いてから 1 回だけ投げる。
    const indexRows = options.indexRows;
    const timer = window.setTimeout(() => {
      void fetch(`/api/wiki-history?name=&indexRows=${indexRows}`).catch(() => {});
    }, WIKI_WARM_DELAY_MS);
    return () => window.clearTimeout(timer);
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
        const saved = await saveCurrentIfDirty();
        if (!saved.ok) return;
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
    const saved = await saveCurrentIfDirty();
    if (!saved.ok) return;
    setOptions(next);
    savePrefs(next);
    if (!currentEntry) return;
    try {
      await loadRow(currentEntry, next);
    } catch (e) {
      setMessage(String(e), "error");
    }
  };

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
   * 現在行に未保存の変更があれば保存する。戻り値: ok=保存成功 or 変更なし。
   * queueRows は保存後の最新の通しキュー。
   */
  const saveCurrentIfDirty = async (): Promise<{
    ok: boolean;
    queueRows: QueueEntry[];
  }> => {
    if (!currentEntry || !dirty) return { ok: true, queueRows };
    const seq = ++queueWriteSeqRef.current;
    setMessage("保存中…");
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheet: currentEntry.sheet,
          sheetRowNumber: currentEntry.row,
          worker: options.worker,
          edits,
          queue: queueRows,
          options,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存に失敗");

      const nextQueueRows = (data.queue ?? queueRows) as QueueEntry[];
      if (seq === queueWriteSeqRef.current) setQueueRows(nextQueueRows);
      statusMemoRef.current.clear();
      setOriginalEdits(edits);
      setMessage(`${data.savedCells} セルを保存しました。`, "ok");
      return { ok: true, queueRows: nextQueueRows };
    } catch (e) {
      setMessage(String(e), "error");
      return { ok: false, queueRows };
    }
  };

  /**
   * 移動前の保存。キューはフィルタ切替・保存応答・手動再読込・大量スキップ時に更新する。
   */
  const resolveNavigationQueue = async (): Promise<{
    ok: boolean;
    queueRows: QueueEntry[];
  }> => {
    return saveCurrentIfDirty();
  };

  // 大量スキップ時: スキップが発生したシートだけ index を再構築する。
  const refreshQueueRows = async (
    sheets?: string[]
  ): Promise<QueueEntry[] | null> => {
    try {
      const sheetParam =
        sheets && sheets.length
          ? `&sheet=${sheets.map(encodeURIComponent).join(",")}`
          : "";
      const res = await fetch(
        `/api/queue?${optionsQuery(options)}&refresh=true${sheetParam}`
      );
      const data = await res.json();
      if (!res.ok) return null;
      const rows = (data.queue ?? []) as QueueEntry[];
      setQueueRows(rows);
      statusMemoRef.current.clear();
      return rows;
    } catch {
      return null;
    }
  };

  // 探索して次/前の対象行へジャンプする（途中行は描画しない）。
  const navigate = async (dir: "next" | "prev") => {
    if (loading) return;
    setLoading(true);
    try {
      const saved = await resolveNavigationQueue();
      if (!saved.ok) return;
      let q = saved.queueRows;
      const removed = new Set<string>();
      let ci = indexOfEntry(q, currentEntry);
      if (dir === "prev" && ci < 0) ci = q.length;
      let skipped = 0;
      let refreshed = false;
      const refreshTargets = new Set<string>();
      const filtered = options.statusFilter !== "all";
      setMessage(dir === "next" ? "次の対象行を探索中…" : "前の対象行を探索中…");
      while (true) {
        ci = dir === "next" ? ci + 1 : ci - 1;
        while (ci >= 0 && ci < q.length && removed.has(entryKey(q[ci]))) {
          ci = dir === "next" ? ci + 1 : ci - 1;
        }
        if (ci < 0 || ci >= q.length) {
          if (dir === "next") setMessage("キューの末尾です。", "ok");
          else {
            setMessage("");
            showToast("前の行がありません");
          }
          return;
        }
        const cand = q[ci];

        if (filtered) {
          // A+B+C: status はメモ優先。未取得なら先読みで一括取得（batchGet）。
          let status = statusMemoRef.current.get(entryKey(cand));
          if (status === undefined) {
            await primeStatusesAhead(q, ci, dir, removed);
            status = statusMemoRef.current.get(entryKey(cand)) ?? "";
          }
          if (shouldSkipLiveStatus(status)) {
            removed.add(entryKey(cand));
            refreshTargets.add(cand.sheet);
            skipped += 1;
            if (!refreshed && skipped >= NAV_REFRESH_SKIP_THRESHOLD) {
              refreshed = true;
              const r = await refreshQueueRows([...refreshTargets]);
              if (r) {
                q = r;
                removed.clear();
                refreshTargets.clear();
                ci = indexOfEntry(q, currentEntry);
                if (dir === "prev" && ci < 0) ci = q.length;
              }
            }
            continue;
          }
        }

        // C: 着地は行全体を1回取得するだけ（probe との二重取得をしない）。
        const payload = await fetchRowPayload(cand, options);
        statusMemoRef.current.set(
          entryKey(cand),
          payload.columns.find((c) => c.isStatus)?.value ?? ""
        );
        // 着地: ここで初めて描画する。
        const finalQ = q.filter((e) => !removed.has(entryKey(e)));
        setRowPayload(payload);
        syncEditsFromPayload(payload);
        setMessage("");
        setQueueRows(finalQ);
        const nextHistory = history.slice(0, historyIndex + 1);
        nextHistory.push(cand);
        setHistory(nextHistory);
        setHistoryIndex(nextHistory.length - 1);
        const idx = indexOfEntry(finalQ, cand);
        if (idx >= 0) setQueueIndex(idx);
        break;
      }
    } catch (e) {
      setMessage(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  const goPrev = () => void navigate("prev");
  const goNext = () => void navigate("next");

  const goJump = async () => {
    const target = Number(
      (document.getElementById("jumpRow") as HTMLInputElement | null)?.value
    );
    if (!target || target < 2) {
      setMessage("行番号は 2 以上を指定してください。", "error");
      return;
    }
    const sheetId =
      jumpSheet || currentEntry?.sheet || bootstrap?.sheets[0]?.id || "";
    if (!sheetId) {
      setMessage("シートを選択してください。", "error");
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      const saved = await resolveNavigationQueue();
      if (!saved.ok) return;
      const q = saved.queueRows;
      const entry: QueueEntry = { sheet: sheetId, row: target };

      setMessage("行を読み込み中…");
      const payload = await fetchRowPayload(entry, options);

      if (
        options.worker &&
        options.worker !== ASSIGN_ALL_ROWS_NAME &&
        payload.assignee &&
        payload.assignee !== options.worker
      ) {
        setMessage(
          `指定行（${payload.sheetLabel} 行${target}）は他の作業者「${payload.assignee}」の担当のため開けません。`,
          "error"
        );
        return;
      }

      const nextHistory = history.slice(0, historyIndex + 1);
      nextHistory.push(entry);
      setHistory(nextHistory);
      setHistoryIndex(nextHistory.length - 1);
      const idx = indexOfEntry(q, entry);
      if (idx >= 0) setQueueIndex(idx);
      if (idx < 0) {
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

  const resetEdits = () => {
    if (!dirty) return;
    setEdits(originalEdits);
    setMessage("変更を破棄しました。");
  };

  const clearCache = async (
    target: "all" | "nav" | "rows" | "wiki" = "all"
  ) => {
    const labels: Record<typeof target, string> = {
      all: "全キャッシュ",
      nav: "キュー",
      rows: "行データ",
      wiki: "正しいwiki 候補",
    };
    if (loading) return;
    setLoading(true);
    try {
      setMessage(`${labels[target]}を更新中…`);
      const res = await fetch(`/api/cache?target=${target}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("キャッシュの更新に失敗");
      setMessage(`${labels[target]}を更新しました。`, "ok");
      // ナビ（キュー）・全体はキュー再構築が必要。行/候補は再読込不要。
      if (target === "all" || target === "nav") {
        await loadQueue(options, true, true);
      }
    } finally {
      setLoading(false);
    }
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

  const displayPos = indexOfEntry(queueRows, currentEntry);

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
              {bootstrap && bootstrap.extraAssignees.length > 0 && (
                <optgroup label="その他（シート上の担当名）">
                  {bootstrap.extraAssignees.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              )}
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
                対象行リストを更新
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() =>
                  clearCache("rows").catch((e) => setMessage(String(e), "error"))
                }
              >
                表示中の行を再取得
              </button>
            </div>
            <div className={styles.btnRow}>
              <button
                type="button"
                className={styles.secondary}
                onClick={() =>
                  clearCache("wiki").catch((e) => setMessage(String(e), "error"))
                }
              >
                候補再構築
              </button>
            </div>
          </div>
        </aside>

        <main className={styles.main}>
          {!bootstrap && <div className={styles.empty}>読み込み中…</div>}

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
                キュー {displayPos >= 0 ? displayPos + 1 : "-"} / {queueRows.length}
                {" · "}
                <strong>{rowPayload.sheetLabel}</strong> 行{" "}
                {rowPayload.sheetRowNumber}
              </div>
              <WorkRowTable
                columns={rowPayload.columns}
                edits={edits}
                indexRows={options.indexRows}
                rowKey={`${rowPayload.sheet}#${rowPayload.sheetRowNumber}`}
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
                  {bootstrap && bootstrap.sheets.length > 1 && (
                    <select
                      className={styles.jumpSheet}
                      value={jumpSheet}
                      onChange={(e) => setJumpSheet(e.target.value)}
                      aria-label="開くシート"
                    >
                      {bootstrap.sheets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    id="jumpRow"
                    type="number"
                    min={2}
                    className={styles.jumpInput}
                    defaultValue={rowPayload.sheetRowNumber}
                    key={`${rowPayload.sheet}#${rowPayload.sheetRowNumber}`}
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
