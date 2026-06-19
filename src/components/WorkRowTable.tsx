"use client";

import { useEffect, useRef } from "react";
import styles from "./WorkRowTable.module.css";
import type { ColumnPayload } from "@/lib/types";
import { COL_ASSIGNEE, LEADING_COLUMN_PAIRS, WORK_STATUS_OPTIONS } from "@/lib/config";
import { isHttpUrl } from "@/lib/columns";
import { contextSearchUrl, googleSearchUrl } from "@/lib/search-links";
import { LinkWithPreview } from "./LinkWithPreview";
import { WikiCorrectInput } from "./WikiCorrectInput";

type Props = {
  columns: ColumnPayload[];
  edits: Record<string, string>;
  indexRows: number;
  /** 表示中のシート行番号。変化したら横スクロール位置を先頭に戻す。 */
  rowKey: number;
  /** 出来事名（AC列）。文脈検索リンクのクエリに使用。 */
  eventName: string;
  onEdit: (uniqueName: string, value: string) => void;
};

function renderColumnBody(
  col: ColumnPayload,
  edits: Record<string, string>,
  indexRows: number,
  eventName: string,
  onEdit: (uniqueName: string, value: string) => void
) {
  if (col.isWikiEdit && col.tripletDeweyHasValue) {
    return (
      <div className={styles.deweyLabel}>DeweyIDありのため入力不要</div>
    );
  }
  if (col.inline) {
    if (col.isStatus) {
      return (
        <select
          className={styles.select}
          value={edits[col.uniqueName] ?? col.value}
          onChange={(e) => onEdit(col.uniqueName, e.target.value)}
        >
          {WORK_STATUS_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }
    if (col.isWikiEdit) {
      return (
        <WikiCorrectInput
          value={edits[col.uniqueName] ?? col.value}
          onChange={(v) => onEdit(col.uniqueName, v)}
          tripletName={col.tripletName}
          tripletWiki={col.tripletWiki}
          indexRows={indexRows}
        />
      );
    }
    if (col.isMemo) {
      return (
        <textarea
          className={styles.textarea}
          value={edits[col.uniqueName] ?? col.value}
          onChange={(e) => onEdit(col.uniqueName, e.target.value)}
        />
      );
    }
    return (
      <input
        className={styles.input}
        value={edits[col.uniqueName] ?? col.value}
        onChange={(e) => onEdit(col.uniqueName, e.target.value)}
      />
    );
  }
  if (isHttpUrl(col.display)) {
    return (
      <div className={styles.readonly}>
        <LinkWithPreview href={col.display.trim()} />
      </div>
    );
  }
  const searchable = col.isWikiName && col.display !== "—";
  return (
    <div className={styles.readonly}>
      {searchable ? (
        <a
          className={styles.nameLink}
          href={googleSearchUrl(col.display)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {col.display}
          <span className={styles.linkArrow}> ↗</span>
        </a>
      ) : (
        <div>{col.display}</div>
      )}
      {searchable && (
        <a
          className={styles.googleSearch}
          href={contextSearchUrl(eventName, col.display)}
          target="_blank"
          rel="noopener noreferrer"
        >
          文脈検索↗
        </a>
      )}
    </div>
  );
}

function renderColumn(
  col: ColumnPayload,
  edits: Record<string, string>,
  indexRows: number,
  eventName: string,
  onEdit: (uniqueName: string, value: string) => void,
  stacked = false
) {
  const classes = [styles.col];
  if (col.isLeading) classes.push(stacked ? styles.leadingStacked : styles.leading);
  // 3列セット（名称/Wiki/正しいwiki）と memo は実シート同様の水色系。編集欄の有無で可否は分かる。
  if (col.isWiki || col.isMemo) classes.push(styles.wiki);
  // Status / Assignee は実シート同様の黄色系。
  if (col.isStatus || col.rawHeader === COL_ASSIGNEE) classes.push(styles.keyCol);

  return (
    <div key={col.uniqueName} className={classes.join(" ")}>
      <div className={styles.letter}>{col.letter}</div>
      <div className={styles.header}>{col.rawHeader}</div>
      {renderColumnBody(col, edits, indexRows, eventName, onEdit)}
    </div>
  );
}

export function WorkRowTable({ columns, edits, indexRows, rowKey, eventName, onEdit }: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  // 行が切り替わったら横スクロール位置を先頭（左端）に戻す。
  useEffect(() => {
    if (outerRef.current) outerRef.current.scrollLeft = 0;
  }, [rowKey]);

  const colByHeader = new Map(columns.map((c) => [c.rawHeader, c]));
  const leadingHeaders = new Set<string>(LEADING_COLUMN_PAIRS.flat());
  const leadingPairs = LEADING_COLUMN_PAIRS.map(([top, bottom]) =>
    [colByHeader.get(top), colByHeader.get(bottom)].filter(
      (c): c is ColumnPayload => !!c
    )
  ).filter((pair) => pair.length > 0);
  const restCols = columns.filter((c) => !leadingHeaders.has(c.rawHeader));

  return (
    <div ref={outerRef} className={styles.outer}>
      <div className={styles.track}>
        {leadingPairs.length > 0 && (
          <div className={styles.leadingBlock}>
            {leadingPairs.map((pair) => (
              <div
                key={pair.map((c) => c.uniqueName).join("-")}
                className={styles.leadingPair}
              >
                {pair.map((col) => renderColumn(col, edits, indexRows, eventName, onEdit, true))}
              </div>
            ))}
          </div>
        )}
        {restCols.map((col) => renderColumn(col, edits, indexRows, eventName, onEdit))}
      </div>
    </div>
  );
}
