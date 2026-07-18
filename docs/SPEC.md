# Wiki付与 行作業 UI — 設計仕様

正本実装はリポジトリ直下の **Next.js アプリ**（`src/`）。

- スプレッドシート ID: `1Mc3pX949vlO_uxWpimn7_DsUAYr87GmroqXft6fvB4I`
- **作業シート（複数・通しキュー）**: 同一スプレッドシート内の複数タブを 1 本のキューとして扱う（`WORK_SHEETS`、`src/lib/config.ts`）。順序は **第一二弾 → 第三弾**。
  - `第一二弾`（id=`s12`, `wiki付与作業シート（第一弾、第二弾）`, 担当列 `Assignee`）
  - `第三弾`（id=`s3`, `wiki付与作業シート（第三弾）`, 担当列 `wiki付与Assignee`）
  - シート名は `SHEET_NAME` / `SHEET_NAME_3` で上書き可。両シートとも編集可。
- **列レイアウトは構造検出**: 三つ組の命名・個数・Status/Assignee 列名はシートごとに異なる（例: `A_name1/A_deweyID1/A_Wiki1` vs `A_1/A_dID_1/A_wiki1`、Agent 8 個 vs 6 個）。そのため列ルールはハードコードせず、各シートのヘッダーから **構造検出**する（`buildSheetRules`、`src/lib/sheet-rules.ts`）。生成物は 1 シート分の `SheetRules`（三つ組・水色列・deweyID 対応・Status/Assignee・memo・全列編集範囲）。
  - **三つ組検出**: `正しいwiki` を含む列を起点に、直前 3 列 `[名称, deweyID, Wiki]` を 1 組とする（両シートとも並び順は共通）。deweyID 列は命名ゆれ（`deweyID` / `dID`）を正規表現で識別。
  - **セクション対応付け**: ヘッダーを左→右に走査し、`Agent` / `Patient-Theme` / `Place` / `Territory` の見出し列で現在セクションを切替え、以降の列（三つ組・memo）に対応付ける。
- Status: 作業 Status（**担当列の直前の `Status`**）。選択肢は `未着手` / `完了` / `完了（正規化変更）` / `要確認`（`WORK_STATUS_OPTIONS`、シートのドロップダウンと同順）。
  - シート前方に別の `Status`（エンティティ Status、値は `Done - 変更有り/なし` 等）が存在するが、**作業 Status とは別物**。解決は「**担当列の直前の `Status`**」（`buildSheetRules` の `statusUnique`）。エンティティ Status（AE）は無視・**書込禁止**（`WRITE_DENYLIST`）。
- Assignee: 作業 Assignee（シートごとの担当列。第一二弾＝`Assignee` / 第三弾＝`wiki付与Assignee`。`書籍補完Assignee` は使わない）。
- **deweyID 列**: 各三つ組は `名称 / deweyID / Wiki / 正しいwiki` の並び。deweyID 列自体は**表示しない**が、「deweyID有りを除く」判定に使う（`SheetRules.deweyByName`）。`-`・空は「値無し」扱い。
- **完了系ステータス**: `完了` と `完了（正規化変更）` は完了扱い（`DONE_STATUSES` / `isDoneStatus`）。進捗フィルタ「完了を除く」は両方を除外する。
- **行の識別**: 行は **シート ID ＋ シート行番号**の複合（`QueueEntry = { sheet, row }`）。通しキュー内でシートを跨いでも一意に識別できる。

## 作業表 — 表示列

1. **S〜Z** — 常に表示（空は `—`）
2. **AC以降** — `shouldIncludeWorkColumn`（`src/lib/columns.ts`）で抽出
3. **Wiki 三つ組** — 後段の `expandWikiTripletColumns` で正しいwiki 列を追加 / `-` 時は除外
4. **memo** — 対応セクション（A_name 等）がある行のみ
5. **Status** — 常に表示
6. **Assignee** — 値があれば読取表示（保存時の FH 書込は廃止。担当はシート側で事前付与）

### キュー（表示対象行）

- キューは **作業者名（Discord名）で固定**。選択した作業者の Assignee と一致する行のみが対象（旧「表示対象行」セレクタは廃止）。
- **進捗フィルタ（`statusFilter`）**: 作業 Status によるキュー絞り込み。ラジオ3択で排他（`filterQueueRows`）。**前後の移動・保存後のキュー再計算・ライブ status 判定（`shouldSkipLiveStatus` / probe API）も同一基準**。
  - `all`（すべて）: 絞り込みなし。
  - `incomplete`（完了を除く・既定）: 完了系行（`完了` / `完了（正規化変更）`、`isDoneStatus`）を除外（＝未着手＋要確認）。
  - `notStarted`（未着手のみ）: 正規化後ステータスが「未着手」（空欄含む）の行だけ（要確認・完了系も除外）。
