# シート履歴（Wiki History）

過去にシートへ記入された **正しいwiki** を学習し、編集時に候補として表示する機能です。

## 目的

Wiki 付与作業では `(name, wiki)` の組に対して **正しいwiki** URL を入力します。同じ組み合わせは過去行にも存在することが多いため、履歴から候補を出すと入力が速くなります。

## 学習対象

各 Wiki 三つ組 `(name列, wiki列, 正しいwiki列)` について:

| 条件 | 学習するか |
|------|-----------|
| name・wiki・正しいwiki がすべて非空 | ○ |
| 正しいwiki が HTTP(S) URL | ○ |
| 正しいwiki が空（Wiki 合致で不要な行） | × |
| name または wiki が空 | × |

三つ組の定義は `WIKI_TRIPLET_RULES`（`src/lib/config.ts`）にあり、Agent / Place / Patient-Theme / Territory 各セクションの列をカバーします。

## データの流れ

```mermaid
flowchart LR
  Sheet[Google Sheet] -->|初回 batchGet| Build[aggregateWikiHistory]
  Build --> Cache[.cache/*.json]
  Cache --> Suggest[suggestWikiHistory]
  Suggest --> UI[WikiCorrectInput]
  Save[行保存] --> Merge[mergeWikiHistoryFromSave]
  Merge --> Cache
```

1. **初回候補取得** — `GET /api/wiki-history` が呼ばれたとき、キャッシュに履歴がなければシート先頭 N 行（`indexRows`）から三つ組列を一括読取し、インデックスを構築します。
2. **候補表示** — 正しいwiki 列の textarea にフォーカスすると、同じ **name**（必要なら **wiki** も）に基づき候補を表示します。
3. **保存時更新** — 行保存で正しいwiki 列が更新された場合、キャッシュ上の履歴に 1 件マージします（Sheets 全体の再スキャンは不要）。

## 候補の優先順位

`suggestWikiHistory`（`src/lib/wiki-history.ts`）:

1. **exact** — name と wiki の両方が一致（正規化後）
2. **name** — name のみ一致（別 wiki だった過去行も参考になる場合）
3. 同一 correctWiki URL は 1 件にまとめる
4. 出現回数 `count` の多い順

入力中の文字列は `q` パラメータで correctWiki URL に部分一致フィルタします。

## API

```
GET /api/wiki-history?name=...&wiki=...&q=...&indexRows=10000
```

レスポンス:

```json
{
  "suggestions": [
    {
      "correctWiki": "https://...",
      "name": "...",
      "wiki": "...",
      "match": "exact",
      "count": 3
    }
  ]
}
```

## キャッシュ

- 保存先: `.cache/{SPREADSHEET_ID}.json` の `wikiHistory` フィールド
- `indexRows` が UI の設定と一致しない場合は再構築
- `DELETE /api/cache`（キャッシュクリア）で履歴も削除

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `src/lib/wiki-history.ts` | 正規化・集計・検索・マージ |
| `src/lib/sheets.ts` | `fetchWikiHistoryFromSheet` |
| `src/lib/store.ts` | キャッシュ読書 |
| `src/lib/work-service.ts` | `ensureWikiHistory`, 保存時マージ |
| `src/components/WikiCorrectInput.tsx` | 候補 UI |
| `src/app/api/wiki-history/route.ts` | API |

## 運用上の注意

- 初回構築は Sheets API の batchGet 1 回（三つ組数 29 × 3 列 = 87 レンジ × `indexRows` 行）が走ります。`indexRows`（既定 30000）が大きいほど時間・転送量が増えますが、**キャッシュ未構築時のみ**（以降は再利用）。三つ組は疎なため末尾空セルは API 側で省かれ、実転送はこれより小さくなります。読取が大きすぎて失敗する場合は batchGet の分割取得を検討。
- OAuth モードではログイン済みユーザーのトークン、未設定時はサービスアカウントで読み取ります。
- 履歴は **正しいwiki が記入された行だけ** から作るため、Wiki 合致（正しいwiki 不要）行は候補に影響しません。
