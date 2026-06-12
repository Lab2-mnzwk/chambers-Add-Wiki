# Wiki付与 行作業 UI — 設計仕様

正本実装はリポジトリ直下の **Next.js アプリ**（`src/`）。

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

- キュー index は `.cache/<spreadsheetId>.json` の `queueIndex`（行ごとの status/assignee）に保持。`/api/queue` はこのキャッシュから `filterQueueRows` で対象行を算出（シート I/O なし）。`skipDone` は **キャッシュの status** を見て完了行を除外する。
- 保存で Status が変わると `patchQueueIndex` がキャッシュの status を更新する。
- 保存（`saveRow`）は **patch 反映後のキャッシュから最新キューを再計算**して返す（`SaveResult.queueSheetRows`、行番号昇順）。「次の行」は現在行より後ろの最初の行（`r > current`）＝最新の未完了行。
- クライアントは保存応答の `queueSheetRows` で `queueRows` を更新し、**「前の行」もこの最新リストを参照**（`skipDone` 時、リストに無い＝完了/対象外の行は戻り時もスキップ）。

##### キャッシュ鮮度（外部編集への追従）

- **行を開くたびに自己修復**: `getRow` は読み込んだ行のライブ status を `patchQueueIndex` でキャッシュへ反映する。アプリ外でシートを直接「完了」にした行も、一度開けば以降の判定・保存再計算・再読込で除外される。
- **「キュー再読込」は強制リフレッシュ**: ボタン押下時は `/api/queue?...&refresh=true` で `getQueue(options, true)` を呼び、キャッシュを無視して **シートから index（連番/status/assignee）を 1 回の batchGet で取り直す**。これでアプリ外の完了も含めて即座に反映される（行データ・構造・Wiki 履歴は保持＝軽量）。
- 通常の読込（作業者切替・`skipDone`/`indexRows` 変更など）はキャッシュ利用（`refresh` なし）でシート I/O を抑える。`skipDone` が「効かない」場合は、外部編集でキャッシュが古い可能性があるため「キュー再読込」を実行する。
- **アイドル明けの自動クリア**: キャッシュに最終アクセス時刻（`lastAccessAt`）を保持し、`/api/bootstrap`（アプリ起動）時に **最終アクセスから `IDLE_CACHE_CLEAR_MS`（既定 30 分。`IDLE_CACHE_CLEAR_MINUTES` で分単位上書き可）以上経過していれば全キャッシュをクリア**する。直後の構造・キュー・行・Wiki 履歴がシートから作り直され、空白期間中の外部編集も自動反映される。
  - `lastAccessAt` は bootstrap / `/api/queue` / `/api/row` の各アクセスで更新される（グローバル＝最後に誰かが使った時刻）。連続利用中（閾値未満の間隔）はクリアされず、キャッシュ効果を維持。
  - クリア判定は **起動（bootstrap）時のみ**。作業途中の行移動でクリアして作業を中断することはない。
  - 補足: サーバーレス（Vercel `/tmp`）ではコールドスタートでキャッシュが消えるため、長時間アイドル後は元々作り直されやすい。本機構は主に常駐サーバー/ローカルで効果がある。

### 表示オプション（チェックボックス）

表示は次の3モードのうち1つ（`fullEditMode` と `showNamedTriplets` は排他）。

設定パネルのレイアウト: **PC は作業者名を含め全項目を常時表示**。**スマホは作業者名のみ常時表示**で、それ以外（表示モード・テーマ・インデックス行数・キュー操作）は「表示設定等」トグルで折り畳む。

設定の保持: ブラウザの **localStorage**（キー `wikiWorkNext`）に保存（端末/ブラウザ単位。サーバー側の個人別保存はなし）。初回（localStorage 無し）の既定（`defaultOptions`）は **作業者名=「全件表示」/ 完了行スキップ ON / Entity値有り ON / Wiki値 - を除く OFF / 列表示・編集 OFF / indexRows 10000**。

チェックボックスは上から「完了行をスキップ」「Entity値有り」（サブ:「Wiki値 - を除く」）「列表示・編集（AN〜FT）」の順。

