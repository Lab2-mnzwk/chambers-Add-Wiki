"""memo / Status の編集・保存ロジックをオフラインで検証する。"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

st_mock = MagicMock()
st_mock.session_state = {}
st_mock.cache_resource = lambda f: f
st_mock.cache_data = lambda *args, **kwargs: (lambda f: f)
sys.modules["streamlit"] = st_mock
sys.modules["streamlit.components.v1"] = MagicMock()

import app  # noqa: E402


def fg_col_index() -> int:
    letters = app.WORK_STATUS_COL_LETTER
    if len(letters) == 1:
        return ord(letters) - ord("A") + 1
    return (ord(letters[0]) - ord("A") + 1) * 26 + (ord(letters[1]) - ord("A") + 1)


def test_inline_editable_status_by_column_letter() -> None:
    fg_index = fg_col_index()
    assert app.is_work_status_column("Status", fg_index)
    assert app.is_inline_editable_column("Status", "Status", fg_index)


def test_build_write_plan_includes_status_at_fg() -> None:
    fg_index = fg_col_index()
    raw_headers = [""] * (fg_index - 1) + ["Status"]
    unique_headers = raw_headers.copy()
    status_unique = app.resolve_work_status_unique(raw_headers, unique_headers)
    assert status_unique == "Status"
    plan = app.build_write_plan(
        99,
        raw_headers,
        unique_headers,
        {status_unique: app.STATUS_DONE},
    )
    assert len(plan) == 1
    assert plan.iloc[0]["書き込み値"] == app.STATUS_DONE
    assert plan.iloc[0]["列記号"] == app.WORK_STATUS_COL_LETTER


def test_filter_memo_hidden_when_no_work_sections() -> None:
    raw_headers = [
        "head_page",
        "Agent_memo",
        "Place_memo",
        "Patient-Theme_memo",
        "Territory_memo",
    ]
    unique_headers = raw_headers.copy()
    filtered = app.filter_memo_display_columns(["head_page"], raw_headers, unique_headers)
    assert filtered == ["head_page"]


def test_filter_memo_shows_place_when_place_work_exists() -> None:
    raw_headers = ["Pl_name1", "Pl_Wiki1", "Agent_memo", "Place_memo"]
    unique_headers = raw_headers.copy()
    filtered = app.filter_memo_display_columns(
        ["Pl_name1", "Pl_Wiki1"], raw_headers, unique_headers
    )
    assert "Agent_memo" not in filtered
    assert "Place_memo" in filtered


def test_inline_editable_memo_columns() -> None:
    cases = [
        ("Agent_memo", True),
        ("Place_memo", True),
        ("A_正しいwiki1", True),
        ("head_page", False),
        ("A_name1", False),
    ]
    for raw_header, expected in cases:
        actual = app.is_inline_editable_column(raw_header, raw_header, 1)
        assert actual is expected, f"{raw_header}: expected {expected}, got {actual}"


def test_build_write_plan_includes_memo() -> None:
    raw_headers = ["Agent_memo", "Place_memo"]
    unique_headers = raw_headers.copy()
    plan = app.build_write_plan(
        42,
        raw_headers,
        unique_headers,
        {"Agent_memo": "エージェントメモ更新", "Place_memo": "場所メモ"},
    )
    assert len(plan) == 2


def test_collect_inline_updates_reads_memo_from_session() -> None:
    sheet_row = 10
    raw_headers = ["Agent_memo", "A_正しいwiki1"]
    unique_headers = raw_headers.copy()
    app.st.session_state.clear()
    app.st.session_state[app.inline_widget_key(sheet_row, "Agent_memo")] = "memo from ui"
    updates = app.collect_inline_updates(
        sheet_row, raw_headers, raw_headers, unique_headers
    )
    assert updates["Agent_memo"] == "memo from ui"


def test_collect_inline_updates_reads_status_from_snapshot() -> None:
    fg_index = fg_col_index()
    raw_headers = [""] * (fg_index - 1) + ["Status"]
    unique_headers = raw_headers.copy()
    sheet_row = 10
    key = app.inline_widget_key(sheet_row, "Status")
    app.st.session_state.clear()
    app.st.session_state[app.COMPONENT_INLINE_SNAPSHOT_KEY] = {
        key: app.STATUS_DONE,
    }
    updates = app.collect_inline_updates(sheet_row, [], raw_headers, unique_headers)
    assert updates["Status"] == app.STATUS_DONE


def main() -> None:
    tests = [
        test_inline_editable_status_by_column_letter,
        test_build_write_plan_includes_status_at_fg,
        test_filter_memo_hidden_when_no_work_sections,
        test_filter_memo_shows_place_when_place_work_exists,
        test_inline_editable_memo_columns,
        test_build_write_plan_includes_memo,
        test_collect_inline_updates_reads_memo_from_session,
        test_collect_inline_updates_reads_status_from_snapshot,
    ]
    for test in tests:
        test()
        print(f"OK: {test.__name__}")
    print("All save logic checks passed.")


if __name__ == "__main__":
    main()
