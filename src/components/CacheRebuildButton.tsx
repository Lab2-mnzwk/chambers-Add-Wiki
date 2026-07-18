"use client";

import { useState } from "react";
import styles from "./CacheRebuildButton.module.css";

/**
 * 全キャッシュ再構築（メンテナンス用）。日常操作では不要なため、作業画面には置かず
 * 使い方ガイド下部にのみ設置する（`/api/cache?target=all`）。
 */
export function CacheRebuildButton() {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">(
    "idle"
  );
  const [message, setMessage] = useState("");

  const run = async () => {
    setState("loading");
    setMessage("");
    try {
      const res = await fetch("/api/cache?target=all", { method: "DELETE" });
      if (!res.ok) throw new Error("再構築に失敗しました。");
      setState("ok");
      setMessage("全キャッシュを再構築しました。作業画面を再読み込みしてください。");
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.button}
        disabled={state === "loading"}
        onClick={() => void run()}
      >
        {state === "loading" ? "再構築中…" : "全キャッシュ再構築"}
      </button>
      {message && (
        <p
          className={`${styles.status} ${
            state === "ok" ? styles.statusOk : ""
          } ${state === "error" ? styles.statusError : ""}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