- **行指定で開く**: 作業者名を選択している場合、Assignee が他の作業者の行は開けない（未担当・自分担当のみ可）。`RowPayload.assignee` で判定。**「開く」はシート選択＋行番号**で行う（シート選択の既定は現在行のシート）。行番号だけでは 2 シートに同番号が存在し得るため。
- **現在位置の表示**: 進捗表示は `キュー N / M ・ <シート名> 行 R`（`RowPayload.sheetLabel`）。今どちらのシートの何行目かが常に分かる。

#### キューキャッシュと進捗フィルタ（次/前の統一）

- **キャッシュはシート・用途単位**: `.cache/<spreadsheetId>__<sheetId>__<domain>.json`（Vercel は `/tmp/sheet-cache`）に分離して保持。`nav-delta` / `wiki-delta` を追加し、保存のたびに巨大な nav/wiki 本体を書き直さず変更分だけ記録する。
- `/api/queue?compact=true` は全シートの index を絞り、`[sheetId, rows[]][]`（`CompactQueue`）で返す。シートIDの反復をなくし、クライアントで `QueueEntry[]` に展開する。`compact` 未指定時は旧画面向けの従来形式を返す。
- 保存で Status が変わると `patchQueueIndex` が該当シートのキャッシュ status を更新する。
- 保存（`saveRow`）へ送るのは **読込時から実際に変化したセル＋Wiki学習用の小さな三つ組スナップショットだけ**。最大3万件の通しキューは送らず、応答も `savedCells` と更新時の `status` だけにする。
- Status が進捗フィルタから外れた場合、クライアントは現在行だけを `queueRows` からローカル除外する。**移動は通しキュー上の「位置（index）」基準**で行い、キュー全体の再取得はしない。
- 保存で現在行が完了になり新キューから消えた場合は、**保存前キューでの現在位置から次／前に残っている最寄り行**を新キュー内で探して移動を継続する。`index=-1` を先頭扱いにしてキュー先頭から探索し直さない。
- **移動時の探索は途中行を描画しない**: `次の行` / `前の行` は、キュー上の次候補をメモリで特定し、進捗フィルタ有効時は status を確認して対象外なら描画せず次へ。**着地する行が決まって初めて描画**するため、スキップ中の途中行はちらつかない（探索中は「次/前の対象行を探索中…」表示）。該当行が無ければ現在の表示行はそのまま維持（復元不要）。
  - **A. 候補行を 1 回の Sheets `batchGet` で取得（`POST /api/navigate`）**: travel 方向の候補窓（最大 `NAV_WINDOW`=4 件）の**行全体**を1回で取得し、その同じ応答内の Status でスキップ判定して着地 payload を組み立てる（`navigateToTarget` / `fetchCandidateRowValues`）。Status の `batchGet` → 着地行の `values.get` という直列2回を行わず、通常移動の Google API 読み取りを **1回**にする。
    - 窓内に着地が無ければ `landing=null` を返し、クライアントは全件スキップ扱いで次窓を要求。スキップ累計が `NAV_REFRESH_SKIP_THRESHOLD`（=5）に達したら **スキップが発生したシートだけ** index を再構築（`/api/queue?refresh=true&sheet=...`）して最新キューでジャンプする（大量スキップ時の負荷軽減）。
    - 進捗「すべて」のときは先頭候補の行だけを取得して即着地する。
  - **変更ありの保存＋移動を並列化（`POST /api/save-move`）**: `次の行` / `前の行` は現行の `batchUpdate` と最初の候補窓の `batchGet`、`開く` は `batchUpdate` と指定行取得を `Promise.allSettled` で並列実行する。同じ行を指定して開く場合だけ、保存後の値を確実に表示するため直列実行する。変更なしの移動は従来の `/api/navigate` / `/api/row` を使う。
    - 保存失敗時は先読み済みの移動結果を採用せず、現在行と編集内容を維持する。保存成功・移動失敗時は編集を保存済みにして現在行を維持し、次の操作で二重保存しない。
    - 保存で現在行がキューから外れた後に移動だけ失敗しても、`removedNavigationAnchorRef` が保存前の位置を保持し、再操作時にキュー先頭へ戻らず同じ方向の続きから探索する。
  - **次方向だけ条件限定の裏読み**: 行着地直後に、**現在の作業者・進捗フィルタ・列表示条件だけ**で次候補窓（最大4行）を `/api/navigate` で裏読みする。条件が一致する「次の行」ではその結果を使い、変更ありなら保存だけ待って着地する（読み取り待ちを避ける）。前方向・他条件・キュー再読込時は破棄する。
