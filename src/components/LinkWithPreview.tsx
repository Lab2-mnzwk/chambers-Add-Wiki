"use client";

import { useEffect, useState } from "react";
import { fetchLinkPreviewTitleClient } from "@/lib/link-preview-client";
import styles from "./WorkRowTable.module.css";

type Props = {
  href: string;
};

/** 行表示時にプレビューを取得し、ホバーで概要を表示するリンク */
export function LinkWithPreview({ href }: Props) {
  const [preview, setPreview] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchLinkPreviewTitleClient(href).then((title) => {
      if (!cancelled) setPreview(title);
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
