"use client";

import styles from "./WorkRowTable.module.css";
import type { ColumnPayload } from "@/lib/types";
import { WORK_STATUS_OPTIONS } from "@/lib/config";
import { isHttpUrl } from "@/lib/columns";
import { LinkWithPreview } from "./LinkWithPreview";

type Props = {
  columns: ColumnPayload[];
  edits: Record<string, string>;
  onEdit: (uniqueName: string, value: string) => void;
};

export function WorkRowTable({ columns, edits, onEdit }: Props) {
  return (
    <div className={styles.outer}>
      <div className={styles.track}>
        {columns.map((col) => {
          const classes = [styles.col];
          if (col.isLeading) classes.push(styles.leading);
          if (col.isWiki && !col.inline) classes.push(styles.wiki);
          if (col.inline) classes.push(styles.edit);

          return (
            <div key={col.uniqueName} className={classes.join(" ")}>
              <div className={styles.letter}>{col.letter}</div>
              <div className={styles.header}>{col.rawHeader}</div>
              {col.inline ? (
                col.isStatus ? (
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
                ) : col.isMemo || col.isWikiEdit ? (
                  <textarea
                    className={styles.textarea}
                    value={edits[col.uniqueName] ?? col.value}
                    onChange={(e) => onEdit(col.uniqueName, e.target.value)}
                  />
                ) : (
                  <input
                    className={styles.input}
                    value={edits[col.uniqueName] ?? col.value}
                    onChange={(e) => onEdit(col.uniqueName, e.target.value)}
                  />
                )
              ) : isHttpUrl(col.display) ? (
                <div className={styles.readonly}>
                  <LinkWithPreview href={col.display.trim()} />
                </div>
              ) : (
                <div className={styles.readonly}>{col.display}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
