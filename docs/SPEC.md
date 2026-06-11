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
6. **Assignee** — 値があれば読取表示（保存時の FH 書込は廃止。担当はシート側で事前付与）

### キュー（表示対象行）

- キューは **作業者名（Discord名）で固定**。選択した作業者の Assignee と一致する行のみが対象（旧「表示対象行」セレクタは廃止）。
- 「完了行をスキップ」ON で完了行を除外。**前後の移動とも同一基準**で判定（下記「キューキャッシュと完了スキップ」）。
- **行指定で開く**: 作業者名を選択している場合、Assignee が他の作業者の行は開けない（未担当・自分担当のみ可）。`RowPayload.assignee` で判定。

#### キューキャッシュと完了スキップ（次/前の統一）

- キュー index は `.cache/<spreadsheetId>.json` の `queueIndex`（行ごとの status/assignee）に保持。`/api/queue` はこのキャッシュから `filterQueueRows` で対象行を算出（シート I/O なし）。
- 保存で Status が変わると `patchQueueIndex` がキャッシュの status を更新する。
- 保存（`saveRow`）は **patch 反映後のキャッシュから最新キューを再計算**して返す（`SaveResult.queueSheetRows`、行番号昇順）。「次の行」は現在行より後ろの最初の行（`r > current`）＝最新の未完了行。
- クライアントは保存応答の `queueSheetRows` で `queueRows` を更新し、**「前の行」もこの最新リストを参照**（`skipDone` 時、リストに無い＝完了/対象外の行は戻り時もスキップ）。
- これにより取り込み後の status 変更が反映され、進む/戻るで完了行を踏まない判定を **スプレッドシート追加アクセスなし** で実現。外部での直接編集など、保存を伴わない変更は「キュー再読込」で取り込む。

### 表示オプション（チェックボックス）

| オプション | 既定 | 意味 |
|------------|------|------|
| Wiki確認対象列のみ | ON | AC 以降は水色ヘッダー列（Wiki確認対象列）のみ対象。OFF なら AC 以降の全列が対象。いずれも空セルの列は非表示 |
| 全列表示・編集（AN〜FT） | OFF | ON のとき下記の全列編集モード。上の項目は無効化 |

### 列表示・編集モード（`fullEditMode`）

- 表示: 先頭固定列 + **AN〜FT** の全列（値・水色・Wiki ルールを無視して必ず表示）。memo フィルタ・Wiki 三つ組の追加/除外も適用しない。
  - ただし `FULL_EDIT_HIDDEN_RANGES` の列は範囲内でも非表示（BC〜BK / BM〜BV / CS〜DB / DO〜DQ / DS〜EB / ET〜FC / FE〜FF / FI / FK / FM / FO / FQ / FS）。
- 編集: **AN〜FD** と **FJ〜FT** を自由入力テキストで編集可（`isFullEditableColIndex`）。
  - 間の **FE〜FI**（Status=FG・Assignee=FH を含む）は自由入力対象外。Status はドロップダウン、Assignee は読取のまま。
  - 書込禁止列（`WRITE_DENYLIST_COL_LETTERS`、現状 AE）は範囲外につき影響なし。
- 範囲定数: `FULL_EDIT_DISPLAY_RANGE` / `FULL_EDIT_COLUMN_RANGES` / `FULL_EDIT_HIDDEN_RANGES`（`src/lib/config.ts`）。

#### 保存時の書き込み（`fullEditMode` ON）

- 表示中かつ編集可（AN〜FD・FJ〜FT、非表示列を除く）のセルに入力した値が、**自由入力テキスト**としてシートへ書き込まれる（`buildWritePlan` に `fullEditMode=true` を渡し、`isWritableColumn` が当該範囲を許可）。
- Status（FG）は従来通りドロップダウン値を書き込み。Assignee（FH）・FE〜FI のその他・非表示列・AE は書き込まない。
- 保存契機・UI は通常モードと同じ（「次の行→（保存）」のみ）。

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

- 編集: Status / memo / 正しいwiki のみ（黄枠）。`fullEditMode` ON 時は上記「列表示・編集モード」参照
- 保存: 「次へ（保存）」のみ。入力中は再読込しない

## 正しいWiki 補完機能（`WikiCorrectInput` + `/api/wiki-history`）

正しいwiki セル（黄枠）の入力時に、過去の確定値を候補表示する補完機能。

- **候補の生成元**: 作業シートを走査し、`名称 + Wiki + 正しいwiki` がすべて揃い、正しいwiki が URL の三つ組を集計（`aggregateWikiHistory`）。同一 `名称/Wiki/正しいwiki` は件数を加算。インデックス行数は `indexRows`。
- **候補の絞り込み**（`suggestWikiHistory`）: 編集中セルの行の `名称`（必要に応じ `Wiki`）をキーに照合。
  - `exact`（name+wiki 一致）を優先、続いて `name のみ一致`。各々 件数降順、最大 8 件。
  - 入力中テキストでさらに部分一致フィルタ（250ms デバウンス）。
- **表示**: 各候補は `タイトル|URL`（タイトルは `/api/link-preview` で取得）と一致種別・件数を表示。クリックでセルへ反映。
- **学習（保存時マージ）**: 保存で正しいwiki 列が更新されると、その `名称/Wiki/正しいwiki` をメモリ上の履歴インデックスへ追記（`mergeWikiHistoryFromSave`）。次回以降の候補に反映される。

## 作業者名リスト（`loadAssignDiscordNames`）

- 「アサイン」シートの `discord名` 列（2 行目以降）から重複を除いて取得。
- 集計ラベルは除外（`ASSIGN_NAME_EXCLUDE`、現状「合計」「端数チェック（総件数との差）」）。
- 作業者名の選択は **キューの担当フィルタ**であり、通常は選択値と Assignee が一致する行のみが対象。
- 特別値 **「全件表示」**（`ASSIGN_ALL_ROWS_NAME`。シート上のラベル「全体」=`ASSIGN_ALL_ROWS_SHEET_LABEL` を変換）を選ぶと **Assignee で絞らず全行**をキューにする（`skipDone` は引き続き適用）。この場合、行指定で開く際の担当ガードも無効。

## 実装参照

| 内容 | パス |
|------|------|
| 列ルール | `src/lib/columns.ts` |
| Sheets API | `src/lib/sheets.ts`, `src/lib/work-service.ts` |
| UI | `src/components/WorkApp.tsx`, `WorkRowTable.tsx` |
| 旧 Streamlit | `archive/streamlit/app.py` |
| 旧 GAS | `archive/gas/` |
