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

| Name | Value |
|------|-------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | サービスアカウント JSON の**全文**（1行） |
| `SPREADSHEET_ID` | `1jGba1Vnzjlvf6dNj6hqVRYoPEkcJVkeU1dND-vnThrY` |
| `ENABLE_SHEET_WRITES` | `true` |

6. **Deploy**

## 3. 作業者への共有

- Vercel の Production URL（例: `https://chambers-add-wiki.vercel.app`）を共有
- スプレッドシートは引き続きサービスアカウントに **編集者** 共有

## 注意

- Vercel 上のファイルキャッシュは `/tmp` に保存され、インスタンス間では共有されません（429 対策は弱くなります）
- ローカル開発: `npm run dev` → http://localhost:3010
- 認証ファイルは `service_account.json`（ルート、gitignore 済み）または `.env.local`

## 代替（自前サーバー）

```powershell
npm run build
npm start
```

PM2 / systemd 等で `npm start` を常駐させ、リバースプロキシで HTTPS を付与してください。
