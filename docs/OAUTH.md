# Google OAuth ログイン

OAuth 用の環境変数が揃っているとき、Sheets API は **ログインしたユーザーの Google アカウント** でアクセスします。  
未設定のときは従来どおり **サービスアカウント**（`service_account.json`）にフォールバックします。

## 1. Google Cloud Console

1. プロジェクトを開く（サービスアカウントと同じ GCP プロジェクトで可）
2. **API とサービス → OAuth 同意画面**
   - ユーザータイプ: 内部（Workspace）または外部
   - スコープ: `.../auth/spreadsheets`（アプリ側でも要求します）
3. **API とサービス → 認証情報 → 認証情報を作成 → OAuth クライアント ID**
   - アプリケーションの種類: **ウェブアプリケーション**
   - 承認済み JavaScript 生成元:
     - `http://localhost:3010`
     - `https://<your-vercel-domain>`
   - 承認済みリダイレクト URI:
     - `http://localhost:3010/api/auth/callback/google`
     - `https://<your-vercel-domain>/api/auth/callback/google`
4. **Google Sheets API** が有効になっていることを確認

## 2. 環境変数（`.env.local`）

```env
AUTH_SECRET="（openssl rand -base64 32 の結果。+ / = を含むので引用符推奨）"
AUTH_URL=http://localhost:3010

GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxx

SPREADSHEET_ID=1Mc3pX949vlO_uxWpimn7_DsUAYr87GmroqXft6fvB4I
ENABLE_SHEET_WRITES=true
```

Vercel 本番では `AUTH_URL=https://<your-domain>` を設定してください。

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `AUTH_SECRET` の **3 つすべて** が設定されていると OAuth モードになります。  
1 つでも欠けるとサービスアカウントモード（従来）になります。

## 3. スプレッドシート共有

OAuth モードでは **各作業者の Google アカウント** に、対象スプレッドシートの **編集者** 権限を付与してください。  
サービスアカウントへの共有は OAuth 利用時は不要です（併用しても構いません）。

## dev 再起動（500 / EADDRINUSE 時）

`.env.local` 変更後や `npm run build` 実行後は dev を再起動してください。

```powershell
netstat -ano | findstr :3010
taskkill /PID <表示されたPID> /F
cd c:\dev\chambers-engine\pj140
npm run dev
```

## 4. 動作確認

```powershell
npm run dev
```

1. http://localhost:3010 を開く
2. 「Google でログイン」→ シート編集権限のあるアカウントで同意
3. 作業者名・キューが表示されれば OK

## トラブル

| 症状 | 対処 |
|------|------|
| `Invalid URL`（キュー再読込等） | Vercel の `SPREADSHEET_ID` を確認。**ID のみ**（`1Mc3pX949vlO_...`）または URL 可。空文字は不可。変更後 **Redeploy** |
| redirect_uri_mismatch | Cloud Console のリダイレクト URI と `AUTH_URL` を一致させる |
| 500 / Internal Server Error | ポート占有 or `.next` 破損。下記「dev 再起動」を実行 |
| `MissingSecret` | `AUTH_SECRET` を設定し dev サーバーを再起動 |
| 403 / スプレッドシートが見つからない | ログインアカウントにシート編集権限があるか確認 |
| 認証の有効期限が切れた | 再ログイン（refresh token は初回 consent で取得） |
| OAuth に切り替わらない | `.env.local` の 3 変数を確認し dev サーバー再起動 |
