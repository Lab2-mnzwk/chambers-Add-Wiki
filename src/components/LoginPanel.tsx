"use client";

import { signIn } from "next-auth/react";
import styles from "./LoginPanel.module.css";

type Props = {
  sheetUrl?: string;
};

export function LoginPanel({ sheetUrl }: Props) {
  return (
    <div className={styles.panel}>
      <h2 className={styles.title}>Google ログイン</h2>
      <p className={styles.text}>
        作業シートへのアクセスは、あなたの Google アカウントの権限を使います。
        スプレッドシートの編集権限があるアカウントでログインしてください。
      </p>
      <button
        type="button"
        className={styles.primary}
        onClick={() => signIn("google", { callbackUrl: "/" })}
      >
        Google でログイン
      </button>
      {sheetUrl && (
        <a
          className={styles.link}
          href={sheetUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          作業シートを開く ↗
        </a>
      )}
    </div>
  );
}