- **移動時のキュー再取得は行わない**: 進捗「すべて」でも `次の行` / `前の行` のたびに `/api/queue` は呼ばない。キュー全体の更新はフィルタ切替・手動「対象行リストを更新」・大量スキップ refresh に限定する（保存時は現在行だけローカル更新）。
- **応答順ガード（重要）**: `queueRows` を書き換える非同期処理（`loadQueue` / 保存後のローカル更新）は世代カウンタ `queueWriteSeqRef` で管理し、**後発の書込のみ採用**。これにより、進捗フィルタ切替・作業者/インデックス変更・対象行リスト更新の古い応答が後着で上書きする不具合を防ぐ。
- **サーバー既定**: `/api/queue` の `statusFilter` はパラメータ不正/欠落時 **`incomplete`（完了を除く）**。クライアントは常に明示送信。

##### キャッシュ鮮度（外部編集への追従）

- **保存時に status を自己修復**: `saveRow` は Status 変更を nav キャッシュ（`patchQueueIndex`）と rows キャッシュ（`patchRowValues`）へ反映するため、アプリ内の完了は即スキップ対象になる。移動探索は候補行を Sheets から取得して **ライブ Status** で判定するため、アプリ外で完了にした行も着地前にスキップする。キュー件数の表示ずれは「対象行リストを更新」で解消。
- **SheetRules のメモリキャッシュ**: `buildSheetRules` の結果はシートごとにメモリ保持し、ヘッダー不変の間は再利用する（`work-service.ts` の `rulesCache`）。
- **「対象行リストを更新」は強制リフレッシュ**: ボタン押下時は `/api/queue?...&refresh=true` で `getQueue(options, true)` を呼び、キャッシュを無視して **シートから index（連番/status/assignee）を 1 回の batchGet で取り直す**。これでアプリ外の完了も含めて即座に反映される（行データ・構造・Wiki 履歴は保持＝軽量）。
- 通常の読込（作業者切替・進捗フィルタ/`indexRows` 変更など）はキャッシュ利用（`refresh` なし）でシート I/O を抑える。フィルタが「効かない」場合は、外部編集でキャッシュが古い可能性があるため「対象行リストを更新」を実行する。
- **アイドル明けの自動クリア**: キャッシュに最終アクセス時刻（`lastAccessAt`）を保持し、`/api/bootstrap`（アプリ起動）時に **最終アクセスから `IDLE_CACHE_CLEAR_MS`（既定 30 分。`IDLE_CACHE_CLEAR_MINUTES` で分単位上書き可）以上経過していれば全キャッシュをクリア**する。直後の構造・キュー・行・Wiki 履歴がシートから作り直され、空白期間中の外部編集も自動反映される。
  - `lastAccessAt` は bootstrap / `/api/queue` / `/api/row` の各アクセスで更新される（グローバル＝最後に誰かが使った時刻）。連続利用中（閾値未満の間隔）はクリアされず、キャッシュ効果を維持。
  - クリア判定は **起動（bootstrap）時のみ**。作業途中の行移動でクリアして作業を中断することはない。
  - 補足: Redis REST環境変数が無い場合、Vercel `/tmp` はインスタンス単位。設定済みの場合は共有キャッシュから復元する。

##### 性能設計（キャッシュの用途別分割）

- 目的: 行移動のホットパス（`navigateToTarget` / `getRow`）で **巨大な `queueIndex`（最大 30,000 行）や `wikiHistory` を毎回シリアライズして書き戻さない**こと。以前は 1 シート 1 ファイルの全部入りで、行を開くたびに全体を read/write していた（書き込み増幅）。
- 用途別ファイルへ分割（`store.ts`）: **struct / nav / nav-delta / rows / wiki / wiki-delta / meta**。Status保存とWiki学習は小さな差分だけを書き、全体JSONの書き込み増幅を避ける。
  - `navigateToTarget`（`POST /api/navigate`）: 候補4行以下の全データを `fetchCandidateRowValues` の **1回の batchGet** で取り、Status 判定と着地 payload 構築を同じ応答で完結。着地行だけ rows キャッシュへ保存する。
  - `getRow`: 取得した行を **rows ファイルにその行だけ**書く（nav/wiki は触らない）。
  - `getQueue`: nav を読んで絞り込み（refresh 時のみ nav を再構築）。
  - `saveRow`: 行全体を事前取得せず、変更セルを `batchUpdate` で直接保存。rows（該当行）+ wiki（正しいWiki/Status更新時のみ学習）+ nav（Status変更時のみ）を更新する。
- **任意の共有キャッシュ（`shared-cache.ts`）**:
  - `KV_REST_API_URL/TOKEN` または `UPSTASH_REDIS_REST_URL/TOKEN` があれば自動有効化。未設定・障害時はローカルキャッシュとSheetsへフォールバックする。
  - TTLは構造24時間、nav 3分、Wiki履歴15分、個別行60秒。移動時はライブ行取得でStatusを判定するため、共有navの短い時間差で完了行へ誤着地しない。
  - 同一インスタンスはPromise single-flight、複数インスタンスはRedis `SET NX PX`ロックでnav/Wikiの大規模再構築重複を抑止する。
  - 保存時のStatus・Wiki学習のRedis Hash差分更新と共有rowキー削除は、Next.js `after()` で**レスポンス送信後**に実行する。ローカルキャッシュは保存処理内で先に更新するため、利用者本人の次操作には即時反映される。フル再構築時は差分Hashを削除する。
