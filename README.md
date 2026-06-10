# Wiki付与 行作業ビュー（pj140）

Google スプレッドシート「wiki付与作業シート（第一弾）」を、作業者が1行ずつ確認・編集する Streamlit アプリです。

## 必要なもの

- Python 3.11+（3.14 でも動作確認済み）
- Google Cloud サービスアカウント（JSON キー）
- 対象スプレッドシートへのサービスアカウント共有（**編集者**）

## ローカル起動

```powershell
cd c:\dev\chambers-engine\pj140
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 認証（どちらか）

**A. JSON ファイル（手軽）**

1. GCP サービスアカウント JSON を取得
2. `.streamlit/service_account.json` として保存（`.gitignore` 済み）

**B. Streamlit Secrets（Cloud と同じ形式）**

1. `.streamlit/secrets.toml.example` を `secrets.toml` にコピー
2. `[gcp_service_account]` の値を埋める

```powershell
streamlit run app.py
```

ブラウザ: http://localhost:8501

## スプレッドシート側の準備

1. スプレッドシート ID は `app.py` 先頭の `SPREADSHEET_ID`
2. サービスアカウントのメール（`client_email`）をスプレッドシートに **編集者** で共有
3. 「アサイン」シートに作業者の Discord 名一覧があること

## 書き込みロック（`app.py`）

| 定数 | 意味 |
|------|------|
| `ENABLE_SHEET_WRITES` | `False` = ドライランのみ |
| `ALLOW_PRODUCTION_WRITES` | 本番シートへの書き込み許可 |
| `WRITE_TARGET_SHEET_NAME` | 書き込み先シート名 |

本番運用前に意図どおりか必ず確認してください。

## サーバー内キャッシュ（429 対策）

Sheets の読み取りは **SQLite（`.cache/`）** に保持し、同一 Streamlit ワーカー上の全ユーザーで共有します。

| タイミング | Sheets API |
|-----------|------------|
| 初回アクセス（ヘッダー・インデックス・未キャッシュ行） | 読み取り |
| 2人目以降・同じ行の再表示 | **キャッシュから（API なし）** |
| 「次へ（保存）」 | 書き込みのみ |
| サイドバー「再読み込み」 | キャッシュ削除 → 再同期 |

スプレッドシートを外部から直接編集した場合は「再読み込み」で同期してください。

---

## GitHub に載せる

### 1. リポジトリ作成

```powershell
cd c:\dev\chambers-engine\pj140
git init
git add app.py requirements.txt README.md .gitignore .streamlit/config.toml .streamlit/secrets.toml.example
git commit -m "Add Wiki row work Streamlit app"
```

GitHub で **Private** リポジトリを作成し、push:

```powershell
git remote add origin https://github.com/YOUR_ORG/pj140.git
git branch -M main
git push -u origin main
```

**注意:** `service_account.json` / `secrets.toml` はコミットしないこと（`.gitignore` 済み）。push 前に `git status` で確認。

### 2. Streamlit Community Cloud で公開（作業者アクセス用）

1. https://share.streamlit.io に GitHub でログイン
2. **New app** → リポジトリ `pj140`、Main file: `app.py`
3. **Advanced settings → Secrets** に `[gcp_service_account]` を貼り付け（`secrets.toml.example` 参照）
4. Deploy

デプロイ後の URL（例: `https://xxx.streamlit.app`）を作業者に共有。

### 3. 作業者に渡すもの

- アプリ URL（Streamlit Cloud）
- 自分の Discord 名を「アサイン」シートで確認してもらう
- 操作: サイドバーで作業者名・対象行フィルタ → 行作業 → **次へ（保存）**

---

## トラブル

| 症状 | 対処 |
|------|------|
| スプレッドシートが見つからない | サービスアカウントにシート共有されているか確認 |
| 429 Quota exceeded | 1〜2分待って「再読み込み」。連続操作を控える |
| 保存されない | `ENABLE_SHEET_WRITES` / `ALLOW_PRODUCTION_WRITES` を確認 |
| 正しいwiki が保存されない | 入力後 Enter または他欄クリックしてから「次へ（保存）」 |
