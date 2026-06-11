# Wiki付与 行作業 UI — 設計仕様

正本実装はリポジトリ直下の **Next.js アプリ**（`src/`）。  
旧 Streamlit / GAS は `archive/` に退避。

- スプレッドシート ID: `1Mc3pX949vlO_uxWpimn7_DsUAYr87GmroqXft6fvB4I`
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

## 実装参照

| 内容 | パス |
|------|------|
| 列ルール | `src/lib/columns.ts` |
| Sheets API | `src/lib/sheets.ts`, `src/lib/work-service.ts` |
| UI | `src/components/WorkApp.tsx`, `WorkRowTable.tsx` |
| 旧 Streamlit | `archive/streamlit/app.py` |
| 旧 GAS | `archive/gas/` |