- **Sheets REST直接通信（`sheets.ts`）**: `googleapis`依存を廃止し、標準`fetch`でSheets v4 REST APIを呼ぶ。OAuthは既存ユーザートークン、サービスアカウントはRS256 JWTでアクセストークンを取得・再利用する。429/503のみ最大1回再試行する。`/api/save-move` は `AsyncLocalStorage` にアクセストークンを保持し、並列の保存・行取得で認証処理を1回だけ行う。
- **キャッシュの手動操作**（設定パネルの「キュー操作」）:
  - **対象行リストを更新**: nav（`queueIndex`）をシートから再取得（`/api/queue?refresh=true`）。
  - **表示中の行を再取得**: rows キャッシュのみ破棄（`/api/cache?target=rows`）。次に開くと再取得。動作が重い/古いとき用。
  - **候補再構築**: wiki キャッシュのみ破棄（`/api/cache?target=wiki`）。次の候補表示で再学習。候補の更新タイミング（下記）は `/guide`（使い方ガイド）で説明する。
  - **全キャッシュ再構築**（全用途をクリアし構造を再取得。`/api/cache?target=all`＝`refreshCache`）は**日常操作では使わないため設定パネルには置かず**、`/guide`（使い方ガイド）下部の「全キャッシュ再構築（メンテナンス）」に専用ボタン（`CacheRebuildButton`、クライアントコンポーネント）として設置する。
- `DELETE /api/cache?target=all|nav|rows|wiki` で用途別クリア/再構築（`clearCacheByTarget`）。`GET /api/cache` は件数統計。

### 表示オプション（チェックボックス）

表示は次の3モードのうち1つ（`fullEditMode` と `showNamedTriplets` は排他）。

設定パネルのレイアウト: **PC は作業者名を含め全項目を常時表示**。**スマホは作業者名のみ常時表示**で、それ以外（表示モード・テーマ・キュー操作）は「表示設定等」トグルで折り畳む。

設定の保持: ブラウザの **localStorage**（キー `wikiWorkNext`）に保存（端末/ブラウザ単位。サーバー側の個人別保存はなし）。初回（localStorage 無し）の既定（`defaultOptions`）は **作業者名=「全件表示」/ 表示する行=「完了を除く」/ 表示する列=「要確認（DeweyIDなし）」（=Entity値あり かつ DeweyID 未付与）**。旧バージョンの `skipDone` / `onlyNotStarted`（2 boolean）が保存されている場合は `loadStoredOptions` が `statusFilter` へ移行する（`onlyNotStarted`→`notStarted` / `skipDone=false`→`all` / それ以外→`incomplete`）。なお `indexRows`（シート全行をカバーするための取得上限）は **UI から編集せず、`.env.local` の `DEFAULT_INDEX_ROWS`（未設定なら 30000）をサーバー既定として正とする**。bootstrap 時に localStorage の値はサーバー既定へ合わせて上書きされる（古い小さい値での取り込み漏れ防止／値変更の即時反映）。

行の復元: **最後に開いていた行**を別キー **`wikiWorkLastRow`**（`シートID#行番号` 形式）に保存し、次回起動（リロード）時に復元する。初回のキュー構築時に一度だけ適用し、**その行（シート＋行番号）が現在のキューに含まれる場合のみ**復元（含まれない＝進捗フィルタ等で対象外なら従来どおり先頭行から開始）。作業者変更などその後の再読込では効かない。

設定 UI は上から「表示する行（進捗）」（ドロップダウン3択: すべて / 完了を除く / 未着手のみ）「表示する列」（ドロップダウン4択: Entity値あり / 要確認（DeweyIDなし）/ 編集（三つ組＋memo＋役割列）/ すべて）の順。行・列ともに**択一のドロップダウン**で、見出しを対称にしつつ縦の長さを抑える（スマホ配慮）。

**表示する行を変更した直後の挙動**: フィルタ切替時もキューは再読込されるが、**今の行の表示はそのまま維持**される（`loadQueue` の位置維持分岐。現在行が新キューに含まれなければキュー番号は更新されない）。次の行/前の行へ移動すると、移動先のライブ status で probe 判定が効き、絞り込みが反映される。ヘルプ（？）にも同旨を明記。

