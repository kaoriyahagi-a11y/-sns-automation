# Cloudflare Workers セットアップ手順（香織さん用）

毎日 **08:00 / 21:00 JST ちょうど**に X へ自動投稿する Worker。
GitHub Actions の遅延・投稿かぶり問題を解決するため移行。

---

## ステップ 0: Cloudflare アカウント作成（3分）

1. https://dash.cloudflare.com/sign-up を開く
2. メアド + パスワードでアカウント作成
3. メール認証リンクをクリック
4. ダッシュボードに入れればOK（ドメイン登録などはスキップで可）

---

## ステップ 1: 依存インストール

`worker/` ディレクトリに入って wrangler（Cloudflare CLI）をインストール：

```bash
cd C:/Users/orika/sns-automation/worker
npm install
```

---

## ステップ 2: Cloudflareにログイン

```bash
npx wrangler login
```

ブラウザが開いてCloudflareの認証画面が出ます → 「許可する」をクリック。
ターミナルに「Successfully logged in」と出ればOK。

---

## ステップ 3: KV Namespace を作成

投稿済みフラグを保存する場所を作ります：

```bash
npx wrangler kv namespace create POSTED_KV
```

実行すると以下のような出力が出ます：

```
🌀 Creating namespace with title "sns-auto-poster-POSTED_KV"
✨ Success!
Add the following to your configuration file:
{ binding = "KV", id = "abc123def456..." }
```

**この `id = "abc123..."` の部分をコピー**して、`wrangler.toml` の `REPLACE_ME_AFTER_CREATING_NAMESPACE` を書き換えてください。

（または、IDを私に貼ってくれれば書き換えます）

---

## ステップ 4: Secrets を登録（5個）

`.env` ファイルに入ってるキーを Cloudflare 側にコピーします。
**1コマンドごとに、該当する値を貼ってEnter**：

```bash
npx wrangler secret put ANTHROPIC_API_KEY
# → .envのANTHROPIC_API_KEYの値を貼り付けてEnter

npx wrangler secret put TWITTER_API_KEY
# → .envのTWITTER_API_KEYの値を貼り付けてEnter

npx wrangler secret put TWITTER_API_SECRET
# → .envのTWITTER_API_SECRETの値を貼り付けてEnter

npx wrangler secret put TWITTER_ACCESS_TOKEN
# → .envのTWITTER_ACCESS_TOKENの値を貼り付けてEnter

npx wrangler secret put TWITTER_ACCESS_TOKEN_SECRET
# → .envのTWITTER_ACCESS_TOKEN_SECRETの値を貼り付けてEnter
```

さらに、手動テスト用のトークン（適当な文字列）を登録：

```bash
npx wrangler secret put TEST_TOKEN
# → 例: orimama-test-2026 と入力してEnter（あとでテストに使う）
```

---

## ステップ 5: デプロイ

```bash
npx wrangler deploy
```

成功すると URL が出ます（例: `https://sns-auto-poster.xxxx.workers.dev`）。
この URL をメモしておいてください。

---

## ステップ 6: 手動テスト（即投稿で動作確認）

デプロイした Worker に夕方スロットを即実行させてみます：

```bash
curl -X GET "https://sns-auto-poster.xxxx.workers.dev/test/evening" \
  -H "x-test-token: orimama-test-2026"
```

（URL とトークンは自分のに置き換え）

成功すると JSON が返り、X アカウントに投稿されます。
失敗時は `wrangler tail` でログを見る：

```bash
npx wrangler tail
```

別ターミナルでもう一度 curl を叩くとリアルタイムログが見えます。

---

## ステップ 7: GitHub Actions を止める

Cloudflare で動作確認できたら、GitHub Actions の二重実行を止めます：

`.github/workflows/post-morning.yml` と `.github/workflows/post-evening.yml` の
`schedule:` ブロックをコメントアウトし、`workflow_dispatch:` だけ残す：

```yaml
on:
  # schedule:
  #   - cron: '58 22 * * *'
  #   ...
  workflow_dispatch:  # 手動実行だけ残す（バックアップ用）
```

これで完了。

---

## 運用メモ

- **ログ確認**: `npx wrangler tail`（リアルタイム）
- **KVの中身を見る**: Cloudflare ダッシュボード → Workers & Pages → KV → POSTED_KV
- **手動で再投稿させたい日**: KV から `posted:evening:2026-04-22` を削除 → curl でテストエンドポイントを叩く
- **プロンプト修正した時**: `npx wrangler deploy` で即反映

## トラブル時

- 401 Twitter error → APIキー登録ミス。該当 secret を `wrangler secret put` で上書き
- 生成はできるが投稿しない → `wrangler tail` でエラーログ確認
- cronが動かない → Cloudflareダッシュボードの Worker 詳細 → Triggers タブで cron が登録されてるか確認
