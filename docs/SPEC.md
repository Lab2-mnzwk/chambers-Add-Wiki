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
- **進捗フィルタ（`statusFilter`）**: 作業 Status によるキュー絞り込み。ラジオ3択で排他（`filterQueueRows`）。**前後の移動・保存後のキュー再計算・ライブ status 判定（`shouldSkipLiveRow`）も同一基準**。
  - `all`（すべて）: 絞り込みなし。
  - `incomplete`（完了を除く・既定）: 完了系行（`完了` / `完了（正規化変更）`、`isDoneStatus`）を除外（＝未着手＋要確認）。
  - `notStarted`（未着手のみ）: 正規化後ステータスが「未着手」（空欄含む）の行だけ（要確認・完了系も除外）。
- **行指定で開く**: 作業者名を選択している場合、Assignee が他の作業者の行は開けない（未担当・自分担当のみ可）。`RowPayload.assignee` で判定。**「開く」はシート選択＋行番号**で行う（シート選択の既定は現在行のシート）。行番号だけでは 2 シートに同番号が存在し得るため。
- **現在位置の表示**: 進捗表示は `キュー N / M ・ <シート名> 行 R`（`RowPayload.sheetLabel`）。今どちらのシートの何行目かが常に分かる。

#### キューキャッシュと進捗フィルタ（次/前の統一）

- **キャッシュはシート単位**: `.cache/<spreadsheetId>__<sheetId>.json`（例 `..._s12.json` / `..._s3.json`）に、シートごとの `structure` / `queueIndex`（行ごとの status/assignee）/ 行データ / Wiki 履歴を保持。
- `/api/queue` は **全シートのキャッシュ index を `filterQueueRows` で絞り、第一二弾→第三弾の順に連結**して通しキュー（`QueueEntry[]`）を返す（シート I/O なし）。進捗フィルタは **キャッシュの status** を見て対象外行を除外する。
- 保存で Status が変わると `patchQueueIndex` が該当シートのキャッシュ status を更新する。
- 保存（`saveRow`）は **patch 反映後の各シートのキャッシュから通しキューを再計算**して返す（`SaveResult.queue`）。index 未構築のシートはクライアントが送った `queue` の該当分をそのまま残す。
- クライアントは保存応答の `queue` で `queueRows` を更新し、**移動は通しキュー上の「位置（index）」基準**で行う。「次の行」＝現在位置の次、「前の行」＝前。進捗フィルタ有効時、リストに無い＝対象外の行は移動時もスキップ。
- **移動時の探索は途中行を描画しない**: `次の行` / `前の行` は、キュー上の次候補をメモリで特定し、`fetchRowPayload`（表示状態を変えない取得）でライブ status のみ確認する。`shouldSkipLiveRow` で対象外なら描画せず次へ。**着地する行が決まって初めて `setRowPayload`** するため、スキップ中の途中行はちらつかない（探索中は「次/前の対象行を探索中…」表示）。該当行が無ければ現在の表示行はそのまま維持（復元不要）。
- **大量スキップ時の負荷軽減**: 1回の移動でライブ status スキップが `NAV_REFRESH_SKIP_THRESHOLD`（=5）以上に達したら、行を1件ずつ確認し続けず **キュー index を一度だけ再構築（`/api/queue?refresh=true`）** して最新キューで一気にジャンプする。通常時（スキップ少）は発動しないため負荷は増えない。
- **応答順ガード（重要）**: `queueRows` を書き換える非同期処理（`loadQueue` / 保存応答）は世代カウンタ `queueWriteSeqRef` で管理し、**後発の書込のみ採用**。これにより、進捗フィルタ切替・作業者/インデックス変更・キュー再読込で `/api/queue` が短時間に複数飛んだ際に、**古い応答が後着で `queueRows` を上書きし、フィルタ設定と食い違う**不具合を防ぐ。
- **サーバー既定**: `/api/queue` の `statusFilter` はパラメータ不正/欠落時 **`incomplete`（完了を除く）**。クライアントは常に明示送信。

##### キャッシュ鮮度（外部編集への追従）

- **行を開くたびに自己修復**: `getRow` は読み込んだ行のライブ status を `patchQueueIndex` でキャッシュへ反映する。アプリ外でシートを直接「完了」にした行も、一度開けば以降の判定・保存再計算・再読込で除外される。
- **「キュー再読込」は強制リフレッシュ**: ボタン押下時は `/api/queue?...&refresh=true` で `getQueue(options, true)` を呼び、キャッシュを無視して **シートから index（連番/status/assignee）を 1 回の batchGet で取り直す**。これでアプリ外の完了も含めて即座に反映される（行データ・構造・Wiki 履歴は保持＝軽量）。
- 通常の読込（作業者切替・進捗フィルタ/`indexRows` 変更など）はキャッシュ利用（`refresh` なし）でシート I/O を抑える。フィルタが「効かない」場合は、外部編集でキャッシュが古い可能性があるため「キュー再読込」を実行する。
- **アイドル明けの自動クリア**: キャッシュに最終アクセス時刻（`lastAccessAt`）を保持し、`/api/bootstrap`（アプリ起動）時に **最終アクセスから `IDLE_CACHE_CLEAR_MS`（既定 30 分。`IDLE_CACHE_CLEAR_MINUTES` で分単位上書き可）以上経過していれば全キャッシュをクリア**する。直後の構造・キュー・行・Wiki 履歴がシートから作り直され、空白期間中の外部編集も自動反映される。
  - `lastAccessAt` は bootstrap / `/api/queue` / `/api/row` の各アクセスで更新される（グローバル＝最後に誰かが使った時刻）。連続利用中（閾値未満の間隔）はクリアされず、キャッシュ効果を維持。
  - クリア判定は **起動（bootstrap）時のみ**。作業途中の行移動でクリアして作業を中断することはない。
  - 補足: サーバーレス（Vercel `/tmp`）ではコールドスタートでキャッシュが消えるため、長時間アイドル後は元々作り直されやすい。本機構は主に常駐サーバー/ローカルで効果がある。