| UI 項目 | 既定 | 意味 |
|------------|------|------|
| 表示する行（進捗）（`statusFilter`） | 完了を除く | 3択。**すべて**=絞り込みなし / **完了を除く**=完了系（`完了` / `完了（正規化変更）`）を除外 / **未着手のみ**=「未着手」（空欄含む）の行だけ（要確認・完了系も除外） |
| 表示する列 | 要確認（DeweyIDなし） | 4択。**Entity値あり**=名称有の三つ組セット（DeweyID 有無を問わず）/ **要確認（DeweyIDなし）**=名称有 かつ DeweyID 未付与（空/`-`）の三つ組のみ / **編集（三つ組＋memo＋役割列）**=下記の全列編集モード / **すべて**=AC 以降の全列（フィルタなし） |

UI の選択値（`ColumnMode`）は内部フラグへ次のように対応（`src/components/WorkApp.tsx` の `COLUMN_MODE_FLAGS`）。リスト表示順は Entity値あり → 要確認 → 編集 → すべて:

| 表示する列 | `fullEditMode` | `showNamedTriplets` | `lightBlueOnly` | 表示 |
|---|---|---|---|---|
| Entity値あり | false | true | false | 名称有の三つ組セット（Wiki=`-`・deweyID 有無を問わず全部） |
| 要確認（DeweyIDなし・既定） | false | false | true | 名称有 **かつ DeweyID 無（空/`-`）** の三つ組セットのみ（DeweyID 有り＝確認不要を除外） |
| 編集（三つ組＋memo＋役割列） | true | false | false | 下記「列表示・編集モード」 |
| すべて | false | false | false | 全列表示（AC 以降の全列をフィルタなしで表示。空列・三つ組も全部、memo/status 補完なし） |

### 名称三つ組 表示モード（`showNamedTriplets`）

- 基準は **作業対象列（水色ヘッダー列）**。
- 各 Wiki 三つ組について、**名称（`A_name` 等）に値があれば、名称 / Wiki / 正しいwiki の3列を丸ごと表示**する。
  - 通常モードと違い、**Wiki が「-」(`wiki_dash`) の三つ組も非表示にしない**（`expandWikiTripletColumns` の削除処理をスキップ）。
  - **空セルの三つ組列も表示**する（`shouldIncludeWorkColumn` は名称が空でない＝`state !== "empty_name"` を満たす三つ組メンバーを表示）。
- 名称が空の三つ組は従来どおり非表示。memo は通常モード同様、表示中セクションに応じて追加。
- 編集可否は通常モードと同じ（正しいwiki は編集可、名称・Wiki は読取）。

### 列表示・編集モード（`fullEditMode`）

**構造ベースで再定義**（レター固定を廃止）。シートごとに `buildSheetRules` が表示・編集範囲を算出するため、第一二弾・第三弾の列数/命名差を自動吸収する。Wiki 三つ組は **4列セット（名称 / deweyID / Wiki / 正しいwiki）** として表示・編集する。

- 表示範囲（`SheetRules.fullDisplayIdx`）: `ENTITY_NAME` から **役割列（Action〜Probability）／担当列**の後端までのうち、**ヘルパー列を除いた**全列。ヘルパー列＝ヘッダーが `_lang` 終わり / `__auto` を含む / `〜数` / `wiki結合` / `wiki統合` / `_Category` を含む / 先頭 `_`（言語・メタ列）。
  - 結果: 4グループ（Agent / Patient-Theme / Place / Territory）の全三つ組4列セット・各 memo・セクション見出し列・Status・Assignee・役割列が表示される。
- 編集可（`SheetRules.fullEditableIdx`）: **三つ組4列（名称/deweyID/Wiki/正しいwiki）・memo・役割列・作業 Status**。
  - **Status はドロップダウン**。セクション見出し列（`Agent` 等）・`ENTITY_NAME`・**担当列は文脈用に表示のみ**（編集不可）。
  - 書込禁止列（`WRITE_DENYLIST_COL_LETTERS`、現状 AE）は書き込まない。ヘルパー列は表示されないため編集・書込対象にならない。

#### 保存時の書き込み（`fullEditMode` ON）

- 表示中かつ編集可のセルに入力した値が、**自由入力テキスト**としてシートへ書き込まれる（`buildWritePlan` に `fullEditMode=true` を渡し、`isWritableColumn` が `fullEditableIdx` を許可）。
- Status は従来通りドロップダウン値を書き込み。担当列・ヘルパー列・AE は書き込まない。
- 保存契機・UI は通常モードと同じ（移動操作に連動した自動保存。「編集・保存」参照）。

### 列抽出ルール（`shouldIncludeWorkColumn`）

**Wiki 三つ組は常に3列（名称 / Wiki / 正しいwiki）セットで表示/非表示**（個別セルの空・値では分割しない）。表示/非表示は「名称の有無」と、通常モードでは「deweyID の有無」で決まる。

