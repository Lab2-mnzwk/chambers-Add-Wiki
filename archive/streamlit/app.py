"""Wiki付与 行作業 — Streamlit 版（旧）。本番は nextjs/ を使用。"""

import json
import re
from html import escape, unescape
from pathlib import Path
from urllib.parse import quote, unquote, urlparse
from urllib.request import Request, urlopen

import gspread
import pandas as pd
import streamlit as st
import streamlit.components.v1 as components
from google.oauth2.service_account import Credentials
from gspread.exceptions import APIError
from gspread.utils import ValueInputOption

from sheet_store import SheetStore, default_cache_path

SPREADSHEET_ID = "1jGba1Vnzjlvf6dNj6hqVRYoPEkcJVkeU1dND-vnThrY"
SERVICE_ACCOUNT_FILE = ".streamlit/service_account.json"
SHEET_NAME = "wiki付与作業シート（第一弾）"
ASSIGN_SHEET_NAME = "アサイン"
DISCORD_NAME_COLUMN = "discord名"
ASSIGN_NAMES_CACHE_TTL = 3600
SESSION_DISCORD_NAMES_KEY = "_discord_names_cache"

COL_STATUS_WORK = "Status.1"
COL_ASSIGNEE = "Assignee"

# --- 書き込みロック（二段階） ---
ENABLE_SHEET_WRITES = True
ALLOW_PRODUCTION_WRITES = True
WRITE_TARGET_SHEET_NAME = "wiki付与作業シート（第一弾）"

WRITE_DENYLIST_COL_LETTERS = frozenset({"AE"})
STATUS_NOT_STARTED = "未着手"
STATUS_DONE = "完了"
STATUS_NEEDS_REVIEW = "要確認"
WORK_STATUS_OPTIONS = [STATUS_NOT_STARTED, STATUS_DONE, STATUS_NEEDS_REVIEW]

# AC列より手前は常に表示（S〜Z相当）
LEADING_FIXED_HEADERS = [
    "head_page",    # S
    "tail_page",    # T
    "通し番号",      # U
    "連番",          # W
    "STARTDATE",    # Y
    "ENDDATE",      # Z
]

WORK_TABLE_START_HEADER = "ENTITY_NAME"  # AC列から通常扱い（値がある列のみ表示）
WORK_STATUS_COL_LETTER = "FG"
WORK_ASSIGNEE_COL_LETTER = "FH"
DEFAULT_INDEX_ROWS = 10000
ROW_CACHE_PREFIX = "row_data_"
# サーバー内 SQLite キャッシュ（同一ワーカー上の全ユーザーで Sheets 読取を共有）
USE_SERVER_CACHE = True
INLINE_COL_MIN_PX = 128
INLINE_LEADING_MIN_PX = 86
NAV_CONTROL_FONT_PX = 16
WORK_ROW_IFRAME_HEIGHT = 250

WORK_ROW_COMPONENT_CSS = """
html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    font-family: "Source Sans Pro", -apple-system, sans-serif;
}
.work-inline-outer {
    overflow-x: auto;
    overflow-y: hidden;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid rgba(250, 250, 250, 0.18);
    border-radius: 8px;
    padding: 4px 2px 8px;
}
.work-inline-track {
    display: flex;
    flex-wrap: nowrap;
    width: max-content;
    gap: 6px;
    padding: 4px 6px;
}
.work-inline-col {
    border: 1px solid rgba(160, 165, 175, 0.5);
    border-radius: 6px;
    padding: 8px 10px;
    min-height: 120px;
    box-sizing: border-box;
    background: #3d4450;
    display: flex;
    flex-direction: column;
}
.work-inline-col-readonly {
    background: #3d4450;
}
.work-inline-col-leading {
    padding: 8px 6px;
}
.work-inline-col-wiki {
    background: #2f4563;
    border-color: rgba(125, 180, 255, 0.55);
}
.work-inline-col-edit {
    background: #4a4028;
    border: 2px solid #c99700;
    box-shadow: inset 0 0 0 1px rgba(255, 220, 100, 0.2);
}
.work-inline-letter {
    font-size: 13px;
    font-weight: 700;
    color: rgba(250, 250, 250, 0.78);
    text-align: center;
}
.work-inline-header {
    font-size: 14px;
    font-weight: 700;
    color: #f5f5f5;
    margin: 4px 0 8px;
    word-break: break-word;
}
.work-inline-readonly {
    font-size: 16px;
    line-height: 1.45;
    color: #f5f5f5;
    word-break: break-word;
}
.work-inline-col-wiki .work-inline-readonly {
    flex: 1 1 auto;
    min-height: 72px;
}
.work-inline-readonly a {
    color: #9ec5ff;
    text-decoration: underline;
    word-break: break-all;
}
.work-inline-readonly a[data-preview] {
    position: relative;
}
.work-inline-readonly a[data-preview]:hover::after {
    content: attr(data-preview);
    position: absolute;
    left: 0;
    bottom: calc(100% + 6px);
    z-index: 5;
    min-width: 120px;
    max-width: 360px;
    padding: 8px 10px;
    background: rgba(16, 20, 28, 0.98);
    color: #f5f5f5;
    border: 1px solid rgba(125, 180, 255, 0.55);
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.45;
    white-space: normal;
    word-break: break-word;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    pointer-events: none;
}
.work-inline-native-input,
.work-inline-native-select {
    width: 100%;
    box-sizing: border-box;
    background: #fff8dc;
    color: #1a1a1a;
    border: 2px solid #c99700;
    border-radius: 6px;
    font-size: 16px;
    padding: 6px 8px;
}
.work-inline-native-textarea {
    flex: 1 1 auto;
    min-height: 72px;
    line-height: 1.45;
    font-family: inherit;
    resize: vertical;
}
.work-inline-native-select {
    flex: 0 0 auto;
}
"""

WORK_ROW_SYNC_SCRIPT = """
<script>
function syncInlineValues() {
  const data = {};
  document.querySelectorAll("[data-inline-key]").forEach((el) => {
    data[el.getAttribute("data-inline-key")] = el.value;
  });
  window.parent.postMessage({
    isStreamlitMessage: true,
    type: "streamlit:setComponentValue",
    value: data
  }, "*");
}
let inlineSyncTimer = null;
function scheduleInlineSync() {
  clearTimeout(inlineSyncTimer);
  inlineSyncTimer = setTimeout(syncInlineValues, 500);
}
document.querySelectorAll("[data-inline-key]").forEach((el) => {
  if (el.tagName === "SELECT") {
    el.addEventListener("change", syncInlineValues);
    el.addEventListener("blur", syncInlineValues);
  } else {
    el.addEventListener("blur", syncInlineValues);
    el.addEventListener("input", scheduleInlineSync);
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        syncInlineValues();
      }
    });
  }
});
window.parent.postMessage({
  isStreamlitMessage: true,
  type: "streamlit:setFrameHeight",
  height: __HEIGHT__
}, "*");
</script>
"""


def build_light_blue_work_headers() -> frozenset[str]:
    """Sheets 1行目で水色背景の Wiki 作業列（手入力欄）。"""
    names: set[str] = {
        "Agent_memo",
        "Place_memo",
        "Patient-Theme_memo",
        "Territory_memo",
    }

    for i in range(1, 6):
        names.add(f"A_name{i}")
    for i in range(6, 9):
        names.add(f"A_{i}")
    for i in range(1, 9):
        names.update({f"A_Wiki{i}", f"A_正しいwiki{i}"})

    for i in range(1, 6):
        names.update({f"Pl_name{i}", f"Pl_Wiki{i}", f"Pl_正しいwiki{i}"})

    for i in range(1, 8):
        names.update({f"P-T_{i}", f"P-T_Wiki{i}", f"P-T_正しいwiki{i}"})

    for i in range(1, 10):
        names.update({f"Te_name{i}", f"Te_Wiki{i}", f"Te_正しいwiki{i}"})

    return frozenset(names)


LIGHT_BLUE_WORK_HEADERS = build_light_blue_work_headers()

MEMO_WORK_HEADERS = (
    "Agent_memo",
    "Place_memo",
    "Patient-Theme_memo",
    "Territory_memo",
)

MEMO_SECTION_BY_HEADER = {
    "Agent_memo": "Agent",
    "Place_memo": "Place",
    "Patient-Theme_memo": "Patient-Theme",
    "Territory_memo": "Territory",
}

COMPONENT_INLINE_SNAPSHOT_KEY = "_component_inline_snapshot"
PENDING_SAVE_ROW_KEY = "_pending_save_row"
FLUSH_NONCE_KEY = "_flush_nonce"
LAST_COMPONENT_FLUSH_KEY = "_last_component_flush"


def is_memo_work_column(raw_header: str) -> bool:
    return raw_header in MEMO_WORK_HEADERS or raw_header.endswith("_memo")