| UI 項目 | 既定 | 意味 |
|------------|------|------|
| Entity値有り | ON | 名称に値がある Wiki 三つ組を3列セット表示。OFF で全列表示（フィルタなし）。`fullEditMode` ON 時は無効 |
| └ Wiki値 - を除く（サブ） | ON | 「Entity値有り」の下位設定。ON で Wiki=`-`（wiki_dash）の三つ組を除外（= active のみ）。Entity値有り OFF / `fullEditMode` ON のとき無効 |
| 列表示・編集（AN〜FT）（`fullEditMode`） | OFF | ON のとき下記の全列編集モード。他の表示項目は無効化 |

UI は内部フラグへ次のように対応（`src/components/WorkApp.tsx`）:

| Entity値有り | Wiki値 - を除く | `showNamedTriplets` | `lightBlueOnly` | 表示 |
|---|---|---|---|---|
| OFF | （無効） | false | false | 全列表示（AC 以降の全列をフィルタなしで表示。空列・三つ組も全部、memo/status 補完なし） |
| ON | OFF | true | false | 名称有の三つ組セット（wiki_dash 含む） |
| ON | ON（既定） | false | true | 名称有・Wiki≠`-`（active）の三つ組セットのみ |

### 名称三つ組 表示モード（`showNamedTriplets`）

- 基準は **作業対象列（水色ヘッダー列）**。
- 各 Wiki 三つ組について、**名称（`A_name` 等）に値があれば、名称 / Wiki / 正しいwiki の3列を丸ごと表示**する。
  - 通常モードと違い、**Wiki が「-」(`wiki_dash`) の三つ組も非表示にしない**（`expandWikiTripletColumns` の削除処理をスキップ）。
  - **空セルの三つ組列も表示**する（`shouldIncludeWorkColumn` は名称が空でない＝`state !== "empty_name"` を満たす三つ組メンバーを表示）。
- 名称が空の三つ組は従来どおり非表示。memo は通常モード同様、表示中セクションに応じて追加。
- 編集可否は通常モードと同じ（正しいwiki は編集可、名称・Wiki は読取）。

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
- 保存契機・UI は通常モードと同じ（移動操作に連動した自動保存。「編集・保存」参照）。

### 列抽出ルール（`shouldIncludeWorkColumn`）

**Wiki 三つ組は常に3列（名称 / Wiki / 正しいwiki）セットで表示/非表示**（個別セルの空・値では分割しない）。状態は `wikiTripletDisplayState`: `empty_name` / `wiki_dash` / `active`。

| 三つ組の状態 | Entity値有り（`showNamedTriplets`） | Wiki確認対象列のみ（通常） |
|------|------|------|
| empty_name（名称が空） | 非表示 | 非表示 |
| wiki_dash（名称有・Wiki が `-`） | **3列セット表示** | 非表示 |
| active（名称有・Wiki≠`-`） | 3列セット表示 | 3列セット表示 |

- セットで表示する場合、空セルの列も含めて3列とも表示する。
- 非三つ組列: memo は非表示（後段 `filterMemoDisplayColumns` でセクションに応じ追加）。`lightBlueOnly` ON の非水色列は非表示。その他はセルに値があれば表示。

→ つまり **「Wiki確認対象列のみ」=「Entity値有り」から Wiki が `-` の三つ組を除いたもの**。

### Wiki 三つ組の並び（`expandWikiTripletColumns`）

- セット表示は `shouldIncludeWorkColumn` が3列とも採否を返すため、本関数は主に列順（先頭固定列を先に）を整える。
- `showNamedTriplets` OFF 時のみ wiki_dash 三つ組を colSet から削除する保険処理を残す（通常は state 判定で既に除外済み）。

## 編集・保存