| 三つ組の状態 | Entity値有り（`showNamedTriplets`） | deweyID有りを除く（通常） |
|------|------|------|
| 名称が空 または `-` | 非表示 | 非表示 |
| 名称有・deweyID 有（空/`-` 以外） | **3列セット表示** | **非表示**（判断不要） |
| 名称有・deweyID 無（空/`-`） | 3列セット表示 | 3列セット表示 |

- セットで表示する場合、空セルの列も含めて3列（名称/Wiki/正しいwiki）とも表示する（deweyID 列は表示しない）。
- deweyID 有無の判定は `tripletDeweyHasValue`（`SheetRules.deweyByName` で名称列→deweyID 列を対応付け。値が空または `-` は「無し」扱い）。
- 非三つ組列: memo は非表示（後段 `filterMemoDisplayColumns` でセクションに応じ追加）。`lightBlueOnly` ON の非水色列は非表示。その他はセルに値があれば表示。

→ つまり **「deweyID有りを除く」=「Entity値有り」から deweyID に値がある三つ組（同定済み＝判断不要）を除いたもの**。

### Wiki 三つ組の並び（`expandWikiTripletColumns`）

- セット表示は `shouldIncludeWorkColumn` が3列とも採否を返すため、本関数は主に列順（先頭固定列を先に）を整える。
- `showNamedTriplets` OFF 時のみ wiki_dash 三つ組を colSet から削除する保険処理を残す（通常は state 判定で既に除外済み）。

## 編集・保存

- 編集: Status / memo / 正しいwiki のみ（**DeweyID 有りの正しいwiki 列は入力欄なし・「DeweyIDありのため入力不要」表示（小さめ文字）、Wiki 列と同色**）。`fullEditMode` ON 時は上記「列表示・編集モード」参照
- **自動保存（移動操作に連動）**: `前の行` / `開く` / `次の行` のいずれを押しても、**未保存の変更があれば移動前に自動保存**する。明示的な保存ボタンは無し（操作感はスプレッドシート的）。
  - **dirty 判定**: 読込時の値スナップショット（`originalEdits`）と現在の `edits` を比較。**差分が無ければ書き込まない**（API も呼ばない）ため、書き込み回数は「移動回数」ではなく「実際に編集した行数」に比例＝負荷を抑制。
  - **保存失敗時は移動を中止**しエラー表示・編集は保持（古いトークン等での取りこぼし防止）。
  - 変更ありの場合は `/api/save-move` で保存と移動先取得を並列化する。保存成功・移動失敗は「保存済み／現在行維持」、保存失敗・移動取得成功は「未保存／現在行維持」として結果を分離する。
  - 保存APIには変更セルだけを送り、キュー全体は送受信しない。更新後Statusが現在の進捗フィルタから外れた場合だけ現在行をローカル除外し、保存前の位置から次の行へ進む。
- **設定変更時も自動保存**: 進捗フィルタ/作業者の変更（キューの再読込）や、表示モード切替（`applyDisplayOptions`）でも、**現在行を再読込する前に未保存編集を自動保存**する。これがないと再読込で `edits` が保存値に戻り、未保存の Status 変更等が失われる（保存失敗時は再読込せず編集を保持・選択は巻き戻さない）。
- **背景化・離脱時の保存**: タブ非表示化（`visibilitychange=hidden`）で未保存があれば `fetch(keepalive)` で保存（成功で clean 化）。離脱（`pagehide`）では `navigator.sendBeacon` で最後の保存（ベストエフォート）。hidden 時に保存済みなら beacon は dirty 無しでスキップ。
  - 限界: クラッシュ／強制終了／オフライン等では `pagehide` が届かないことがある。hidden 時保存を一次手段、beacon を保険とする二段構え。
- **リセット**: 行内編集を読込時の値へ戻すボタン（自動保存で確定する前の取り消し手段）。未保存が無い時は無効。
- 入力中は再読込しない。

#### 欄色

- 3列セット（名称 / Wiki / 正しいwiki）と memo は、実シートに合わせ **水色系**（`--work-col-wiki-bg`）で表示（読取・編集問わず）。Light/Dark とも視認しやすい配色。
- **Status（FG）/ Assignee（FH）** は実シートに合わせ **黄色系**（`--work-col-key-bg`、`.keyCol`）。
- 旧・編集列の黄色強調（全編集列を黄色）は撤去（編集可否は入力欄の有無で判別）。入力欄の枠は水色系に統一。

#### 名称セルの検索リンク（`WorkRowTable.tsx` / `search-links.ts`）

名称（`isWikiName`、値が `—` 以外）セルに 2 つの Google 検索リンクを出す。