### 表示オプション（チェックボックス）

表示は次の3モードのうち1つ（`fullEditMode` と `showNamedTriplets` は排他）。

設定パネルのレイアウト: **PC は作業者名を含め全項目を常時表示**。**スマホは作業者名のみ常時表示**で、それ以外（表示モード・テーマ・キュー操作）は「表示設定等」トグルで折り畳む。

設定の保持: ブラウザの **localStorage**（キー `wikiWorkNext`）に保存（端末/ブラウザ単位。サーバー側の個人別保存はなし）。初回（localStorage 無し）の既定（`defaultOptions`）は **作業者名=「全件表示」/ 表示する行=「完了を除く」/ 表示する列=「要確認（DeweyIDなし）」（=Entity値あり かつ DeweyID 未付与）**。旧バージョンの `skipDone` / `onlyNotStarted`（2 boolean）が保存されている場合は `loadStoredOptions` が `statusFilter` へ移行する（`onlyNotStarted`→`notStarted` / `skipDone=false`→`all` / それ以外→`incomplete`）。なお `indexRows`（シート全行をカバーするための取得上限）は **UI から編集せず、`.env.local` の `DEFAULT_INDEX_ROWS`（未設定なら 30000）をサーバー既定として正とする**。bootstrap 時に localStorage の値はサーバー既定へ合わせて上書きされる（古い小さい値での取り込み漏れ防止／値変更の即時反映）。

行の復元: **最後に開いていた行**を別キー **`wikiWorkLastRow`**（`シートID#行番号` 形式）に保存し、次回起動（リロード）時に復元する。初回のキュー構築時に一度だけ適用し、**その行（シート＋行番号）が現在のキューに含まれる場合のみ**復元（含まれない＝進捗フィルタ等で対象外なら従来どおり先頭行から開始）。作業者変更などその後の再読込では効かない。

設定 UI は上から「表示する行（進捗）」（ドロップダウン3択: すべて / 完了を除く / 未着手のみ）「表示する列」（ドロップダウン4択: Entity値あり / 要確認（DeweyIDなし）/ 編集（三つ組＋memo＋役割列）/ すべて）の順。行・列ともに**択一のドロップダウン**で、見出しを対称にしつつ縦の長さを抑える（スマホ配慮）。

**表示する行を変更した直後の挙動**: フィルタ切替時もキューは再読込されるが、**今の行の表示はそのまま維持**される（`loadQueue` の位置維持分岐。現在行が新キューに含まれなければキュー番号は更新されない）。次の行/前の行へ移動すると、移動先のライブ status で `shouldSkipLiveRow` 判定が効き、絞り込みが反映される。ヘルプ（？）にも同旨を明記。

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
  - 保存後は最新の通しキュー（`SaveResult.queue`）でクライアントの基準を更新。`次の行`は通しキュー上の次の位置へ、末尾なら「キューの末尾です。」。
- **設定変更時も自動保存**: 進捗フィルタ/作業者の変更（キュー再読込）や、表示モード切替（`applyDisplayOptions`）でも、**現在行を再読込する前に未保存編集を自動保存**する。これがないと再読込で `edits` が保存値に戻り、未保存の Status 変更等が失われる（保存失敗時は再読込せず編集を保持・選択は巻き戻さない）。
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
- **表示**: 各候補は `タイトル|URL`（タイトルは `/api/link-preview` で取得）または `Wiki該当なし（`-` を入力）` / `Wiki欄変更不要のため入力なし`（空欄正解）と、一致種別・件数を表示。候補が無いときは `候補なし`。クリックでセルへ反映（空欄正解はセルを空に）。
- **学習（保存時マージ）**: 保存で正しいwiki 列が更新されると、その `名称/Wiki/正しいwiki`（URL/`-`）をメモリ上の履歴インデックスへ追記（`mergeWikiHistoryFromSave`）。さらに **Status を完了に変更した保存**では、deweyID 未付与かつ空欄のままの三つ組を「Wiki欄変更不要のため入力なし」として学習（`mergeBlankCorrectEntry`）。次回以降の候補に反映される。

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
| 認証・トークン更新 | `src/auth.ts`, `src/lib/google-session.ts`, `src/lib/api-error.ts` |
| UI | `src/components/WorkApp.tsx`, `WorkRowTable.tsx` |
| 検索リンク | `src/lib/search-links.ts` |
