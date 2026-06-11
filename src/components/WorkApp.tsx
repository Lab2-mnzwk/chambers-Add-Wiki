"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./WorkApp.module.css";
import { WorkRowTable } from "./WorkRowTable";
import type {
  BootstrapPayload,
  QueueFilter,
  RowPayload,
  WorkOptions,
} from "@/lib/types";
import { applyTheme, loadThemeMode, type ThemeMode } from "@/lib/theme";

const PREFS_KEY = "wikiWorkNext";

const defaultOptions: WorkOptions = {
  worker: "",
  queueFilter: "未担当＋自分担当",
  skipDone: true,
  lightBlueOnly: true,
  showEmptyFromAc: false,
  indexRows: 10000,
};

function optionsQuery(options: WorkOptions): string {
  const params = new URLSearchParams({
    worker: options.worker,
    queueFilter: options.queueFilter,
    skipDone: String(options.skipDone),
    lightBlueOnly: String(options.lightBlueOnly),
    showEmptyFromAc: String(options.showEmptyFromAc),
    indexRows: String(options.indexRows),
  });
  return params.toString();
}

function rowQuery(options: WorkOptions): string {
  return `showEmptyFromAc=${options.showEmptyFromAc}&lightBlueOnly=${options.lightBlueOnly}`;
}

export function WorkApp() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [options, setOptions] = useState<WorkOptions>(defaultOptions);
  const [queueRows, setQueueRows] = useState<number[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [rowPayload, setRowPayload] = useState<RowPayload | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"" | "ok" | "error">("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");

  const currentRow = useMemo(() => {
    if (historyIndex >= 0 && history[historyIndex]) return history[historyIndex];
    if (queueRows.length) return queueRows[queueIndex];
    return null;
  }, [history, historyIndex, queueRows, queueIndex]);

  const setMessage = (text: string, kind: "" | "ok" | "error" = "") => {
    setStatus(text);
    setStatusKind(kind);
  };

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 3500);
  };

  const loadPrefs = useCallback(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw) as Partial<WorkOptions>;
      setOptions((prev) => ({ ...prev, ...prefs }));
    } catch {
      /* ignore */
    }
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
  };

  const loadRow = useCallback(
    async (sheetRowNumber: number, opts: WorkOptions) => {
      setMessage("行を読み込み中…");
      const res = await fetch(`/api/row/${sheetRowNumber}?${rowQuery(opts)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "行の読み込みに失敗");
      setRowPayload(data as RowPayload);
      syncEditsFromPayload(data as RowPayload);
      setMessage("");
    },
    []
  );

  const loadQueue = useCallback(
    async (opts: WorkOptions, keepPosition: boolean) => {
      setMessage("キューを読み込み中…");
      const res = await fetch(`/api/queue?${optionsQuery(opts)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "キューの読み込みに失敗");
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
    loadPrefs();
    fetch("/api/bootstrap")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setBootstrap(data as BootstrapPayload);
      })
      .catch((e) => setMessage(String(e), "error"));
  }, [loadPrefs]);

  useEffect(() => {
    if (!bootstrap) return;
    savePrefs(options);
    loadQueue(options, true).catch((e) => setMessage(String(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bootstrap,
    options.worker,
    options.queueFilter,
    options.skipDone,
    options.lightBlueOnly,
    options.showEmptyFromAc,
    options.indexRows,
  ]);

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

  const goPrev = () => {
    if (historyIndex <= 0) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    const row = history[nextIndex];
    const idx = queueRows.indexOf(row);
    if (idx >= 0) setQueueIndex(idx);
    loadRow(row, options).catch((e) => setMessage(String(e), "error"));
  };

  const goJump = () => {
    const target = Number(
      (document.getElementById("jumpRow") as HTMLInputElement | null)?.value
    );
    if (!target || target < 2) {
      setMessage("行番号は 2 以上を指定してください。", "error");
      return;
    }
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(target);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
    const idx = queueRows.indexOf(target);
    if (idx >= 0) setQueueIndex(idx);
    if (!queueRows.includes(target)) {
      showToast("現在のキュー外の行です（表示のみ）");
    }
    loadRow(target, options).catch((e) => setMessage(String(e), "error"));
  };

  const saveAndNext = async () => {
    if (!currentRow || loading) return;
    setLoading(true);
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

      if (data.nextSheetRowNumber) {
        setMessage(`${data.savedCells} セルを保存しました。`, "ok");
        const next = data.nextSheetRowNumber as number;
        const nextHistory = history.slice(0, historyIndex + 1);
        nextHistory.push(next);
        setHistory(nextHistory);
        setHistoryIndex(nextHistory.length - 1);
        const idx = queueRows.indexOf(next);
        if (idx >= 0) setQueueIndex(idx);
        await loadRow(next, options);
      } else {
        setMessage("保存しました（キューの末尾です）。", "ok");
      }
    } catch (e) {
      setMessage(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  const clearCache = async () => {
    await fetch("/api/cache", { method: "DELETE" });
    setMessage("キャッシュをクリアしました。", "ok");
    await loadQueue(options, true);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Wiki付与 行作業</h1>
          <p className={styles.meta}>
            {bootstrap
              ? `${bootstrap.spreadsheetTitle} / ${bootstrap.sheetName}${
                  bootstrap.enableWrites ? "" : "（書き込み OFF）"
                } · Next.js`
              : "読み込み中…"}
          </p>
        </div>
        {bootstrap && (
          <a
            className={styles.sheetLink}
            href={bootstrap.sheetUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            作業シートを開く ↗
          </a>
        )}
      </header>

      <div className={styles.layout}>
        <aside className={styles.settings}>
          <h2 className={styles.settingsTitle}>作業設定</h2>

          <label className={styles.label}>表示テーマ</label>
          <select
            value={themeMode}
            onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>

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

          <label className={styles.label}>対象行</label>
          <select
            value={options.queueFilter}
            onChange={(e) =>
              updateOption("queueFilter", e.target.value as QueueFilter)
            }
          >
            <option value="未担当＋自分担当">未担当＋自分担当</option>
            <option value="未担当">未担当</option>
            <option value="自分担当">自分担当</option>
            <option value="すべて">すべて</option>
          </select>

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
              checked={options.lightBlueOnly}
              onChange={(e) => updateOption("lightBlueOnly", e.target.checked)}
            />
            AC列以降は水色列のみ
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={options.showEmptyFromAc}
              onChange={(e) =>
                updateOption("showEmptyFromAc", e.target.checked)
              }
            />
            AC列以降の空列も表示
          </label>

          <label className={styles.label}>インデックス行数</label>
          <input
            type="number"
            min={100}
            max={10000}
            step={100}
            value={options.indexRows}
            onChange={(e) =>
              updateOption("indexRows", Number(e.target.value) || 10000)
            }
          />

          <div className={styles.btnRow}>
            <button
              type="button"
              className={styles.secondary}
              onClick={() =>
                loadQueue(options, true).catch((e) =>
                  setMessage(String(e), "error")
                )
              }
            >
              キュー再読込
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => clearCache().catch((e) => setMessage(String(e), "error"))}
            >
              キャッシュクリア
            </button>
          </div>
        </aside>

        <main className={styles.main}>
          {!queueRows.length && bootstrap && (
            <div className={styles.empty}>
              条件に一致する行がありません。フィルタを変更してください。
            </div>
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
                    onClick={goJump}
                  >
                    開く
                  </button>
                </div>
                <button
                  type="button"
                  className={styles.navNext}
                  disabled={loading}
                  onClick={saveAndNext}
                >
                  次の行→（保存）
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
