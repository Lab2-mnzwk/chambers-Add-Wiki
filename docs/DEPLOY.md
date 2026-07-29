# デプロイ（Vercel + GitHub）

Next.js アプリは API Routes（Sheets 読み書き）を使うため、**静的ホスティングのみ**の GitHub Pages ではなく **Node サーバー**が必要です。  
GitHub 連携が簡単な **Vercel** を推奨します。

## 1. GitHub に push

```powershell
git add .
git status   # service_account.json / .env.local が含まれていないこと
git commit -m "Promote Next.js app to repo root"
git push origin main
```

## 2. Vercel で Import

1. https://vercel.com にログイン（GitHub 連携）
2. **Add New → Project** → リポジトリ `chambers-Add-Wiki` を選択
3. Framework Preset: **Next.js**（自動検出）
4. Root Directory: **`.`**（リポジトリ直下）
5. **Environment Variables** を追加:

**OAuth 利用（推奨・作業者の Google アカウント）** — [docs/OAUTH.md](./OAUTH.md)

| Name | Value |
|------|-------|
| `AUTH_SECRET` | ランダム文字列 |
| `AUTH_URL` | `https://<your-vercel-domain>` |
| `GOOGLE_CLIENT_ID` | OAuth クライアント ID |
| `GOOGLE_CLIENT_SECRET` | OAuth クライアント Secret |
| `SPREADSHEET_ID` | 対象スプレッドシート ID |
| `ENABLE_SHEET_WRITES` | `true` |

**サービスアカウント利用（従来）** — OAuth 3 変数を **設定しない** 場合

| Name | Value |
|------|-------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | サービスアカウント JSON の**全文**（1行） |
| `SPREADSHEET_ID` | `1Mc3pX949vlO_uxWpimn7_DsUAYr87GmroqXft6fvB4I` |
| `ENABLE_SHEET_WRITES` | `true` |

**共有キャッシュ（推奨）** — Vercel Marketplace で Upstash Redis / Redis互換KVを接続

| Name | Value |
|------|-------|
| `KV_REST_API_URL` | Redis REST URL |
| `KV_REST_API_TOKEN` | Redis REST Token |

Upstash名で連携される場合は `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN` でも動作します。未設定時は従来どおり `/tmp` へフォールバックします。

6. **Deploy**

7. **共有キャッシュの動作確認**（KV設定後）

デプロイ後、ブラウザ等で `https://<your-vercel-domain>/api/cache` を開く（GET）と、
`sharedCache.configured` / `sharedCache.reachable` が確認できる。

```json
{ "indexRowsCached": 0, "dataRowsCached": 0, "wikiHistoryEntries": 0,
  "sharedCache": { "configured": true, "reachable": true } }
```

- `configured: false` → 環境変数が読めていない（変数名の誤り・未Redeploy等）
- `configured: true, reachable: false` → URL/トークンが誤っている、またはRedis側の障害
- `reachable: true` になれば共有キャッシュは有効

## 3. 作業者への共有

- Vercel の Production URL（例: `https://chambers-add-wiki.vercel.app`）を共有
- **OAuth 時:** 各作業者の Google アカウントにスプレッドシート **編集者** 共有
- **サービスアカウント時:** SA に編集者共有（従来）

## 注意

- Redis REST未設定時、Vercel上のファイルキャッシュは `/tmp` に保存され、インスタンス間では共有されません
- ローカル開発: `npm run dev` → http://localhost:3010
- 認証ファイルは `service_account.json`（ルート、gitignore 済み）または `.env.local`

## 代替（自前サーバー）

```powershell
npm run build
npm start
```

PM2 / systemd 等で `npm start` を常駐させ、リバースプロキシで HTTPS を付与してください。