- 編集: Status / memo / 正しいwiki のみ。`fullEditMode` ON 時は上記「列表示・編集モード」参照
- **自動保存（移動操作に連動）**: `前の行` / `開く` / `次の行` のいずれを押しても、**未保存の変更があれば移動前に自動保存**する。明示的な保存ボタンは無し（操作感はスプレッドシート的）。
  - **dirty 判定**: 読込時の値スナップショット（`originalEdits`）と現在の `edits` を比較。**差分が無ければ書き込まない**（API も呼ばない）ため、書き込み回数は「移動回数」ではなく「実際に編集した行数」に比例＝負荷を抑制。
  - **保存失敗時は移動を中止**しエラー表示・編集は保持（古いトークン等での取りこぼし防止）。
  - 保存後は最新キュー（`SaveResult.queueSheetRows`）でクライアントの基準を更新。`次の行`は現在行より後ろの最初のキュー行へ、末尾なら「キューの末尾です。」。
- **背景化・離脱時の保存**: タブ非表示化（`visibilitychange=hidden`）で未保存があれば `fetch(keepalive)` で保存（成功で clean 化）。離脱（`pagehide`）では `navigator.sendBeacon` で最後の保存（ベストエフォート）。hidden 時に保存済みなら beacon は dirty 無しでスキップ。
  - 限界: クラッシュ／強制終了／オフライン等では `pagehide` が届かないことがある。hidden 時保存を一次手段、beacon を保険とする二段構え。
- **リセット**: 行内編集を読込時の値へ戻すボタン（自動保存で確定する前の取り消し手段）。未保存が無い時は無効。
- 入力中は再読込しない。

#### 欄色

- 3列セット（名称 / Wiki / 正しいwiki）と memo は、実シートに合わせ **水色系**（`--work-col-wiki-bg`）で表示（読取・編集問わず）。Light/Dark とも視認しやすい配色。
- **Status（FG）/ Assignee（FH）** は実シートに合わせ **黄色系**（`--work-col-key-bg`、`.keyCol`）。
- 旧・編集列の黄色強調（全編集列を黄色）は撤去（編集可否は入力欄の有無で判別）。入力欄の枠は水色系に統一。

## 正しいWiki 補完機能（`WikiCorrectInput` + `/api/wiki-history`）

正しいwiki セルの入力時に、過去の確定値を候補表示する補完機能。

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

## 認証とトークン更新（OAuth モード）

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `AUTH_SECRET` が揃うと OAuth モード（`isOAuthConfigured`）。Google ログインユーザーのアクセストークンで Sheets API を呼ぶ。サービスアカウント JSON のみの場合はサービスアカウント認証。

- **トークンの保持**: NextAuth（JWT セッション）。`accessToken` / `refreshToken` / `expiresAt` をセッション Cookie 内に保持。
- **更新（refresh）**: Google のアクセストークンは約1時間で失効。`auth.ts` の `jwt` コールバックが期限切れ（`expiresAt - 60秒`）で `fetchRefreshedGoogleAccessToken` により再取得。
- **サーバー側のトークン取得**: `getGoogleAccessToken`（`src/lib/google-session.ts`）は Cookie をデコードして使用。**期限切れ・期限間近のときはこの場で refresh** してから返す。
  - 理由: ルートハンドラ内の `auth()` による refresh はトークンを Cookie へ書き戻さないことがあり、古いトークンのまま Sheets API に渡ると `Invalid Credentials` になる。取得経路でも再取得することで確実に最新化する（セーフティネット）。
- **資格情報エラー時の扱い**: `Invalid Credentials` / `invalid_grant` 等は `isCredentialError`（`src/lib/api-error.ts`）で検出し、`401` + 「再ログインしてください」に変換。`getBootstrap` は資格情報エラー（および `session.error`）時に **行き止まりのエラーではなくログイン画面（`LoginPanel`）** を表示する。
- **再ログインが必要なケース**: refresh トークンが無い/失効した場合（古い認可・連携解除など）。一度ログアウト→ログインすると、`access_type=offline` + `prompt=consent` により refresh トークンが再保存され、以降は自動更新される。

## 実装参照

| 内容 | パス |
|------|------|
| 列ルール | `src/lib/columns.ts` |
| Sheets API | `src/lib/sheets.ts`, `src/lib/work-service.ts` |
| 認証・トークン更新 | `src/auth.ts`, `src/lib/google-session.ts`, `src/lib/api-error.ts` |
| UI | `src/components/WorkApp.tsx`, `WorkRowTable.tsx` |
