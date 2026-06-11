"use client";

import { useEffect, useState } from "react";
import styles from "./WorkRowTable.module.css";

const clientCache = new Map<string, string>();

type Props = {
  href: string;
};

/** 行表示時にプレビューを取得し、ホバーで概要を表示するリンク */
export function LinkWithPreview({ href }: Props) {
  const [preview, setPreview] = useState(() => clientCache.get(href) ?? "");

  useEffect(() => {
    const cached = clientCache.get(href);
    if (cached !== undefined) {
      setPreview(cached);
      return;
    }

    let cancelled = false;
    fetch(`/api/link-preview?url=${encodeURIComponent(href)}`)
      .then((response) => response.json())
      .then((data: { preview?: string }) => {
        if (cancelled) return;
        const title = data.preview ?? "";
        clientCache.set(href, title);
        setPreview(title);
      })
      .catch(() => {
        if (!cancelled) clientCache.set(href, "");
      });

    return () => {
      cancelled = true;
    };
  }, [href]);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={preview ? styles.linkPreview : undefined}
      data-preview={preview || undefined}
      title={preview || undefined}
    >
      {href}
    </a>
  );
}