- **名称テキスト自体がリンク**: 名称の文字列を Google 検索（`googleSearchUrl`）リンク化し、末尾に小さく `↗` を付ける。クリック範囲＝名称全体。**名称の文字色は通常テキスト色**（`--work-readonly`、Light=黒/Dark=白）、`↗` のみリンク色（`--work-link`）にして省スペースかつリンクと分かるようにする。
- **文脈検索↗**: 名称の下に常時改行表示（`display:block`）。`contextSearchUrl(eventName, name)` で次のクエリを Google 検索する。
  - `出来事「{eventName}」における「{名称}」に該当するWiki記事は？`
  - `eventName` は **出来事名（AC列＝`ENTITY_NAME`）**。`RowPayload.eventName` で受け渡す。空のときは `「{名称}」に該当するWiki記事は？` にフォールバック。

#### 横スクロール位置のリセット

作業表の横スクロール領域（`.outer`）は、**表示行が切り替わると先頭（左端）へ自動リセット**する。`WorkRowTable` に `rowKey`（＝`シートID#行番号`）を渡し、変化時に `scrollLeft = 0`。シートを跨いで同じ行番号へ移っても確実に発火する。

## 正しいWiki 補完機能（`WikiCorrectInput` + `/api/wiki-history`）

正しいwiki セルの入力時に、過去の確定値を候補表示する補完機能。

- **候補の生成元**: 各作業シートを走査し、`名称 + Wiki` がある三つ組について正しいwiki の値を集計（`aggregateWikiHistory`）。候補対象は **URL** / **`-`（該当なし）** / **空欄（=Wiki欄変更不要のため入力なし、ただし作業 Status 完了行かつ deweyID 未付与のみ）** の3種。同一 `名称/Wiki/正しいwiki` は件数を加算。インデックス行数は `indexRows`。詳細は `docs/WIKI_HISTORY.md`。
- **シート横断の合算**: 候補は **全シートの履歴を合算**して提示する（`combineWikiHistories` で同一 `名称/Wiki/正しいwiki` の件数を足し合わせ、`suggestWikiHistory` に渡す）。第一二弾で確定した正解は第三弾でも候補に出る（逆も同様）。
- **候補の絞り込み**（`suggestWikiHistory`）: 編集中セルの行の `名称`（必要に応じ `Wiki`）をキーに照合。
  - `exact`（name+wiki 一致）を優先、続いて `name のみ一致`。各々 件数降順、最大 8 件。
  - 入力中テキストでさらに部分一致フィルタ（250ms デバウンス）。
- **表示と取得タイミング**: 行表示だけでは候補APIを呼ばず、入力欄のフォーカスまたは「候補を表示」操作時に初めて取得する。1行内の複数入力欄から `/api/wiki-history` が同時発火し、Vercel の複数インスタンスで履歴再構築が重複するのを防ぐ。取得後は `タイトル|URL`（タイトルは `/api/link-preview` で取得）または `Wiki該当なし（`-` を入力）` / `Wiki欄変更不要のため入力なし`（空欄正解）と、一致種別・件数を表示。候補が無いときは `候補なし`。クリックでセルへ反映（空欄正解はセルを空に）。
- **学習（保存時マージ）**: 保存で正しいwiki 列が更新されると、その `名称/Wiki/正しいwiki`（URL/`-`）をメモリ上の履歴インデックスへ追記（`mergeWikiHistoryFromSave`）。さらに **Status を完了に変更した保存**では、deweyID 未付与かつ空欄のままの三つ組を「Wiki欄変更不要のため入力なし」として学習（`mergeBlankCorrectEntry`）。次回以降の候補に反映される。
- **更新タイミング（決まった周期の自動更新は無い）**:
  - **自分の保存**: 上記の学習により**即時**候補へ反映される。
  - **他の人の保存**: 同一サーバープロセスの `wiki` キャッシュに保存時マージされるため、**同じインスタンスに当たれば**すぐ反映される。反映されない・古いと感じたら手動の**候補再構築**ボタン（`/api/cache?target=wiki`）でシートから再学習できる。
  - **自動ウォームアップなし**: 起動直後や行表示時の候補ウォームは、通常作業と重なってAPI負荷・タイムアウトを増やすため行わない。最初に候補欄を操作した時だけ構築する。
  - **Vercel（サーバーレス）特有の注意**: `.cache` は `/tmp` に置かれ **実行インスタンス単位**（プロセス間で共有されない）。同時アクセスが複数インスタンスに分散すると、片方は候補構築済み・もう片方は未構築ということが起こり得る。「同じサーバーで全員共有」ではなく「当たったインスタンス次第」と理解する。この時間差については `/guide`（使い方ガイド）の「正しいWiki の候補機能」で説明する（作業パネル側には常設の説明は置かない）。

## 作業者名リスト（`loadAssignDiscordNames`）

