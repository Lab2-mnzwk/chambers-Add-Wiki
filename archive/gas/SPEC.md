# Wiki付与 行作業 UI — 設計仕様・修正指示

正本実装は **Next.js 版**（リポジトリ直下 `src/`）。GAS / Streamlit は同じ列ルール・見た目・操作に揃える。

- スプレッドシート ID: `1jGba1Vnzjlvf6dNj6hqVRYoPEkcJVkeU1dND-vnThrY`
- 作業シート: `wiki付与作業シート（第一弾）`
- Status: FG列（`Status` / `Status.1`）
- Assignee: FH列（`Assignee`）

## 作業表 — 表示列

1. **S〜Z** — 常に表示（空は `—`）
2. **AC以降** — 水色列 + 値あり（空列非表示、memo は後段）
3. **Wiki 三つ組** — 名称+Wiki 有効値 → 正しいwiki も表示 / Wiki `-` → 3列非表示
4. **memo** — 対応セクション（A_name 等）がある行のみ
5. **Status** — 常に表示
6. **Assignee** — 値があれば読取表示。保存時に作業者名を FH へ書込

## 編集・保存

- 編集: Status / memo / 正しいwiki のみ（黄枠）
- 保存: 「次へ（保存）」のみ。入力中は再読込しない

## 見た目

- S〜Z: 86px / 他: 128px
- Wiki 列 `#2f4563` / 編集列 `#4a4028` 黄枠 / 通常 `#3d4450`
- 横スクロール1行ビュー

## レイアウト（Web アプリ）

- 設定: 左カラム（272px）または折りたたみ
- 作業表: メイン領域・全幅
- 行サマリー: `行 N | 連番 | ENTITY_NAME`

## 実装参照

- **Next.js（正本）**: `src/lib/columns.ts`, `src/components/`
- Python（旧）: `work_display_columns`, `ensure_work_display_cols`, `filter_memo_display_columns`
- GAS: `WorkColumns.gs`, `WorkApp.html`

## 受け入れテスト

同一行で Next.js / GAS を比較:

1. Agent 作業あり → 三つ組 + Agent_memo + Status
2. 作業該当なし → memo 非表示
3. Wiki `-` → 三つ組非表示
4. 次へ保存 → Sheets 反映
