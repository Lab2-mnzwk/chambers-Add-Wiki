"""Google Sheets 作業データのサーバー内キャッシュ（SQLite）。

同一 Streamlit ワーカー上の全セッションで共有され、
Sheets API は初回同期・明示的な再読み込み・書き込み時のみ使用する。
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path

import pandas as pd

META_SPREADSHEET_TITLE = "spreadsheet_title"
META_RAW_HEADERS = "raw_headers"
META_UNIQUE_HEADERS = "unique_headers"
META_COL_COUNT = "col_count"
META_INDEX_ROWS = "index_rows"
META_INDEX_SYNCED_AT = "index_synced_at"
META_WORKSHEET_GID = "worksheet_gid"


def default_cache_path(spreadsheet_id: str) -> Path:
    cache_dir = Path(os.environ.get("SHEET_CACHE_DIR", ".cache"))
    return cache_dir / f"{spreadsheet_id}.sqlite"


class SheetStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS meta (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS queue_index (
                        sheet_row_number INTEGER PRIMARY KEY,
                        renban TEXT NOT NULL DEFAULT '',
                        status TEXT NOT NULL DEFAULT '',
                        assignee TEXT NOT NULL DEFAULT ''
                    );
                    CREATE TABLE IF NOT EXISTS row_data (
                        sheet_row_number INTEGER PRIMARY KEY,
                        values_json TEXT NOT NULL,
                        synced_at REAL NOT NULL
                    );
                    """
                )
                conn.commit()
            finally:
                conn.close()

    def _get_meta(self, key: str) -> str | None:
        conn = self._connect()
        try:
            row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
            return None if row is None else str(row["value"])
        finally:
            conn.close()

    def _set_meta(self, key: str, value: str) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "INSERT INTO meta(key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (key, value),
                )
                conn.commit()
            finally:
                conn.close()

    def clear_all(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.executescript(
                    "DELETE FROM meta; DELETE FROM queue_index; DELETE FROM row_data;"
                )
                conn.commit()
            finally:
                conn.close()

    def cache_stats(self) -> dict[str, int | float | None]:
        conn = self._connect()
        try:
            index_count = conn.execute("SELECT COUNT(*) AS c FROM queue_index").fetchone()["c"]
            row_count = conn.execute("SELECT COUNT(*) AS c FROM row_data").fetchone()["c"]
        finally:
            conn.close()
        synced_at_raw = self._get_meta(META_INDEX_SYNCED_AT)
        synced_at = float(synced_at_raw) if synced_at_raw else None
        return {
            "index_rows_cached": int(index_count),
            "data_rows_cached": int(row_count),
            "index_synced_at": synced_at,
            "index_rows_limit": int(self._get_meta(META_INDEX_ROWS) or 0),
        }

    def get_structure(self) -> tuple[str, list[str], list[str], int] | None:
        title = self._get_meta(META_SPREADSHEET_TITLE)
        raw_json = self._get_meta(META_RAW_HEADERS)
        unique_json = self._get_meta(META_UNIQUE_HEADERS)
        col_count_raw = self._get_meta(META_COL_COUNT)
        if not title or not raw_json or not unique_json or not col_count_raw:
            return None
        return (
            title,
            json.loads(raw_json),
            json.loads(unique_json),
            int(col_count_raw),
        )

    def set_structure(
        self,
        spreadsheet_title: str,
        raw_headers: list[str],
        unique_headers: list[str],
        col_count: int,
    ) -> None:
        self._set_meta(META_SPREADSHEET_TITLE, spreadsheet_title)
        self._set_meta(META_RAW_HEADERS, json.dumps(raw_headers, ensure_ascii=False))
        self._set_meta(META_UNIQUE_HEADERS, json.dumps(unique_headers, ensure_ascii=False))
        self._set_meta(META_COL_COUNT, str(col_count))

    def get_worksheet_gid(self) -> int | None:
        raw = self._get_meta(META_WORKSHEET_GID)
        if raw is None:
            return None
        try:
            return int(raw)
        except ValueError:
            return None

    def set_worksheet_gid(self, gid: int) -> None:
        self._set_meta(META_WORKSHEET_GID, str(gid))

    def has_queue_index(self, index_rows: int) -> bool:
        limit_raw = self._get_meta(META_INDEX_ROWS)
        if limit_raw is None or int(limit_raw) != index_rows:
            return False
        conn = self._connect()
        try:
            count = conn.execute("SELECT COUNT(*) AS c FROM queue_index").fetchone()["c"]
            return int(count) > 0
        finally:
            conn.close()

    def load_queue_index(self, status_col: str, assignee_col: str) -> pd.DataFrame:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT sheet_row_number, renban, status, assignee FROM queue_index "
                "ORDER BY sheet_row_number"
            ).fetchall()
        finally:
            conn.close()
        if not rows:
            return pd.DataFrame(
                columns=["_sheet_row_number", "連番", status_col, assignee_col]
            )
        records = [
            {
                "_sheet_row_number": int(row["sheet_row_number"]),
                "連番": row["renban"] or "",
                status_col: row["status"] or "",
                assignee_col: row["assignee"] or "",
            }
            for row in rows
        ]
        return pd.DataFrame(records)

    def save_queue_index(
        self,
        index_df: pd.DataFrame,
        index_rows: int,
        status_col: str,
        assignee_col: str,
    ) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("DELETE FROM queue_index")
                for _, row in index_df.iterrows():
                    conn.execute(
                        "INSERT INTO queue_index(sheet_row_number, renban, status, assignee) "
                        "VALUES (?, ?, ?, ?)",
                        (
                            int(row["_sheet_row_number"]),
                            str(row.get("連番", "") or ""),
                            str(row.get(status_col, "") or ""),
                            str(row.get(assignee_col, "") or ""),
                        ),
                    )
                conn.commit()
            finally:
                conn.close()
        self._set_meta(META_INDEX_ROWS, str(index_rows))
        self._set_meta(META_INDEX_SYNCED_AT, str(time.time()))

    def patch_queue_index(
        self,
        plan: pd.DataFrame,
        status_col: str,
        assignee_col: str,
    ) -> None:
        allowed = {"連番", status_col, assignee_col}
        with self._lock:
            conn = self._connect()
            try:
                for _, item in plan.iterrows():
                    col_name = item["DataFrame列名"]
                    if col_name not in allowed:
                        continue
                    sheet_row = int(item["行番号"])
                    value = str(item["書き込み値"])
                    if col_name == "連番":
                        conn.execute(
                            "UPDATE queue_index SET renban = ? WHERE sheet_row_number = ?",
                            (value, sheet_row),
                        )
                    elif col_name == status_col:
                        conn.execute(
                            "UPDATE queue_index SET status = ? WHERE sheet_row_number = ?",
                            (value, sheet_row),
                        )
                    elif col_name == assignee_col:
                        conn.execute(
                            "UPDATE queue_index SET assignee = ? WHERE sheet_row_number = ?",
                            (value, sheet_row),
                        )
                conn.commit()
            finally:
                conn.close()

    def get_row_values(self, sheet_row_number: int) -> list[str] | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT values_json FROM row_data WHERE sheet_row_number = ?",
                (sheet_row_number,),
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return None
        return json.loads(row["values_json"])

    def save_row_values(self, sheet_row_number: int, values: list[str]) -> None:
        payload = json.dumps(values, ensure_ascii=False)
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "INSERT INTO row_data(sheet_row_number, values_json, synced_at) "
                    "VALUES (?, ?, ?) "
                    "ON CONFLICT(sheet_row_number) DO UPDATE SET "
                    "values_json = excluded.values_json, synced_at = excluded.synced_at",
                    (sheet_row_number, payload, time.time()),
                )
                conn.commit()
            finally:
                conn.close()

    def patch_row_values(
        self,
        sheet_row_number: int,
        unique_headers: list[str],
        plan: pd.DataFrame,
    ) -> None:
        values = self.get_row_values(sheet_row_number)
        if values is None:
            return
        width = len(unique_headers)
        if len(values) < width:
            values = values + [""] * (width - len(values))
        for _, item in plan.iterrows():
            if int(item["行番号"]) != sheet_row_number:
                continue
            col_name = item["DataFrame列名"]
            if col_name not in unique_headers:
                continue
            idx = unique_headers.index(col_name)
            values[idx] = str(item["書き込み値"])
        self.save_row_values(sheet_row_number, values[:width])
