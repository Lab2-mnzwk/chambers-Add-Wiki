# Wiki付与 行作業ビュー（pj140）

Google スプレッドシート「wiki付与作業シート（第一弾、第二弾）」の行単位 Wiki 付与作業 UI（**Next.js**）。

## 必要なもの

- Node.js 20+（LTS 推奨）
- Google Cloud サービスアカウント（JSON キー）
- 対象スプレッドシートへのサービスアカウント共有（**編集者**）

## ローカル起動

```powershell
cd c:\dev\chambers-engine\pj140
npm install
copy .env.example .env.local
npm run dev
```

ブラウザ: **http://localhost:3010**

## 認証

**Google OAuth（推奨）** — [docs/OAUTH.md](docs/OAUTH.md)  
`.env.local` に `AUTH_SECRET` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を設定。各作業者の Google アカウントにシート編集権限が必要です。

**サービスアカウント（従来・ローカル向け）** — OAuth 3 変数が未設定のとき自動で使用:

1. `.env.local` の `GOOGLE_SERVICE_ACCOUNT_JSON`（JSON 全文）
2. `.env.local` の `GOOGLE_APPLICATION_CREDENTIALS`（ファイルパス）
3. ルートの `service_account.json`（`.gitignore` 済み）

## 環境変数

| 変数 | 説明 |
|------|------|
| `SPREADSHEET_ID` | 対象スプレッドシート ID |
| `ENABLE_SHEET_WRITES` | `false` = ドライラン |
| `SHEET_CACHE_DIR` | キャッシュ（既定 `.cache`） |

## プロジェクト構成

```
pj140/
├── src/              # Next.js アプリ（本番）
├── docs/             # 仕様・デプロイ手順
├── package.json
└── .env.example
```

## 本番デプロイ

**[docs/DEPLOY.md](docs/DEPLOY.md)** — Vercel + GitHub 連携手順

## 仕様

**[docs/SPEC.md](docs/SPEC.md)** — 列表示ルール・編集範囲

## トラブル

| 症状 | 対処 |
|------|------|
| `EADDRINUSE :3010` | ポート占有プロセスを終了して `npm run dev` |
| 500 / 真っ白 | dev 中の `npm run build` 後は dev を再起動 |
| 429 Quota exceeded | 「再読み込み」後、操作間隔を空ける |
| 保存されない | `ENABLE_SHEET_WRITES=false` を確認 |
