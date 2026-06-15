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
import { ASSIGN_ALL_ROWS_NAME } from "@/lib/config";

const PREFS_KEY = "wikiWorkNext";

const defaultOptions: WorkOptions = {
  // 初回（localStorage 無し）の既定。作業者名は「全件表示」、
  // 表示は Entity値有り ON / deweyID有りを除く OFF。
  worker: ASSIGN_ALL_ROWS_NAME,
  queueFilter: "自分担当",
  skipDone: true,
  lightBlueOnly: false,
  showNamedTriplets: true,
  fullEditMode: false,
  indexRows: 30000,
};

function loadStoredOptions(): WorkOptions {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaultOptions;
    const prefs = JSON.parse(raw) as Partial<WorkOptions>;
    return { ...defaultOptions, ...prefs, queueFilter: "自分担当" };
  } catch {
    return defaultOptions;
  }
}

function optionsQuery(options: WorkOptions): string {
  const params = new URLSearchParams({
    worker: options.worker,
    queueFilter: options.queueFilter,
    skipDone: String(options.skipDone),
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

export function WorkApp() {
  const { data: session, status: sessionStatus } = useSession();
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
  // 直近で「キューに適用済み」の識別子（worker/skipDone/indexRows）。
  // 適用が成功したときだけ更新する。保存失敗で再読込を中止した場合に、
  // トグルを直前の適用値へ巻き戻すための基準にも使う。
  const appliedQueueKeyRef = useRef<{
    worker: string;
    skipDone: boolean;
    indexRows: number;
  } | null>(null);
  // プログラムによるトグル巻き戻しで再発火した effect 実行を 1 回だけスキップするフラグ。
  const revertingQueueOptionRef = useRef(false);
  // queueRows を書き換える非同期処理の世代カウンタ。
  // 後発の書込が常に最新。古い in-flight 応答（例: skipDone=ON で算出された
  // キュー）が後から届いて上書きするのを防ぐ。
  const queueWriteSeqRef = useRef(0);

  const currentRow = useMemo(() => {
    if (historyIndex >= 0 && history[historyIndex]) return history[historyIndex];
    if (queueRows.length) return queueRows[queueIndex];
    return null;
  }, [history, historyIndex, queueRows, queueIndex]);

  const dirty = useMemo(
    () => editsDiffer(edits, originalEdits),
    [edits, originalEdits]
  );

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
        nextHistory = [rows[0]];
        nextHistoryIndex = 0;
        nextQueueIndex = 0;
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
    if (sessionStatus === "loading") return;
    loadPrefs();
    fetch("/api/bootstrap")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setBootstrap(data as BootstrapPayload);
      })
      .catch((e) => setMessage(String(e), "error"));
  }, [loadPrefs, sessionStatus, session?.user?.email]);

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
      // インデックス行数をサーバー既定（シート全行をカバー）まで引き上げる。
      // localStorage に古い小さい値（例: 10000）が残るユーザーもシート全行が対象になる。
      if (
        bootstrap.defaultIndexRows &&
        prev.indexRows < bootstrap.defaultIndexRows
      ) {
        next = { ...next, indexRows: bootstrap.defaultIndexRows };
      }
      if (next !== prev) savePrefs(next);
      return next;
    });
  }, [bootstrap, savePrefs]);

  useEffect(() => {
    if (!bootstrap || bootstrap.authRequired) return;
    if (!options.worker) return;

    // トグル巻き戻しによる再発火はキュー再読込・保存をせず 1 回だけ飲み込む。
    if (revertingQueueOptionRef.current) {
      revertingQueueOptionRef.current = false;
      return;
    }

    savePrefs(options);

    const prevApplied = appliedQueueKeyRef.current;
    const workerChanged = prevApplied != null && prevApplied.worker !== options.worker;
    const keepPosition = prevApplied != null && !workerChanged;
    void (async () => {
      // キュー再読込（skipDone/indexRows・作業者変更）の前に未保存編集を自動保存する。
      // 移動操作と同じ挙動に統一し、再読込で編集（例: Status 変更）が消えるのを防ぐ。
      const saved = await saveCurrentIfDirty();
      if (!saved.ok) {
        // 保存失敗時はトグル状態とキューが食い違わないよう、直前の適用値へ巻き戻す。
        if (
          prevApplied &&
          (prevApplied.worker !== options.worker ||
            prevApplied.skipDone !== options.skipDone ||
            prevApplied.indexRows !== options.indexRows)
        ) {
          revertingQueueOptionRef.current = true;
          const reverted = {
            ...options,
            worker: prevApplied.worker,
            skipDone: prevApplied.skipDone,
            indexRows: prevApplied.indexRows,
          };
          setOptions(reverted);
          savePrefs(reverted);
        }
        return;
      }
      appliedQueueKeyRef.current = {
        worker: options.worker,
        skipDone: options.skipDone,
        indexRows: options.indexRows,
      };
      await loadQueue(options, keepPosition);
    })().catch((e) => setMessage(String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap, options.worker, options.skipDone, options.indexRows]);

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

  // 表示モードの UI 派生状態（内部フラグ showNamedTriplets / lightBlueOnly へ対応）。
  // Entity値有り: 名称三つ組をセット表示（OFF=全列表示）。
  // deweyID有りを除く: Entity値有りのサブ。deweyID に値がある組（=判断不要）を除外。
  const entityValueOn = options.showNamedTriplets || options.lightBlueOnly;
  const excludeDeweyOn = !options.showNamedTriplets && options.lightBlueOnly;

  const setEntityValue = (on: boolean) =>
    void applyDisplayOptions(
      on
        ? { ...options, showNamedTriplets: true, lightBlueOnly: false, fullEditMode: false }
        : { ...options, showNamedTriplets: false, lightBlueOnly: false }
    );

  const setExcludeDewey = (on: boolean) =>
    void applyDisplayOptions(
      on
        ? { ...options, showNamedTriplets: false, lightBlueOnly: true, fullEditMode: false }
        : { ...options, showNamedTriplets: true, lightBlueOnly: false }
    );

  const setFullEditMode = (on: boolean) =>
    void applyDisplayOptions({ ...options, fullEditMode: on });

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

  const goPrev = async () => {
    if (historyIndex <= 0 || loading) return;
    setLoading(true);
    try {
      const saved = await saveCurrentIfDirty();
      if (!saved.ok) return;
      const q = saved.queueRows;
      let nextIndex = historyIndex - 1;
      if (options.skipDone) {
        // 最新キュー（patch 反映済みキャッシュ由来）に存在しない行＝完了/対象外として戻り時もスキップ。
        while (nextIndex >= 0 && !q.includes(history[nextIndex])) {
          nextIndex -= 1;
        }
        if (nextIndex < 0) {
          showToast("前の未完了行がありません");
          return;
        }
      }
      setHistoryIndex(nextIndex);
      const row = history[nextIndex];
      const idx = q.indexOf(row);
      if (idx >= 0) setQueueIndex(idx);
      await loadRow(row, options);
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
      const saved = await saveCurrentIfDirty();
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
    try {
      const saved = await saveCurrentIfDirty();
      if (!saved.ok) return;
      const q = saved.queueRows;
      const next =
        currentRow != null
          ? q.find((r) => r > currentRow) ?? null
          : q[0] ?? null;
      if (next == null) {
        setMessage("キューの末尾です。", "ok");
        return;
      }
      const nextHistory = history.slice(0, historyIndex + 1);
      nextHistory.push(next);
      setHistory(nextHistory);
      setHistoryIndex(nextHistory.length - 1);
      const idx = q.indexOf(next);
      if (idx >= 0) setQueueIndex(idx);
      await loadRow(next, options);
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
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>PJ140 Wiki付与</h1>
        </header>
        {session?.error && (
          <p className={styles.statusError}>
            Google 認証の有効期限が切れました。再度ログインしてください。
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
        </div>
        <div className={styles.headerActions}>
          {bootstrap?.authMode === "oauth" && bootstrap.userEmail ? (
            <div className={styles.userBlock}>
              <span className={styles.userEmail}>{bootstrap.userEmail}</span>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => signOut({ callbackUrl: "/" })}
              >
                ログアウト
              </button>
            </div>
          ) : (
            <p className={styles.metaCompact}>読み込み中…</p>
          )}
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
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={options.skipDone}
                onChange={(e) => updateOption("skipDone", e.target.checked)}
              />
              完了行をスキップ
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={entityValueOn}
                disabled={options.fullEditMode}
                onChange={(e) => setEntityValue(e.target.checked)}
              />
              Entity値有り
            </label>
            <label className={`${styles.check} ${styles.checkSub}`}>
              <input
                type="checkbox"
                checked={excludeDeweyOn}
                disabled={options.fullEditMode || !entityValueOn}
                onChange={(e) => setExcludeDewey(e.target.checked)}
              />
              deweyID有りを除く
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={options.fullEditMode}
                onChange={(e) => setFullEditMode(e.target.checked)}
              />
              列表示・編集（AN〜FT）
            </label>

            <label className={styles.label}>表示テーマ</label>
            <select
              value={themeMode}
              onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>

            <label className={styles.label}>インデックス行数</label>
            <input
              type="number"
              min={100}
              max={Math.max(bootstrap?.defaultIndexRows ?? 0, 30000)}
              step={1000}
              value={options.indexRows}
              onChange={(e) =>
                updateOption("indexRows", Number(e.target.value) || 30000)
              }
            />

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
                onEdit={(uniqueName, value) =>
                  setEdits((prev) => ({ ...prev, [uniqueName]: value }))
                }
              />
              <div className={styles.navBar}>
                <button
                  type="button"
                  className={styles.navPrev}
                  disabled={historyIndex <= 0}
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
