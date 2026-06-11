# Wiki付与 行作業 UI — 設計仕様

正本実装はリポジトリ直下の **Next.js アプリ**（`src/`）。  
旧 Streamlit / GAS は `archive/` に退避。

- スプレッドシート ID: `1Mc3pX949vlO_uxWpimn7_DsUAYr87GmroqXft6fvB4I`
- 作業シート: `wiki付与作業シート（第一弾）`
- Status: FG列（`Status` / `Status.1`）
- Assignee: FH列（`Assignee`）

## 作業表 — 表示列

1. **S〜Z** — 常に表示（空は `—`）
2. **AC以降** — `shouldIncludeWorkColumn`（`src/lib/columns.ts`）で抽出
3. **Wiki 三つ組** — 後段の `expandWikiTripletColumns` で正しいwiki 列を追加 / `-` 時は除外
4. **memo** — 対応セクション（A_name 等）がある行のみ
5. **Status** — 常に表示
6. **Assignee** — 値があれば読取表示。保存時に作業者名を FH へ書込

### キュー（表示対象行）

- キューは **作業者名（Discord名）で固定**。選択した作業者の Assignee と一致する行のみが対象（旧「表示対象行」セレクタは廃止）。
- 「完了行をスキップ」ON で完了行を除外。前の行移動でも当該セッションで完了保存した行はスキップ。
- **行指定で開く**: 作業者名を選択している場合、Assignee が他の作業者の行は開けない（未担当・自分担当のみ可）。`RowPayload.assignee` で判定。

### 表示オプション（チェックボックス）

| オプション | 既定 | 意味 |
|------------|------|------|
| Wiki確認対象列のみ | ON | AC 以降は水色ヘッダー列（Wiki確認対象列）のみ対象。OFF なら AC 以降の全列が対象。いずれも空セルの列は非表示 |
| 全列表示・編集（AN〜FT） | OFF | ON のとき下記の全列編集モード。上の項目は無効化 |

### 全列表示・編集モード（`fullEditMode`）

- 表示: 先頭固定列 + **AN〜FT** の全列（値・水色・Wiki ルールを無視して必ず表示）。memo フィルタ・Wiki 三つ組の追加/除外も適用しない。
- 編集: **AN〜FD** と **FJ〜FT** を自由入力テキストで編集可（`isFullEditableColIndex`）。
  - 間の **FE〜FI**（Status=FG・Assignee=FH を含む）は自由入力対象外。Status はドロップダウン、Assignee は読取のまま。
  - 書込禁止列（`WRITE_DENYLIST_COL_LETTERS`、現状 AE）は範囲外につき影響なし。
- 範囲定数: `FULL_EDIT_DISPLAY_RANGE` / `FULL_EDIT_COLUMN_RANGES`（`src/lib/config.ts`）。

### 列抽出ルール（`shouldIncludeWorkColumn`）

| 条件 | 結果 |
|------|------|
| Wiki確認対象列のみ ON かつ非対象列 | 非表示 |
| memo 列 | 非表示（後段 `filterMemoDisplayColumns` でセクションに応じ追加） |
| Wiki 三つ組・名称が空（empty_name） | 非表示 |
| Wiki 三つ組・Wiki が `-`（wiki_dash） | 非表示 |
| Wiki 三つ組・active・セルに値 | 表示 |
| Wiki 三つ組・active・セルが空 | 非表示 |
| その他・セルが空 | 非表示 |
| その他・セルに値 | 表示 |

Wiki 三つ組の状態は `wikiTripletDisplayState`: `empty_name` / `wiki_dash` / `active`。

### Wiki 三つ組の追加表示（`expandWikiTripletColumns`）

- 名称に値 **かつ** Wiki に有効値（空・`-` 以外）→ **正しいwiki** 列を追加
- Wiki が `-` の三つ組は colSet から削除（二重の安全策）

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