- 「アサイン」シートの `discord名` 列（2 行目以降）から重複を除いて取得。
- 集計ラベルは除外（`ASSIGN_NAME_EXCLUDE`、現状「合計」「端数チェック（総件数との差）」）。
- **シート上の実在担当名の追加**（`extraAssignees`）: シートによって同一人物の Assignee 表記が異なる場合（例: 第一二弾＝「けにち」/ 第三弾＝「mnmzwkenichi」）に対応するため、各作業シートの Assignee 列に実在する担当名のうち **アサインシートに無いもの**を収集し、ドロップダウン末尾の optgroup「その他（シート上の担当名）」に追加する（`collectExtraAssignees`、bootstrap 時にキュー index から算出＝シート無加工）。実在名を選べば当該シートの担当行が対象になる（別表記の人はシートごとに選び替える運用）。作業者の既定補完・有効判定は `discordNames + extraAssignees` を対象にする。
- 作業者名の選択は **キューの担当フィルタ**であり、通常は選択値と Assignee が一致する行のみが対象。
- 特別値 **「全件表示」**（`ASSIGN_ALL_ROWS_NAME`。シート上のラベル「全体」=`ASSIGN_ALL_ROWS_SHEET_LABEL` を変換）を選ぶと **Assignee で絞らず全行**をキューにする（進捗フィルタは引き続き適用）。この場合、行指定で開く際の担当ガードも無効。

## 認証とトークン更新（OAuth モード）

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `AUTH_SECRET` が揃うと OAuth モード（`isOAuthConfigured`）。Google ログインユーザーのアクセストークンで Sheets API を呼ぶ。サービスアカウント JSON のみの場合はサービスアカウント認証。

- **トークンの保持**: NextAuth（JWT セッション）。`accessToken` / `refreshToken` / `expiresAt` をセッション Cookie 内に保持。
- **更新（refresh）**: Google のアクセストークンは約1時間で失効。`auth.ts` の `jwt` コールバックが期限切れ（`expiresAt - 60秒`）で `fetchRefreshedGoogleAccessToken` により再取得。
- **サーバー側のトークン取得**: `getGoogleAccessToken`（`src/lib/google-session.ts`）は Cookie をデコードして使用。**期限切れ・期限間近のときはこの場で refresh** してから返す。
  - 理由: ルートハンドラ内の `auth()` による refresh はトークンを Cookie へ書き戻さないことがあり、古いトークンのまま Sheets API に渡ると `Invalid Credentials` になる。取得経路でも再取得することで確実に最新化する（セーフティネット）。
- **資格情報エラー時の扱い**: `Invalid Credentials` / `invalid_grant` 等は `isCredentialError`（`src/lib/api-error.ts`）で検出し、`401` + 「再ログインしてください」に変換。`getBootstrap` は資格情報エラー（および `session.error`）時に **行き止まりのエラーではなくログイン画面（`LoginPanel`）** を表示する。
- **権限不足エラー時の扱い**: `Insufficient Permission` / `The caller does not have permission` / `forbidden` 等は `isPermissionError` で検出し、`403` + 専用文言（`PERMISSION_MESSAGE`：「権限に問題が生じています。一度ログアウトし、再ログインをお試しください。解決しない場合はご連絡ください。」）に変換。`getBootstrap` はこれを **authRequired（`authMessage` 付き）** として扱い、`LoginPanel` ＋ 専用メッセージを表示する。原因はスコープ不足・共有設定・トークン等いずれもあり得るため文言では断定せず、再ログインへ誘導する。
- **ログアウト導線の常時表示**: ヘッダーのログアウトボタンは **サインイン中（`session.user.email` あり）なら `bootstrap` 取得が失敗（権限不足・500 等）しても必ず表示**する。これにより「エラーでログアウトできず再ログインも試せない」宙ぶらりんを防ぐ。`authRequired` 画面にもログアウトボタンを置き、別アカウントへ切り替えられるようにする。
- **再ログインが必要なケース**: refresh トークンが無い/失効した場合（古い認可・連携解除など）。一度ログアウト→ログインすると、`access_type=offline` + `prompt=consent` により refresh トークンが再保存され、以降は自動更新される。

## 実装参照

| 内容 | パス |
|------|------|
| シート定義（複数シート） | `src/lib/config.ts`（`WORK_SHEETS`） |
| 列ルールの構造検出 | `src/lib/sheet-rules.ts`（`buildSheetRules`） |
| 列ルール | `src/lib/columns.ts` |
| Sheets API | `src/lib/sheets.ts`, `src/lib/work-service.ts` |
| 移動探索の集約（A） | `src/app/api/navigate/route.ts`, `navigateToTarget`（`work-service.ts`） |
| 保存と移動の並列化 | `src/app/api/save-move/route.ts`, `WorkApp.tsx` |
| 認証・トークン更新 | `src/auth.ts`, `src/lib/google-session.ts`, `src/lib/api-error.ts` |
| UI | `src/components/WorkApp.tsx`, `WorkRowTable.tsx` |
| 検索リンク | `src/lib/search-links.ts` |