def is_work_status_column(raw_header: str, col_index: int) -> bool:
    return (
        column_letter(col_index) == WORK_STATUS_COL_LETTER and raw_header == "Status"
    )


def resolve_work_status_unique(
    raw_headers: list[str], unique_headers: list[str]
) -> str | None:
    """FG列の作業用 Status（unique 名は Status または Status.1 など）。"""
    for i, raw in enumerate(raw_headers):
        if is_work_status_column(raw, i + 1):
            return unique_headers[i]
    return None


def section_for_work_raw_header(raw_header: str) -> str | None:
    if raw_header.startswith("Pl_"):
        return "Place"
    if raw_header.startswith("P-T_"):
        return "Patient-Theme"
    if raw_header.startswith("Te_"):
        return "Territory"
    if (
        raw_header.startswith("A_name")
        or raw_header.startswith("A_Wiki")
        or raw_header.startswith("A_正しいwiki")
        or raw_header in {f"A_{i}" for i in range(6, 9)}
    ):
        return "Agent"
    return None


def active_work_sections(
    work_cols: list[str],
    raw_headers: list[str],
    unique_headers: list[str],
) -> set[str]:
    header_by_unique = dict(zip(unique_headers, raw_headers))
    sections: set[str] = set()
    for col_name in work_cols:
        raw_header = header_by_unique.get(col_name, col_name)
        if is_memo_work_column(raw_header):
            continue
        section = section_for_work_raw_header(raw_header)
        if section:
            sections.add(section)
    return sections


def should_show_memo_column(raw_header: str, active_sections: set[str]) -> bool:
    """各 memo は、対応する作業列（A_name 等）が表示対象のときだけ出す。"""
    section = MEMO_SECTION_BY_HEADER.get(raw_header)
    if section is None:
        return False
    return section in active_sections


def filter_memo_display_columns(
    work_cols: list[str],
    raw_headers: list[str],
    unique_headers: list[str],
) -> list[str]:
    header_by_unique = dict(zip(unique_headers, raw_headers))
    non_memo = [
        col
        for col in work_cols
        if not is_memo_work_column(header_by_unique.get(col, col))
    ]
    active = active_work_sections(non_memo, raw_headers, unique_headers)
    filtered: list[str] = list(non_memo)
    for raw_header, unique_name in zip(raw_headers, unique_headers):
        if not is_memo_work_column(raw_header):
            continue
        if should_show_memo_column(raw_header, active) and unique_name not in filtered:
            filtered.append(unique_name)
    return [name for name in unique_headers if name in set(filtered)]


def build_wiki_triplet_rules() -> list[tuple[str, str, str]]:
    """名称列と Wiki 列の両方に値があるとき、正しいwiki 列も表示する。"""
    rules: list[tuple[str, str, str]] = []

    for i in range(1, 6):
        rules.append((f"A_name{i}", f"A_Wiki{i}", f"A_正しいwiki{i}"))
    for i in range(6, 9):
        rules.append((f"A_{i}", f"A_Wiki{i}", f"A_正しいwiki{i}"))

    for i in range(1, 6):
        rules.append((f"Pl_name{i}", f"Pl_Wiki{i}", f"Pl_正しいwiki{i}"))

    for i in range(1, 8):
        rules.append((f"P-T_{i}", f"P-T_Wiki{i}", f"P-T_正しいwiki{i}"))

    for i in range(1, 10):
        rules.append((f"Te_name{i}", f"Te_Wiki{i}", f"Te_正しいwiki{i}"))

    return rules


WIKI_TRIPLET_RULES = build_wiki_triplet_rules()

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

st.set_page_config(page_title="Wiki付与 行作業", layout="wide")
st.title("Wiki付与 行作業ビュー")

WORK_ROW_COMPONENT = components.declare_component(
    "work_row_component",
    path=str(Path(__file__).parent / "components" / "work_row"),
)


@st.cache_resource
def get_client():
    """ローカル: JSON ファイル / Cloud: st.secrets[gcp_service_account]。"""
    credentials = None
    secrets_error: str | None = None
    try:
        if "gcp_service_account" in st.secrets:
            credentials = Credentials.from_service_account_info(
                dict(st.secrets["gcp_service_account"]),
                scopes=SCOPES,
            )
    except FileNotFoundError:
        credentials = None
    except Exception as exc:
        secrets_error = str(exc)
        credentials = None

    if credentials is None:
        json_path = Path(SERVICE_ACCOUNT_FILE)
        if not json_path.exists():
            hint = (
                "Streamlit Cloud: アプリ管理 → Settings → Secrets に "
                "`secrets.toml.example` と同じ TOML 形式で `[gcp_service_account]` を貼り付け、"
                "Save 後に Reboot app してください。"
                "（JSON をそのまま貼ると動きません）"
            )
            if secrets_error:
                hint = f"Secrets の読み込みに失敗しました: {secrets_error}\n\n{hint}"
            raise FileNotFoundError(
                f"{SERVICE_ACCOUNT_FILE} が見つかりません。\n\n{hint}"
            )
        credentials = Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE,
            scopes=SCOPES,
        )

    return gspread.authorize(credentials)


@st.cache_resource
def get_sheet_store() -> SheetStore:
    return SheetStore(default_cache_path(SPREADSHEET_ID))


def make_unique_headers(headers: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    unique: list[str] = []

    for header in headers:
        name = header or "(空列名)"
        if name not in seen:
            seen[name] = 0
            unique.append(name)
            continue

        seen[name] += 1
        unique.append(f"{name}.{seen[name]}")

    return unique


def column_letter(col_index: int) -> str:
    return gspread.utils.rowcol_to_a1(1, col_index)[:-1]


def column_index_from_letter(letter: str) -> int:
    return gspread.utils.a1_to_rowcol(f"{letter}1")[1]


def effective_col_count(col_count: int, unique_headers: list[str]) -> int:
    """FG/FH まで必ず読める列数（キャッシュされた col_count が古い場合の保険）。"""
    required = max(col_count, len(unique_headers))
    for letter in (WORK_STATUS_COL_LETTER, WORK_ASSIGNEE_COL_LETTER):
        required = max(required, column_index_from_letter(letter))
    return required


def is_cell_empty(value) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and pd.isna(value):
        return True
    return str(value).strip() == ""


def normalize_work_status(value) -> str:
    """FG列 Status を表示・保存用の3択に正規化。"""
    if is_cell_empty(value):
        return STATUS_NOT_STARTED
    val_str = str(value).strip()
    if val_str in WORK_STATUS_OPTIONS:
        return val_str
    return STATUS_NOT_STARTED


def is_wiki_dash(value) -> bool:
    return str(value).strip() == "-"


def has_display_wiki_value(value) -> bool:
    """Wiki 列として表示対象となる値（空・'-' 以外）。"""
    return not is_cell_empty(value) and not is_wiki_dash(value)


def is_wiki_triplet_hidden(
    raw_header: str,
    row: pd.Series,
    header_map: dict[str, str],
) -> bool:
    """名称に値があり Wiki が '-' のとき、名称 / Wiki / 正しいwiki 列を出さない。"""
    for name_header, wiki_header, ok_header in WIKI_TRIPLET_RULES:
        if raw_header not in (name_header, wiki_header, ok_header):
            continue
        name_unique = header_map.get(name_header)
        wiki_unique = header_map.get(wiki_header)
        if not name_unique or name_unique not in row.index:
            continue
        if is_cell_empty(row[name_unique]):
            continue
        if wiki_unique and wiki_unique in row.index and is_wiki_dash(row[wiki_unique]):
            return True
    return False


def visible_column_names(row: pd.Series, show_all_columns: bool) -> list[str]:
    """詳細エリア用: 非空列または全列。"""
    data_cols = [col for col in row.index if col != "_sheet_row_number"]

    if show_all_columns:
        return data_cols

    return [col for col in data_cols if not is_cell_empty(row[col])]


def resolve_header_to_unique(raw_headers: list[str], unique_headers: list[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for raw, unique in zip(raw_headers, unique_headers):
        if raw not in mapping:
            mapping[raw] = unique
    return mapping


def is_light_blue_work_column(raw_header: str, col_index: int) -> bool:
    """AC列以降で作業欄に出してよい列（水色ヘッダー + 作業用 Status/Assignee）。"""
    letter = column_letter(col_index)

    if letter == WORK_STATUS_COL_LETTER and raw_header == "Status":
        return True
    if letter == WORK_ASSIGNEE_COL_LETTER and raw_header == COL_ASSIGNEE:
        return True

    return raw_header in LIGHT_BLUE_WORK_HEADERS


def expand_wiki_triplet_columns(
    row: pd.Series,
    raw_headers: list[str],
    unique_headers: list[str],
    cols: list[str],
    *,
    light_blue_only: bool,
) -> list[str]:
    """
    名称列（A_name1 等）と Wiki 列（A_Wiki1 等）の両方に有効な値がある場合、
    対応する 正しいwiki 列を空欄でも表示対象に加える。
    名称に値があり Wiki が '-' の場合は名称 / Wiki / 正しいwiki を表示しない。
    """
    header_map = resolve_header_to_unique(raw_headers, unique_headers)
    col_set = set(cols)

    for name_header, wiki_header, ok_header in WIKI_TRIPLET_RULES:
        name_unique = header_map.get(name_header)
        wiki_unique = header_map.get(wiki_header)
        if not name_unique or name_unique not in row.index:
            continue
        if not wiki_unique or wiki_unique not in row.index:
            continue
        if is_cell_empty(row[name_unique]) or not has_display_wiki_value(row[wiki_unique]):
            continue

        if ok_header not in raw_headers:
            continue
        if light_blue_only and not is_light_blue_work_column(
            ok_header,
            raw_headers.index(ok_header) + 1,
        ):
            continue
        ok_unique = header_map.get(ok_header)
        if ok_unique and ok_unique in row.index:
            col_set.add(ok_unique)

    for name_header, wiki_header, ok_header in WIKI_TRIPLET_RULES:
        name_unique = header_map.get(name_header)
        wiki_unique = header_map.get(wiki_header)
        ok_unique = header_map.get(ok_header)
        if not name_unique or name_unique not in row.index:
            continue
        if is_cell_empty(row[name_unique]):
            continue
        if not wiki_unique or wiki_unique not in row.index:
            continue
        if not is_wiki_dash(row[wiki_unique]):
            continue
        col_set.discard(name_unique)
        col_set.discard(wiki_unique)
        if ok_unique:
            col_set.discard(ok_unique)

    leading = [
        header_map[header]
        for header in LEADING_FIXED_HEADERS
        if header_map.get(header) in col_set
    ]
    rest = [unique for unique in unique_headers if unique in col_set and unique not in leading]
    return leading + rest


def work_display_columns(
    row: pd.Series,
    raw_headers: list[str],
    unique_headers: list[str],
    *,
    show_empty_from_ac: bool = False,
    light_blue_only: bool = True,
) -> list[str]:
    """
    作業欄の表示列。
    - AC列より前: 常に表示
    - AC列以降: 値がある列のみ + 水色列のみ（既定）
    """
    header_map = resolve_header_to_unique(raw_headers, unique_headers)
    cols: list[str] = []

    for header in LEADING_FIXED_HEADERS:
        unique_name = header_map.get(header)
        if unique_name and unique_name in row.index:
            cols.append(unique_name)

    try:
        start_index = raw_headers.index(WORK_TABLE_START_HEADER)
    except ValueError:
        start_index = len(raw_headers)

    for i in range(start_index, len(unique_headers)):
        unique_name = unique_headers[i]
        raw_header = raw_headers[i]

        if unique_name not in row.index or unique_name in cols:
            continue
        if light_blue_only and not is_light_blue_work_column(raw_header, i + 1):
            continue
        if (
            not show_empty_from_ac
            and is_cell_empty(row[unique_name])
            and not is_memo_work_column(raw_header)
        ):
            continue
        if is_memo_work_column(raw_header):
            continue
        if is_wiki_triplet_hidden(raw_header, row, header_map):
            continue
        cols.append(unique_name)

    return expand_wiki_triplet_columns(
        row,
        raw_headers,
        unique_headers,
        cols,
        light_blue_only=light_blue_only,
    )


def is_wiki_style_header(header: str) -> bool:
    return header in LIGHT_BLUE_WORK_HEADERS


def is_correct_wiki_header(raw_header: str) -> bool:
    return "正しいwiki" in raw_header


def is_inline_editable_column(unique_name: str, raw_header: str, col_index: int) -> bool:
    """作業表内で直接編集する列（正しいwiki / memo / 作業用 Status）。"""
    if is_work_status_column(raw_header, col_index):
        return True
    if is_memo_work_column(raw_header) or is_correct_wiki_header(raw_header):
        return is_writable_column(raw_header, col_index)
    return False


def inline_widget_key(sheet_row_number: int, unique_name: str) -> str:
    return f"inline_{sheet_row_number}_{unique_name}"


def form_widget_key(sheet_row_number: int, unique_name: str) -> str:
    return f"form_{sheet_row_number}_{unique_name}"


def ensure_work_display_cols(
    work_cols: list[str],
    raw_headers: list[str],
    unique_headers: list[str],
) -> list[str]:
    """Status と memo（セクション条件付き）を作業表に含める。"""
    col_set = set(work_cols)
    status_unique = resolve_work_status_unique(raw_headers, unique_headers)
    if status_unique:
        col_set.add(status_unique)
    ordered = [name for name in unique_headers if name in col_set]
    return filter_memo_display_columns(ordered, raw_headers, unique_headers)


def work_sheet_edit_url() -> str:
    """作業シートの Google Sheets URL（タブ指定付き）。"""
    base = f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit"
    if USE_SERVER_CACHE:
        gid = get_sheet_store().get_worksheet_gid()
        if gid is not None:
            return f"{base}#gid={gid}"
    return base


def is_writable_column(raw_header: str, col_index: int) -> bool:
    """Sheets 列記号・ヘッダー名ベースで書き込み可否を判定。"""
    letter = column_letter(col_index)
    if letter in WRITE_DENYLIST_COL_LETTERS:
        return False
    if is_work_status_column(raw_header, col_index):
        return True
    return raw_header in LIGHT_BLUE_WORK_HEADERS or raw_header == COL_ASSIGNEE


def collect_editable_columns(
    work_cols: list[str],
    raw_headers: list[str],
    unique_headers: list[str],
) -> list[tuple[str, str, str]]:
    """(unique名, rawヘッダー, 列記号) の編集対象列リスト。"""
    header_by_unique = dict(zip(unique_headers, raw_headers))
    seen: set[str] = set()
    editable: list[tuple[str, str, str]] = []

    def add_column(unique_name: str):
        if unique_name in seen or unique_name not in unique_headers:
            return
        col_index = unique_headers.index(unique_name) + 1
        raw_header = header_by_unique[unique_name]
        if not is_writable_column(raw_header, col_index):
            return
        seen.add(unique_name)
        editable.append((unique_name, raw_header, column_letter(col_index)))

    for unique_name in work_cols:
        add_column(unique_name)

    if COL_STATUS_WORK in unique_headers:
        add_column(COL_STATUS_WORK)
    status_unique = resolve_work_status_unique(raw_headers, unique_headers)
    if status_unique:
        add_column(status_unique)
    if COL_ASSIGNEE in unique_headers:
        add_column(COL_ASSIGNEE)

    return editable


def collect_form_editable_columns(
    work_cols: list[str],
    raw_headers: list[str],
    unique_headers: list[str],
) -> list[tuple[str, str, str]]:
    """インライン編集以外（Assignee 等）のフォーム入力列。"""
    return [
        item
        for item in collect_editable_columns(work_cols, raw_headers, unique_headers)
        if not is_inline_editable_column(item[0], item[1], unique_headers.index(item[0]) + 1)
    ]


def validate_write_target() -> None:
    if not ENABLE_SHEET_WRITES:
        raise RuntimeError("ENABLE_SHEET_WRITES=False のため書き込みできません（ドライランのみ）。")
    if WRITE_TARGET_SHEET_NAME == SHEET_NAME and not ALLOW_PRODUCTION_WRITES:
        raise RuntimeError(
            f"本番シート `{SHEET_NAME}` への書き込みは "
            "ALLOW_PRODUCTION_WRITES=False のため禁止されています。"
        )


def get_write_worksheet():
    validate_write_target()
    client = get_client()
    spreadsheet = client.open_by_key(SPREADSHEET_ID)
    return spreadsheet.worksheet(WRITE_TARGET_SHEET_NAME)


def build_write_plan(
    sheet_row_number: int,
    raw_headers: list[str],
    unique_headers: list[str],
    updates: dict[str, str],
) -> pd.DataFrame:
    rows: list[dict] = []
    for unique_name, value in updates.items():
        if unique_name not in unique_headers:
            continue
        col_index = unique_headers.index(unique_name) + 1
        raw_header = raw_headers[col_index - 1]
        if not is_writable_column(raw_header, col_index):
            continue
        letter = column_letter(col_index)
        rows.append(
            {
                "行番号": sheet_row_number,
                "列番号": col_index,
                "列記号": letter,
                "列名": raw_header,
                "DataFrame列名": unique_name,
                "セル": f"{letter}{sheet_row_number}",
                "書き込み値": value,
            }
        )
    return pd.DataFrame(rows)


def execute_write_plan(plan: pd.DataFrame) -> None:
    if plan.empty:
        return
    sheet = get_write_worksheet()
    payload = [
        {"range": row["セル"], "values": [[row["書き込み値"]]]}
        for _, row in plan.iterrows()
    ]
    sheet.batch_update(payload, value_input_option=ValueInputOption.user_entered)


def get_read_worksheet():
    client = get_client()
    spreadsheet = client.open_by_key(SPREADSHEET_ID)
    return spreadsheet.worksheet(SHEET_NAME)


def build_row_series(
    sheet_row_number: int,
    raw_headers: list[str],
    unique_headers: list[str],
    row_values: list[str],
) -> pd.Series:
    width = len(unique_headers)
    padded = row_values + [""] * max(0, width - len(row_values))
    data = dict(zip(unique_headers, padded[:width]))
    data["_sheet_row_number"] = sheet_row_number
    return pd.Series(data)


def column_range_for_rows(
    unique_headers: list[str],
    header_name: str,
    start_row: int,
    end_row: int,
) -> str | None:
    if header_name not in unique_headers:
        return None
    letter = column_letter(unique_headers.index(header_name) + 1)
    return f"{letter}{start_row}:{letter}{end_row}"


def fetch_queue_index_from_sheets(
    index_rows: int,
    raw_headers: list[str],
    unique_headers: list[str],
) -> pd.DataFrame:
    """Assignee / Status / 連番 だけ読んでキュー判定用インデックスを作る（1 batch_get）。"""
    sheet = get_read_worksheet()
    start_row = 2
    end_row = index_rows + 1
    status_header = resolve_work_status_unique(raw_headers, unique_headers) or COL_STATUS_WORK
    range_specs: list[tuple[str, str]] = []
    for header_name in ("連番", status_header, COL_ASSIGNEE):
        cell_range = column_range_for_rows(unique_headers, header_name, start_row, end_row)
        if cell_range:
            range_specs.append((header_name, cell_range))
    if not range_specs:
        return pd.DataFrame(columns=["_sheet_row_number", "連番", status_header, COL_ASSIGNEE])

    chunks = sheet.batch_get([r for _, r in range_specs])
    if len(range_specs) == 1:
        chunks = [chunks]

    col_data: dict[str, list[str]] = {}
    for (header_name, _), chunk in zip(range_specs, chunks):
        flat: list[str] = []
        for row in chunk:
            flat.append(row[0] if row else "")
        col_data[header_name] = flat

    row_count = max((len(v) for v in col_data.values()), default=0)

    records: list[dict] = []
    for i in range(row_count):
        records.append(
            {
                "_sheet_row_number": start_row + i,
                "連番": col_data.get("連番", [""] * row_count)[i]
                if i < len(col_data.get("連番", []))
                else "",
                COL_STATUS_WORK: col_data.get(status_header, [""] * row_count)[i]
                if i < len(col_data.get(status_header, []))
                else "",
                COL_ASSIGNEE: col_data.get(COL_ASSIGNEE, [""] * row_count)[i]
                if i < len(col_data.get(COL_ASSIGNEE, []))
                else "",
            }
        )
    return pd.DataFrame(records)


def load_sheet_structure():
    """ヘッダー行のみ取得（初回1 read、以降はサーバー内キャッシュ）。"""
    if USE_SERVER_CACHE:
        store = get_sheet_store()
        cached = store.get_structure()
        if cached is not None:
            title, raw_headers, unique_headers, col_count = cached
            return (
                title,
                raw_headers,
                unique_headers,
                effective_col_count(col_count, unique_headers),
            )

    sheet = get_read_worksheet()
    raw_headers = sheet.row_values(1)
    unique_headers = make_unique_headers(raw_headers)
    col_count = effective_col_count(sheet.col_count, unique_headers)
    result = sheet.spreadsheet.title, raw_headers, unique_headers, col_count
    if USE_SERVER_CACHE:
        store = get_sheet_store()
        store.set_structure(*result)
        store.set_worksheet_gid(sheet.id)
    return result


def overlay_live_work_cells(
    row_values: list[str],
    sheet_row_number: int,
    col_count: int,
    unique_headers: list[str],
) -> list[str]:
    """FG(Status) / FH(Assignee) だけ API から再取得して行データに上書き。"""
    read_width = effective_col_count(col_count, unique_headers)
    values = list(row_values)
    if len(values) < read_width:
        values.extend([""] * (read_width - len(values)))

    ranges = [
        f"{letter}{sheet_row_number}"
        for letter in (WORK_STATUS_COL_LETTER, WORK_ASSIGNEE_COL_LETTER)
    ]
    sheet = get_read_worksheet()
    chunks = sheet.batch_get(ranges)
    if len(ranges) == 1:
        chunks = [chunks]

    for letter, chunk in zip(
        (WORK_STATUS_COL_LETTER, WORK_ASSIGNEE_COL_LETTER), chunks
    ):
        col_idx = column_index_from_letter(letter) - 1
        cell_val = chunk[0][0] if chunk and chunk[0] else ""
        if col_idx >= len(values):
            values.extend([""] * (col_idx - len(values) + 1))
        values[col_idx] = cell_val
    return values


def load_queue_index(
    index_rows: int,
    raw_headers: list[str],
    unique_headers: list[str],
) -> pd.DataFrame:
    if USE_SERVER_CACHE:
        store = get_sheet_store()
        if store.has_queue_index(index_rows):
            return store.load_queue_index(COL_STATUS_WORK, COL_ASSIGNEE)

    index_df = fetch_queue_index_from_sheets(index_rows, raw_headers, unique_headers)
    if USE_SERVER_CACHE:
        get_sheet_store().save_queue_index(
            index_df, index_rows, COL_STATUS_WORK, COL_ASSIGNEE
        )
    return index_df


def fetch_sheet_row_from_api(
    sheet_row_number: int,
    col_count: int,
    unique_headers: list[str],
) -> list[str]:
    read_count = effective_col_count(col_count, unique_headers)
    sheet = get_read_worksheet()
    start = gspread.utils.rowcol_to_a1(sheet_row_number, 1)
    end = gspread.utils.rowcol_to_a1(sheet_row_number, read_count)
    values = sheet.get(f"{start}:{end}")
    if not values:
        row_values: list[str] = []
    else:
        row_values = values[0]
    return overlay_live_work_cells(
        row_values, sheet_row_number, col_count, unique_headers
    )


def fetch_sheet_row(
    sheet_row_number: int,
    col_count: int,
    unique_headers: list[str],
) -> list[str]:
    """表示行取得。本体はキャッシュ、FG/FH は毎回 API で上書き。"""
    read_count = effective_col_count(col_count, unique_headers)
    row_values: list[str] | None = None
    if USE_SERVER_CACHE:
        row_values = get_sheet_store().get_row_values(sheet_row_number)

    if row_values is None:
        row_values = fetch_sheet_row_from_api(
            sheet_row_number, col_count, unique_headers
        )
    else:
        row_values = overlay_live_work_cells(
            row_values, sheet_row_number, col_count, unique_headers
        )

    if len(row_values) < read_count:
        row_values = row_values + [""] * (read_count - len(row_values))

    if USE_SERVER_CACHE:
        get_sheet_store().save_row_values(sheet_row_number, row_values)
    return row_values


def row_cache_key(sheet_row_number: int) -> str:
    return f"{ROW_CACHE_PREFIX}{sheet_row_number}"


def ensure_queue_index(
    index_rows: int,
    raw_headers: list[str],
    unique_headers: list[str],
) -> pd.DataFrame:
    session_rows = st.session_state.get("_queue_index_rows")
    if "queue_index_df" in st.session_state and session_rows == index_rows:
        return st.session_state["queue_index_df"]
    index_df = load_queue_index(index_rows, raw_headers, unique_headers)
    st.session_state["queue_index_df"] = index_df
    st.session_state["_queue_index_rows"] = index_rows
    return index_df


def get_cached_row(
    sheet_row_number: int,
    raw_headers: list[str],
    unique_headers: list[str],
    col_count: int,
) -> pd.Series:
    """行データは SQLite/API から毎回取得（session の古い行キャッシュは使わない）。"""
    row_values = fetch_sheet_row(sheet_row_number, col_count, unique_headers)
    series = build_row_series(sheet_row_number, raw_headers, unique_headers, row_values)
    st.session_state[row_cache_key(sheet_row_number)] = series
    return series


def patch_row_cache(sheet_row_number: int, plan: pd.DataFrame) -> None:
    key = row_cache_key(sheet_row_number)
    if key not in st.session_state:
        return
    row = st.session_state[key].copy()
    for _, item in plan.iterrows():
        if int(item["行番号"]) != sheet_row_number:
            continue
        col_name = item["DataFrame列名"]
        if col_name in row.index:
            row[col_name] = item["書き込み値"]
    st.session_state[key] = row


def patch_queue_index(plan: pd.DataFrame) -> None:
    if "queue_index_df" not in st.session_state:
        return
    index_df = st.session_state["queue_index_df"]
    for _, item in plan.iterrows():
        sheet_row = int(item["行番号"])
        col_name = item["DataFrame列名"]
        if (
            item["列記号"] == WORK_STATUS_COL_LETTER
            and item["列名"] == "Status"
            and COL_STATUS_WORK in index_df.columns
        ):
            col_name = COL_STATUS_WORK
        if col_name not in index_df.columns:
            continue
        mask = index_df["_sheet_row_number"] == sheet_row
        if mask.any():
            index_df.loc[mask, col_name] = item["書き込み値"]
    if USE_SERVER_CACHE:
        store_plan = plan.copy()
        status_unique_mask = (
            (store_plan["列記号"] == WORK_STATUS_COL_LETTER)
            & (store_plan["列名"] == "Status")
        )
        store_plan.loc[status_unique_mask, "DataFrame列名"] = COL_STATUS_WORK
        get_sheet_store().patch_queue_index(store_plan, COL_STATUS_WORK, COL_ASSIGNEE)


def clear_all_data_cache() -> None:
    if USE_SERVER_CACHE:
        get_sheet_store().clear_all()
    load_assign_discord_names.clear()
    for key in list(st.session_state.keys()):
        if not isinstance(key, str):
            continue
        if key == "queue_index_df" or key.startswith(ROW_CACHE_PREFIX):
            del st.session_state[key]
    st.session_state.pop("_queue_index_rows", None)
    st.session_state.pop(SESSION_DISCORD_NAMES_KEY, None)
    st.session_state.pop(COMPONENT_INLINE_SNAPSHOT_KEY, None)
    st.session_state.pop(PENDING_SAVE_ROW_KEY, None)
    st.session_state.pop(LAST_COMPONENT_FLUSH_KEY, None)


def collect_inline_updates(
    sheet_row_number: int,
    work_cols: list[str],
    raw_headers: list[str],
    unique_headers: list[str],
) -> dict[str, str]:
    """iframe 編集値を session_state / 直近 component スナップショットから取得。"""
    header_by_unique = dict(zip(unique_headers, raw_headers))
    prefix = f"inline_{sheet_row_number}_"
    candidate_keys: dict[str, str] = {}

    snapshot = st.session_state.get(COMPONENT_INLINE_SNAPSHOT_KEY, {})
    if isinstance(snapshot, dict):
        for key, value in snapshot.items():
            if isinstance(key, str) and key.startswith(prefix):
                candidate_keys[key] = "" if value is None else str(value)

    for key, value in st.session_state.items():
        if isinstance(key, str) and key.startswith(prefix):
            candidate_keys[key] = str(value)

    updates: dict[str, str] = {}
    for key, value in candidate_keys.items():
        unique_name = key[len(prefix) :]
        if unique_name not in unique_headers:
            continue
        raw_header = header_by_unique[unique_name]
        col_index = unique_headers.index(unique_name) + 1
        if not is_inline_editable_column(unique_name, raw_header, col_index):
            continue
        updates[unique_name] = value
    return updates


def clear_row_edit_state(sheet_row_number: int) -> None:
    inline_prefix = f"inline_{sheet_row_number}_"
    form_prefix = f"form_{sheet_row_number}_"
    for key in list(st.session_state.keys()):
        if not isinstance(key, str):
            continue
        if key.startswith(inline_prefix) or key.startswith(form_prefix):
            del st.session_state[key]
    snapshot = st.session_state.get(COMPONENT_INLINE_SNAPSHOT_KEY)
    if isinstance(snapshot, dict):
        st.session_state[COMPONENT_INLINE_SNAPSHOT_KEY] = {
            key: value
            for key, value in snapshot.items()
            if not (isinstance(key, str) and key.startswith(inline_prefix))
        }
    if st.session_state.get(PENDING_SAVE_ROW_KEY) == sheet_row_number:
        st.session_state.pop(PENDING_SAVE_ROW_KEY, None)


def init_inline_widget_state(
    sheet_row_number: int,
    row: pd.Series,
    work_cols: list[str],
    raw_headers: list[str],
    unique_headers: list[str],
) -> None:
    header_by_unique = dict(zip(unique_headers, raw_headers))
    for col_name in work_cols:
        col_index = unique_headers.index(col_name) + 1
        raw_header = header_by_unique[col_name]
        if not is_inline_editable_column(col_name, raw_header, col_index):
            continue
        key = inline_widget_key(sheet_row_number, col_name)
        if key in st.session_state:
            continue
        current_val = row[col_name]
        if is_work_status_column(raw_header, col_index):
            st.session_state[key] = normalize_work_status(current_val)
            continue
        val_str = "" if is_cell_empty(current_val) else str(current_val)
        st.session_state[key] = val_str


def read_after_write(plan: pd.DataFrame) -> pd.DataFrame:
    if plan.empty:
        return plan.copy()
    sheet = get_write_worksheet()
    cells = plan["セル"].tolist()
    values = sheet.batch_get(cells)
    if len(values) != len(cells):
        values = [values] if len(cells) == 1 else values
    verified: list[dict] = []
    for row_dict, cell_values in zip(plan.to_dict("records"), values):
        actual = cell_values[0][0] if cell_values and cell_values[0] else None
        verified.append(
            {**row_dict, "読取値": "" if actual is None else str(actual)}
        )
    return pd.DataFrame(verified)


def write_mode_label() -> str:
    if not ENABLE_SHEET_WRITES:
        return "ドライラン（書き込み予定の確認のみ）"
    if WRITE_TARGET_SHEET_NAME == SHEET_NAME and ALLOW_PRODUCTION_WRITES:
        return f"本番書き込み → `{SHEET_NAME}`"
    return f"検証書き込み → `{WRITE_TARGET_SHEET_NAME}`"


def render_write_result(plan: pd.DataFrame, *, dry_run: bool, verbose: bool = True) -> bool:
    if verbose:
        st.subheader("書き込み予定" if dry_run else "書き込み内容")
        st.dataframe(
            plan[["行番号", "列記号", "列名", "DataFrame列名", "書き込み値"]],
            use_container_width=True,
            hide_index=True,
        )
    if dry_run:
        st.info("ENABLE_SHEET_WRITES=False のため Sheets には書き込んでいません。")
        return True

    try:
        execute_write_plan(plan)
        if verbose:
            verified = read_after_write(plan)
            st.success(f"`{WRITE_TARGET_SHEET_NAME}` へ {len(plan)} セルを書き込みました。")
            st.subheader("read-after-write")
            st.dataframe(
                verified[["セル", "列記号", "列名", "書き込み値", "読取値"]],
                use_container_width=True,
                hide_index=True,
            )
        return True
    except Exception as e:
        st.error(f"書き込み失敗: {e}")
        return False


def save_current_row(
    sheet_row_number: int,
    work_cols: list[str],
    raw_headers: list[str],
    unique_headers: list[str],
    worker: str,
) -> bool:
    updates = collect_inline_updates(
        sheet_row_number, work_cols, raw_headers, unique_headers
    )
    if COL_ASSIGNEE in unique_headers and worker:
        updates[COL_ASSIGNEE] = worker

    plan = build_write_plan(
        sheet_row_number,
        raw_headers,
        unique_headers,
        updates,
    )
    if plan.empty:
        st.warning("書き込み対象セルがありません。")
        return False

    dry_run = not ENABLE_SHEET_WRITES
    if not render_write_result(plan, dry_run=dry_run, verbose=False):
        return False

    if dry_run:
        render_write_result(plan, dry_run=True, verbose=True)
        return False

    clear_row_edit_state(sheet_row_number)
    patch_row_cache(sheet_row_number, plan)
    patch_queue_index(plan)
    if USE_SERVER_CACHE:
        get_sheet_store().patch_row_values(sheet_row_number, unique_headers, plan)
    st.session_state.pending_advance = True
    return True


def render_navigation(
    queue_sheet_rows: list[int],
    sheet_row_number: int,
    work_cols: list[str],
    raw_headers: list[str],
    unique_headers: list[str],
    worker: str,
    max_sheet_row: int,
) -> None:
    history_index = st.session_state.history_index
    can_go_back = history_index > 0
    sync_key = "_jump_input_row"
    if st.session_state.get(sync_key) != sheet_row_number:
        st.session_state.jump_row_input = sheet_row_number
        st.session_state[sync_key] = sheet_row_number

    nav = st.columns([1, 2, 1], vertical_alignment="center")
    with nav[0]:
        if st.button("← 前の行", disabled=not can_go_back, use_container_width=True):
            go_back_row_history()
            st.rerun()

    with nav[1]:
        jump_input, jump_btn = st.columns([3, 1], vertical_alignment="center")
        with jump_input:
            target_row = st.number_input(
                "シート行番号",
                min_value=2,
                max_value=max_sheet_row,
                step=1,
                key="jump_row_input",
                label_visibility="collapsed",
            )
        with jump_btn:
            if st.button("開く", use_container_width=True):
                ok, message = jump_to_sheet_row(int(target_row), max_sheet_row)
                if ok:
                    clear_row_edit_state(sheet_row_number)
                    if int(target_row) not in queue_sheet_rows:
                        st.toast(
                            "現在のキュー外の行です（表示のみ）",
                            icon="ℹ️",
                        )
                    st.rerun()
                elif message:
                    st.warning(message)

    with nav[2]:
        if st.button("次へ（保存）", type="primary", use_container_width=True):
            st.session_state[PENDING_SAVE_ROW_KEY] = sheet_row_number
            st.session_state[FLUSH_NONCE_KEY] = (
                int(st.session_state.get(FLUSH_NONCE_KEY, 0)) + 1
            )
            st.rerun()


WORK_TABLE_CSS = """
<style>
/* --- ERROR / 通知 --- */
div[data-testid="stAlert"] {
    background-color: #5a1219 !important;
    border: 2px solid #ff7070 !important;
    border-radius: 10px !important;
    padding: 0.75rem 1rem !important;
}
div[data-testid="stAlert"] p,
div[data-testid="stAlert"] span,
div[data-testid="stAlert"] code {
    color: #fff0f0 !important;
    font-weight: 600 !important;
}
div[data-testid="stAlert"] svg {
    color: #ffb4b4 !important;
}

/* --- 入力欄（正しいwiki / Status） --- */
div[data-testid="stTextInput"] input,
div[data-testid="stTextInput"] textarea {
    background-color: #fff8dc !important;
    color: #1a1a1a !important;
    border: 2px solid #c99700 !important;
    border-radius: 6px !important;
    font-size: 16px !important;
}
div[data-testid="stTextInput"] input:focus,
div[data-testid="stTextInput"] textarea:focus {
    border-color: #e6b800 !important;
    box-shadow: 0 0 0 2px rgba(230, 184, 0, 0.35) !important;
}
div[data-testid="stSelectbox"] div[data-baseweb="select"] > div {
    background-color: #fff8dc !important;
    color: #1a1a1a !important;
    border: 2px solid #c99700 !important;
    border-radius: 6px !important;
    font-size: 16px !important;
}
div[data-testid="stSelectbox"] svg {
    color: #6b5200 !important;
}

/* --- 行移動ナビ（作業欄と同程度の文字サイズ） --- */
div[data-testid="stHorizontalBlock"]:has([data-testid="stNumberInput"]) div[data-testid="stButton"] > button {
    font-size: """ + str(NAV_CONTROL_FONT_PX) + """px !important;
    font-weight: 600 !important;
    min-height: 42px !important;
    padding: 0.45rem 0.9rem !important;
}
div[data-testid="stHorizontalBlock"]:has([data-testid="stNumberInput"]) div[data-testid="stNumberInput"] input {
    font-size: """ + str(NAV_CONTROL_FONT_PX) + """px !important;
    font-weight: 600 !important;
    min-height: 42px !important;
}

.work-sheet-wrap {
    overflow-x: auto;
    border: 1px solid rgba(250, 250, 250, 0.18);
    border-radius: 8px;
    margin: 0.25rem 0 1rem 0;
}
.work-sheet-table {
    border-collapse: collapse;
    width: max-content;
    min-width: 100%;
    font-size: 16px;
    line-height: 1.5;
}
.work-sheet-table th,
.work-sheet-table td {
    border: 1px solid rgba(250, 250, 250, 0.16);
    padding: 14px 16px;
    vertical-align: middle;
    text-align: left;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
    max-width: 240px;
    min-width: 80px;
}
.work-sheet-table .col-letter {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(250, 250, 250, 0.85);
    font-size: 14px;
    font-weight: 700;
    text-align: center;
    white-space: nowrap;
}
.work-sheet-table .col-header {
    background: rgba(255, 255, 255, 0.05);
    color: rgba(250, 250, 250, 0.92);
    font-size: 15px;
    font-weight: 700;
}
.work-sheet-table .col-header-wiki {
    background: rgba(120, 180, 255, 0.28);
    color: rgba(250, 250, 250, 0.96);
}
.work-sheet-table .col-value-wiki {
    background: rgba(120, 180, 255, 0.12);
}
.work-sheet-table .col-value {
    background: rgba(0, 0, 0, 0.15);
    color: rgba(250, 250, 250, 0.96);
    font-size: 17px;
    min-height: 56px;
}
.work-sheet-table .col-value a {
    color: #7db4ff;
    text-decoration: underline;
    word-break: break-all;
}
</style>
"""

_PAGE_TITLE_SUFFIX_RE = re.compile(r"\s*[-–|｜]\s*Wikipedia.*$", re.I)
_LINK_FETCH_HEADERS = {"User-Agent": "WikiWorkApp/1.0 (Streamlit row editor)"}


def wikipedia_lang_from_host(netloc: str) -> str:
    host = netloc.lower()
    prefix = host.split(".", 1)[0]
    if prefix not in ("wikipedia", "m"):
        return prefix
    return "en"


def wikipedia_slug_from_url(parsed) -> str:
    path = parsed.path or ""
    if "/wiki/" not in path:
        return ""
    slug = path.split("/wiki/", 1)[1]
    slug = unquote(slug.split("#", 1)[0].split("?", 1)[0])
    return slug.replace("_", " ").strip()


@st.cache_data(ttl=86400, show_spinner=False)
def fetch_link_preview_title(url: str) -> str:
    """リンク先ページのタイトル（ホバープレビュー用）。URLごとに1日キャッシュ。"""
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        return ""

    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    if "wikipedia.org" in host:
        wiki_title = fetch_wikipedia_title(parsed)
        if wiki_title:
            return wiki_title

    return fetch_http_page_title(url)


def fetch_wikipedia_title(parsed) -> str:
    slug = wikipedia_slug_from_url(parsed)
    if not slug:
        return ""

    lang = wikipedia_lang_from_host(parsed.netloc or "")
    api_url = (
        f"https://{lang}.wikipedia.org/w/api.php"
        f"?action=query&format=json&redirects=1&titles={quote(slug, safe='')}"
    )
    try:
        request = Request(api_url, headers=_LINK_FETCH_HEADERS)
        with urlopen(request, timeout=4) as response:
            payload = json.loads(response.read().decode("utf-8"))
        for page in payload.get("query", {}).get("pages", {}).values():
            title = page.get("title")
            if title and str(page.get("pageid", "")) != "-1":
                return str(title)
    except Exception:
        pass
    return slug


def fetch_http_page_title(url: str) -> str:
    try:
        request = Request(url, headers=_LINK_FETCH_HEADERS)
        with urlopen(request, timeout=5) as response:
            html = response.read(65536).decode("utf-8", errors="replace")
        match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
        if not match:
            return ""
        title = unescape(match.group(1).strip())
        title = _PAGE_TITLE_SUFFIX_RE.sub("", title).strip()
        return title or unescape(match.group(1).strip())
    except Exception:
        return ""


def inline_col_width_px(
    col_name: str,
    raw_header: str,
    col_index: int,
    *,
    wiki_style: bool,
    inline: bool,
) -> int:
    """S〜Z はコンパクト幅。それ以外は AN列（A_name1）相当 128px を上限。"""
    if raw_header in LEADING_FIXED_HEADERS:
        return INLINE_LEADING_MIN_PX
    return INLINE_COL_MIN_PX


def build_edit_input_html(
    widget_key: str,
    value: str,
    *,
    is_status: bool,
    is_wiki_edit: bool,
    is_memo_edit: bool = False,
) -> str:
    if is_status:
        current = normalize_work_status(value)
        options = []
        for option in WORK_STATUS_OPTIONS:
            selected = " selected" if option == current else ""
            options.append(
                f'<option value="{escape(option)}"{selected}>{escape(option)}</option>'
            )
        return (
            f'<select class="work-inline-native-select" '
            f'data-inline-key="{escape(widget_key)}">{"".join(options)}</select>'
        )
    if is_wiki_edit or is_memo_edit:
        return (
            f'<textarea class="work-inline-native-input work-inline-native-textarea" '
            f'rows="4" data-inline-key="{escape(widget_key)}">'
            f"{escape(value)}</textarea>"
        )
    return (
        f'<input type="text" class="work-inline-native-input" '
        f'data-inline-key="{escape(widget_key)}" value="{escape(value)}">'
    )


def build_work_column_html(
    letter: str,
    raw_header: str,
    col_class: str,
    width_px: int,
    body_html: str,
) -> str:
    return (
        f'<div class="work-inline-col {col_class}" '
        f'style="flex:0 0 {width_px}px;width:{width_px}px;min-width:{width_px}px;">'
        f'<div class="work-inline-letter">{escape(letter)}</div>'
        f'<div class="work-inline-header">{escape(raw_header)}</div>'
        f"{body_html}"
        f"</div>"
    )


def build_work_row_component_html(
    row: pd.Series,
    visible_cols: list[str],
    raw_headers: list[str],
    unique_headers: list[str],
    sheet_row_number: int,
) -> str:
    header_by_unique = dict(zip(unique_headers, raw_headers))
    parts: list[str] = []

    for col_name in visible_cols:
        col_index = unique_headers.index(col_name) + 1
        letter = column_letter(col_index)
        raw_header = header_by_unique.get(col_name, col_name)
        value = row[col_name]
        val_str = "" if is_cell_empty(value) else str(value)
        wiki_style = is_wiki_style_header(raw_header)
        inline = is_inline_editable_column(col_name, raw_header, col_index)
        width_px = inline_col_width_px(
            col_name,
            raw_header,
            col_index,
            wiki_style=wiki_style,
            inline=inline,
        )

        if inline:
            widget_key = inline_widget_key(sheet_row_number, col_name)
            if is_work_status_column(raw_header, col_index):
                current = normalize_work_status(
                    st.session_state.get(widget_key, row[col_name])
                )
            else:
                current = str(st.session_state.get(widget_key, ""))
            body = build_edit_input_html(
                widget_key,
                current,
                is_status=is_work_status_column(raw_header, col_index),
                is_wiki_edit=is_correct_wiki_header(raw_header),
                is_memo_edit=is_memo_work_column(raw_header),
            )
            col_class = "work-inline-col-edit"
        else:
            body = render_readonly_cell_html(val_str)
            col_class = "work-inline-col-readonly"
            if raw_header in LEADING_FIXED_HEADERS:
                col_class = "work-inline-col-readonly work-inline-col-leading"
            elif wiki_style:
                col_class = "work-inline-col-wiki"

        parts.append(
            build_work_column_html(letter, raw_header, col_class, width_px, body)
        )

    return (
        f"<style>{WORK_ROW_COMPONENT_CSS}</style>"
        f'<div class="work-inline-outer"><div class="work-inline-track">'
        f'{"".join(parts)}'
        f"</div></div>"
    )


def apply_component_inline_values(result, *, flush_nonce: int = 0) -> None:
    if not isinstance(result, dict):
        return
    snapshot = st.session_state.get(COMPONENT_INLINE_SNAPSHOT_KEY, {})
    if not isinstance(snapshot, dict):
        snapshot = {}
    snapshot.update(result)
    st.session_state[COMPONENT_INLINE_SNAPSHOT_KEY] = snapshot
    for key, value in result.items():
        if isinstance(key, str) and key.startswith("inline_"):
            st.session_state[key] = "" if value is None else str(value)
    if flush_nonce:
        st.session_state[LAST_COMPONENT_FLUSH_KEY] = flush_nonce


def render_readonly_cell_html(value: str) -> str:
    if is_cell_empty(value):
        return '<div class="work-inline-readonly">—</div>'
    text = str(value).strip()
    if text.startswith("http://") or text.startswith("https://"):
        preview = fetch_link_preview_title(text)
        preview_attrs = ""
        if preview:
            preview_attrs = (
                f' title="{escape(preview)}" data-preview="{escape(preview)}"'
            )
        return (
            f'<div class="work-inline-readonly">'
            f'<a href="{escape(text)}"{preview_attrs} '
            f'target="_blank" rel="noopener noreferrer">'
            f"{escape(text)}</a></div>"
        )
    return f'<div class="work-inline-readonly">{escape(text)}</div>'


def render_work_table_inline(
    row: pd.Series,
    visible_cols: list[str],
    raw_headers: list[str],
    unique_headers: list[str],
    sheet_row_number: int,
) -> None:
    """作業表。HTML 横スクロール行（列数が多くても潰れない）。"""
    init_inline_widget_state(
        sheet_row_number, row, visible_cols, raw_headers, unique_headers
    )
    html_doc = build_work_row_component_html(
        row, visible_cols, raw_headers, unique_headers, sheet_row_number
    )
    flush_nonce = 0
    if st.session_state.get(PENDING_SAVE_ROW_KEY) == sheet_row_number:
        flush_nonce = int(st.session_state.get(FLUSH_NONCE_KEY, 0))
    result = WORK_ROW_COMPONENT(
        html=html_doc,
        height=WORK_ROW_IFRAME_HEIGHT,
        flush=flush_nonce,
        key=f"work-row-{sheet_row_number}",
    )
    apply_component_inline_values(result, flush_nonce=flush_nonce)


def maybe_process_pending_save(
    sheet_row_number: int,
    work_cols: list[str],
    raw_headers: list[str],
    unique_headers: list[str],
    worker: str,
) -> None:
    """「次へ（保存）」押下後、component から値を受け取った rerun でだけ保存する。"""
    if st.session_state.get(PENDING_SAVE_ROW_KEY) != sheet_row_number:
        return
    flush_nonce = int(st.session_state.get(FLUSH_NONCE_KEY, 0))
    if st.session_state.get(LAST_COMPONENT_FLUSH_KEY) != flush_nonce:
        return
    if save_current_row(
        sheet_row_number,
        work_cols,
        raw_headers,
        unique_headers,
        worker,
    ):
        st.session_state.pop(PENDING_SAVE_ROW_KEY, None)
        st.rerun()


def row_summary(row: pd.Series) -> str:
    sheet_row = int(row["_sheet_row_number"])
    renban = row.get("連番", "")
    entity = row.get("ENTITY_NAME", "")
    renban = "" if is_cell_empty(renban) else str(renban)
    entity = "" if is_cell_empty(entity) else str(entity)
    return f"行 {sheet_row} | {renban} | {entity}"


def get_row_by_sheet_number(
    df: pd.DataFrame, sheet_row_number: int
) -> tuple[pd.Series | None, int | None]:
    matches = df[df["_sheet_row_number"] == sheet_row_number]
    if matches.empty:
        return None, None
    index = matches.index[0]
    return df.loc[index], index


def init_row_history(queue_sheet_rows: list[int]) -> None:
    if "row_history" in st.session_state and "history_index" in st.session_state:
        return
    st.session_state.row_history = [queue_sheet_rows[0]]
    st.session_state.history_index = 0


def reset_row_history(queue_sheet_rows: list[int]) -> None:
    st.session_state.row_history = [queue_sheet_rows[0]]
    st.session_state.history_index = 0


def find_next_sheet_row(
    queue_sheet_rows: list[int], current_sheet_row: int
) -> int | None:
    if current_sheet_row in queue_sheet_rows:
        pos = queue_sheet_rows.index(current_sheet_row)
        if pos + 1 < len(queue_sheet_rows):
            return queue_sheet_rows[pos + 1]
    for sheet_row in queue_sheet_rows:
        if sheet_row > current_sheet_row:
            return sheet_row
    return None


def advance_row_history(queue_sheet_rows: list[int]) -> bool:
    current = st.session_state.row_history[st.session_state.history_index]
    next_sheet_row = find_next_sheet_row(queue_sheet_rows, current)
    if next_sheet_row is None:
        return False
    hi = st.session_state.history_index
    st.session_state.row_history = st.session_state.row_history[: hi + 1] + [next_sheet_row]
    st.session_state.history_index = hi + 1
    return True


def go_back_row_history() -> bool:
    if st.session_state.history_index <= 0:
        return False
    st.session_state.history_index -= 1
    return True


def jump_to_sheet_row(target_row: int, max_sheet_row: int) -> tuple[bool, str]:
    """指定シート行へ履歴に追加して移動（保存なし）。"""
    if target_row < 2 or target_row > max_sheet_row:
        return False, f"行番号は 2〜{max_sheet_row} の範囲で指定してください。"
    current = st.session_state.row_history[st.session_state.history_index]
    if target_row == current:
        return False, "すでにその行を表示しています。"
    hi = st.session_state.history_index
    st.session_state.row_history = st.session_state.row_history[: hi + 1] + [target_row]
    st.session_state.history_index = hi + 1
    return True, ""


def filter_queue_index(
    index_df: pd.DataFrame, worker: str, mode: str, skip_done: bool
) -> pd.DataFrame:
    queued = index_df.copy()

    if skip_done and COL_STATUS_WORK in queued.columns:
        queued = queued[queued[COL_STATUS_WORK].astype(str).str.strip() != STATUS_DONE]

    if COL_ASSIGNEE not in queued.columns:
        return queued

    assignee = queued[COL_ASSIGNEE].astype(str).str.strip()
    worker = worker.strip()

    if mode == "未担当":
        queued = queued[assignee.map(is_cell_empty)]
    elif mode == "自分担当":
        queued = queued[assignee == worker]
    elif mode == "未担当＋自分担当":
        queued = queued[assignee.map(is_cell_empty) | (assignee == worker)]

    return queued


def build_queue_sheet_rows(
    index_df: pd.DataFrame, worker: str, mode: str, skip_done: bool
) -> list[int]:
    filtered = filter_queue_index(index_df, worker, mode, skip_done)
    if filtered.empty:
        return []
    return [int(v) for v in filtered["_sheet_row_number"].tolist()]


def filter_queue(df: pd.DataFrame, worker: str, mode: str, skip_done: bool) -> pd.DataFrame:
    queued = df.copy()

    if skip_done and COL_STATUS_WORK in queued.columns:
        queued = queued[queued[COL_STATUS_WORK].astype(str).str.strip() != STATUS_DONE]

    if COL_ASSIGNEE not in queued.columns:
        return queued

    assignee = queued[COL_ASSIGNEE].astype(str).str.strip()
    worker = worker.strip()

    if mode == "未担当":
        queued = queued[assignee.map(is_cell_empty)]
    elif mode == "自分担当":
        queued = queued[assignee == worker]
    elif mode == "未担当＋自分担当":
        queued = queued[assignee.map(is_cell_empty) | (assignee == worker)]

    return queued


@st.cache_data(ttl=ASSIGN_NAMES_CACHE_TTL, show_spinner=False)
def load_assign_discord_names() -> list[str]:
    """アサインシートの Discord 名一覧（ヘッダー1行 + 対象列のみ読取、1時間キャッシュ）。"""
    client = get_client()
    spreadsheet = client.open_by_key(SPREADSHEET_ID)
    sheet = spreadsheet.worksheet(ASSIGN_SHEET_NAME)

    headers = sheet.row_values(1)
    if not headers or DISCORD_NAME_COLUMN not in headers:
        return []

    col_index = headers.index(DISCORD_NAME_COLUMN) + 1
    col_cells = sheet.col_values(col_index)
    names: list[str] = []
    for cell in col_cells[1:]:
        name = str(cell).strip()
        if name and name not in names:
            names.append(name)
    return names


def load_assign_discord_names_safe() -> list[str]:
    """429 時は session 内の前回結果にフォールバック。"""
    try:
        names = load_assign_discord_names()
        st.session_state[SESSION_DISCORD_NAMES_KEY] = names
        return names
    except APIError as e:
        if "429" not in str(e):
            raise
        fallback = st.session_state.get(SESSION_DISCORD_NAMES_KEY)
        if fallback is not None:
            st.sidebar.warning(
                "Discord 名一覧の読み取り制限中です。前回取得分を表示しています。"
                "1〜2分後に「再読み込み」を試してください。"
            )
            return list(fallback)
        st.error("読み取り制限中。少し待って再試行してください。")
        st.stop()


def render_worker_selector(discord_names: list[str]) -> str:
    if not discord_names:
        st.warning(f"`{ASSIGN_SHEET_NAME}` に Discord 名が見つかりません。手入力に切り替えます。")
        worker = st.text_input("作業者名", value=st.session_state.get("worker_name", ""))
        st.session_state["worker_name"] = worker.strip()
        return worker.strip()

    saved = st.session_state.get("worker_name", "")
    default_index = discord_names.index(saved) if saved in discord_names else 0

    worker = st.selectbox(
        "作業者名（Discord名）",
        discord_names,
        index=default_index,
    )
    st.session_state["worker_name"] = worker
    return worker


try:
    st.markdown(WORK_TABLE_CSS, unsafe_allow_html=True)
    discord_names = load_assign_discord_names_safe()

    with st.sidebar:
        st.link_button(
            "作業シートを開く",
            work_sheet_edit_url(),
            use_container_width=True,
        )
        st.subheader("作業設定")
        worker = render_worker_selector(discord_names)

        queue_filter = st.radio(
            "対象行",
            ["未担当＋自分担当", "未担当", "自分担当", "すべて"],
            index=0,
        )
        skip_done = st.checkbox("完了行をスキップ", value=True)
        light_blue_only = st.checkbox(
            "AC列以降は水色列のみ",
            value=True,
            help="灰色・濃い青の自動抽出列（Patient-Theme 等）は非表示",
        )
        show_empty_from_ac = st.checkbox("AC列以降の空列も表示", value=False)
        index_rows = st.number_input(
            "インデックス行数",
            min_value=100,
            max_value=10000,
            value=DEFAULT_INDEX_ROWS,
            step=100,
            help="Assignee/Status 判定用。全データ行数に合わせてください（約10000）。",
        )

        st.caption(write_mode_label())
        st.caption(
            f"書き込み先: `{WRITE_TARGET_SHEET_NAME}` / "
            f"ENABLE={ENABLE_SHEET_WRITES} / PROD={ALLOW_PRODUCTION_WRITES}"
        )
        st.caption(
            "保存: 「次へ（保存）」押下時のみ Sheets へ書き込み。"
            "入力中は再読み込みしません。"
        )
        if USE_SERVER_CACHE:
            stats = get_sheet_store().cache_stats()
            st.caption(
                "読取: サーバー内キャッシュ（SQLite）。"
                f"インデックス {stats['index_rows_cached']} 行 / "
                f"行データ {stats['data_rows_cached']} 行を保持。"
                " Sheets API は初回同期・保存・「再読み込み」時のみ。"
            )
        else:
            st.caption("読取: 都度 Sheets API")

        if st.button("先頭からやり直す"):
            for key in ("row_history", "history_index", "_nav_filter_key"):
                st.session_state.pop(key, None)
            st.rerun()

        if st.button("再読み込み"):
            clear_all_data_cache()
            for key in ("row_history", "history_index", "_nav_filter_key"):
                st.session_state.pop(key, None)
            st.rerun()

    try:
        spreadsheet_title, raw_headers, unique_headers, col_count = load_sheet_structure()
        index_df = ensure_queue_index(int(index_rows), raw_headers, unique_headers)
    except APIError as e:
        if "429" in str(e):
            st.error(
                "Google Sheets の読み取り上限（429）に達しました。"
                "1〜2分待ってからサイドバーの「再読み込み」を押してください。"
            )
        else:
            st.error(f"Sheets 読み込みエラー: {e}")
        st.stop()

    if index_df.empty:
        st.warning("インデックスデータがありません。")
        st.stop()

    queue_sheet_rows = build_queue_sheet_rows(index_df, worker, queue_filter, skip_done)

    if not queue_sheet_rows:
        st.info("条件に一致する行がありません。サイドバーのフィルタを変更してください。")
        st.stop()

    nav_filter_key = f"{queue_filter}|{skip_done}|{worker}|{index_rows}"
    if st.session_state.get("_nav_filter_key") != nav_filter_key:
        st.session_state._nav_filter_key = nav_filter_key
        reset_row_history(queue_sheet_rows)
    else:
        init_row_history(queue_sheet_rows)

    if st.session_state.pop("pending_advance", False):
        if advance_row_history(queue_sheet_rows):
            st.toast("保存して次の行へ", icon="✅")
        else:
            st.toast("保存しました（次の行なし）", icon="✅")

    history_index = st.session_state.history_index
    sheet_row_number = st.session_state.row_history[history_index]

    try:
        current_row = get_cached_row(
            sheet_row_number, raw_headers, unique_headers, col_count
        )
    except APIError as e:
        if "429" in str(e):
            st.error(
                "行データの読み取り上限（429）に達しました。"
                "1〜2分待ってから再試行してください。"
            )
        else:
            st.error(f"行 {sheet_row_number} の読み込みエラー: {e}")
        st.stop()

    work_cols = work_display_columns(
        current_row,
        raw_headers,
        unique_headers,
        show_empty_from_ac=show_empty_from_ac,
        light_blue_only=light_blue_only,
    )
    work_cols = ensure_work_display_cols(work_cols, raw_headers, unique_headers)

    st.caption(
        f"{spreadsheet_title} / {SHEET_NAME} / "
        f"履歴 {history_index + 1} / {len(st.session_state.row_history)} · "
        f"未処理キュー {len(queue_sheet_rows)} 行 · シート行 {sheet_row_number}"
    )
    st.progress((history_index + 1) / max(len(st.session_state.row_history), 1))

    st.markdown(f"**{row_summary(current_row)}**")

    if work_cols:
        render_work_table_inline(
            current_row,
            work_cols,
            raw_headers,
            unique_headers,
            sheet_row_number,
        )
        maybe_process_pending_save(
            sheet_row_number,
            work_cols,
            raw_headers,
            unique_headers,
            worker,
        )
    else:
        st.warning("作業欄の固定列が解決できません。ヘッダー行を確認してください。")

    render_navigation(
        queue_sheet_rows,
        sheet_row_number,
        work_cols,
        raw_headers,
        unique_headers,
        worker,
        int(index_rows) + 1,
    )

except gspread.exceptions.SpreadsheetNotFound:
    st.error(
        "スプレッドシートが見つかりません。"
        "サービスアカウントに共有されているか、SPREADSHEET_ID を確認してください。"
    )
except gspread.exceptions.WorksheetNotFound:
    st.error(f"シート `{SHEET_NAME}` が見つかりません。")
except FileNotFoundError as e:
    st.error(str(e))
except Exception as e:
    st.error(f"エラー: {type(e).__name__}: {e}")
    st.exception(e)
