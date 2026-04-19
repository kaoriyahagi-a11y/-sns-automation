# 🚀 SNS 自動化ツール

X (Twitter) / Instagram / TikTok の投稿を Claude AI で自動化するツールです。

---

## 目次

1. [必要なもの](#必要なもの)
2. [インストール](#インストール)
3. [APIキーの取得](#apiキーの取得)
4. [初期設定（.env）](#初期設定env)
5. [起動方法](#起動方法)
6. [機能の使い方](#機能の使い方)
   - [コンテンツ生成](#1-コンテンツ生成-claude-ai)
   - [今すぐ投稿](#2-今すぐ投稿)
   - [スケジュール投稿](#3-スケジュール投稿)
   - [スケジュール一覧](#4-スケジュール一覧)
   - [アナリティクス](#5-アナリティクス)
   - [スケジューラー起動](#6-スケジューラー起動)
7. [よくある質問 / トラブルシューティング](#よくある質問--トラブルシューティング)

---

## 必要なもの

| 要件 | バージョン |
|------|-----------|
| Node.js | v18以上 |
| Anthropic APIキー | （Claude AI用） |
| X Developer Account | （Twitter投稿用） |
| Meta Business Account | （Instagram投稿用） |
| TikTok Developer Account | （TikTok用） |

---

## インストール

```bash
# リポジトリに移動
cd C:\Users\orika\sns-automation

# 依存パッケージをインストール
npm install

# .env ファイルを作成
copy .env.example .env
```

---

## APIキーの取得

### Anthropic (Claude AI) — 必須

1. [console.anthropic.com](https://console.anthropic.com) にアクセス
2. 「API Keys」→「Create Key」
3. 生成されたキーを `.env` の `ANTHROPIC_API_KEY` に貼り付け

---

### X (Twitter) — X投稿に必要

1. [developer.twitter.com](https://developer.twitter.com) にアクセス
2. 「Developer Portal」→「Projects & Apps」→「New Project」
3. アプリを作成し「Keys and Tokens」タブを開く
4. 以下の4つのキーをコピーして `.env` に設定：

| .env の変数名 | Twitter上の名称 |
|--------------|----------------|
| `TWITTER_API_KEY` | API Key |
| `TWITTER_API_SECRET` | API Key Secret |
| `TWITTER_ACCESS_TOKEN` | Access Token |
| `TWITTER_ACCESS_TOKEN_SECRET` | Access Token Secret |
| `TWITTER_BEARER_TOKEN` | Bearer Token |

⚠️ **注意:** アプリの「User authentication settings」で  
「Read and Write」権限を有効にしてください。  
「Read only」のままでは投稿できません。

---

### Instagram — Instagram投稿に必要

**前提条件:** Instagramの Business または Creator アカウント

1. [developers.facebook.com](https://developers.facebook.com) にアクセス
2. 「マイアプリ」→「アプリを作成」→「ビジネス」を選択
3. 「Instagram Graph API」製品を追加
4. アクセストークンの取得：
   - 「Graph API エクスプローラー」で `instagram_basic, instagram_content_publish` 権限を選択
   - 「アクセストークンを生成」をクリック
5. ユーザーIDの確認：
   - `https://graph.instagram.com/v21.0/me?fields=id&access_token=＜トークン＞` にアクセス
   - 返ってきた `id` の値が `INSTAGRAM_USER_ID`

| .env の変数名 | 内容 |
|--------------|------|
| `INSTAGRAM_ACCESS_TOKEN` | 上記で取得したアクセストークン |
| `INSTAGRAM_USER_ID` | 上記で確認したユーザーID |

⚠️ **注意:** 無料のアクセストークンは60日で期限切れになります。  
本番運用では「長期アクセストークン」への変換が必要です。

---

### TikTok — TikTokアナリティクスに必要

1. [developers.tiktok.com](https://developers.tiktok.com) にアクセス
2. 「Manage apps」→「Connect an app」
3. OAuth認証でアクセストークンを取得
4. `.env` に設定：

| .env の変数名 | 内容 |
|--------------|------|
| `TIKTOK_ACCESS_TOKEN` | アクセストークン |
| `TIKTOK_OPEN_ID` | TikTokユーザーID |

⚠️ **動画投稿について:** TikTokの「Content Posting API」は  
審査申請が必要です。審査が通るまでは、このツールが生成した  
キャプションをコピーしてアプリから手動投稿してください。

---

## 初期設定（.env）

`C:\Users\orika\sns-automation\.env` をメモ帳などで開いて設定します。

```env
# Claude AI（必須）
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx

# X (Twitter)
TWITTER_API_KEY=xxxxxxxxxxxxxxxxxxxx
TWITTER_API_SECRET=xxxxxxxxxxxxxxxxxxxx
TWITTER_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxx
TWITTER_ACCESS_TOKEN_SECRET=xxxxxxxxxxxxxxxxxxxx
TWITTER_BEARER_TOKEN=xxxxxxxxxxxxxxxxxxxx

# Instagram
INSTAGRAM_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxx
INSTAGRAM_USER_ID=123456789

# TikTok
TIKTOK_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxx
TIKTOK_OPEN_ID=xxxxxxxxxxxxxxxxxxxx
```

使わないプラットフォームは空欄のままでOKです。

---

## 起動方法

```bash
cd C:\Users\orika\sns-automation

# 対話型メニューで起動（通常の使い方）
npm start

# スケジューラーをバックグラウンドで常時起動
npm run run-scheduler

# アナリティクスだけ確認
npm run analytics
```

---

## 機能の使い方

### 1. コンテンツ生成（Claude AI）

Claude AIがプラットフォームに最適化した投稿文・ハッシュタグを自動生成します。

**操作手順:**

```
メインメニュー → 「🤖 コンテンツを生成する」を選択
```

1. **投稿テーマを入力**  
   例: `新商品のハンドクリームを発売しました`

2. **プラットフォームを選択**（複数選択可）  
   スペースキーでチェック → Enterで確定

3. **トーンを選択**
   - カジュアル・親しみやすい → 日常会話のような文体
   - プロフェッショナル・信頼感 → ビジネス向け
   - 楽しい・エンタメ → バズりやすい遊び心のある文体
   - 情報提供・教育的 → 解説系・まとめ系

4. **目的を選択**
   - エンゲージメント増加 → コメント・いいねを促す内容
   - フォロワー獲得 → フォローを促すCTAを含む
   - 販売促進 → 商品の魅力を強調
   - ブランド認知度向上 → ブランドらしさを全面に

5. **業種・ジャンル（任意）**  
   例: `コスメ・美容`（入力することでより的確な内容になる）

**生成結果の例（X用）:**
```
📝 本文:
待望の新作ハンドクリームが登場🌿
うるおいが24時間続く、
まるで手のひらに保湿膜をまとうような
感触が癖になります✨

📣 CTA: プロフのリンクから試してみてください！
#️⃣ ハッシュタグ: #ハンドクリーム #スキンケア
```

生成後、そのまま **今すぐ投稿** または **スケジュール追加** できます。

---

### 2. 今すぐ投稿

生成済みのテキストを手入力して即時投稿します。

```
メインメニュー → 「📤 今すぐ投稿する」を選択
```

1. 投稿先プラットフォームを選択
2. テキストを入力（エディタが開きます）
3. ハッシュタグをカンマ区切りで入力  
   例: `ハンドクリーム, スキンケア, 美容`
4. Instagram の場合は **画像URL** を入力  
   （公開アクセスできるURLが必要、Google Driveの共有リンクは不可）

---

### 3. スケジュール投稿

指定した日時に自動投稿を予約します。

```
メインメニュー → 「⏰ 投稿をスケジュールする」を選択
```

1. 投稿先・テキスト・ハッシュタグを入力
2. 投稿日時を入力  
   例: `2025-06-15 19:00`

予約した投稿は `posts/queue.json` に保存されます。  
自動投稿を実行するには **スケジューラーを起動**する必要があります（後述）。

---

### 4. スケジュール一覧

予約済みの投稿を確認・管理します。

```
メインメニュー → 「📋 スケジュール一覧を見る」を選択
```

- **予定中のみ** → まだ投稿されていない予約
- **投稿済みのみ** → 実行済みの投稿
- **すべて** → 全履歴

一覧から以下の操作ができます：
- **今すぐ実行** → 予約時間を待たず即時投稿
- **削除** → 予約をキャンセル

---

### 5. アナリティクス

各プラットフォームのエンゲージメント状況を確認します。

```
メインメニュー → 「📊 アナリティクスを確認する」を選択
```

**表示される情報:**
- フォロワー数
- 直近10投稿のいいね・コメント・インプレッション合計
- 平均エンゲージメント数
- 最もバズった投稿

**Claude AIアドバイス（オプション）:**  
「はい」を選ぶとアナリティクスデータをClaudeに渡し、  
改善策を3つ提案してもらえます。

---

### 6. スケジューラー起動

予約投稿を自動実行するデーモンを起動します。

```bash
# 起動（このウィンドウを開いたままにする）
npm run run-scheduler
```

または対話型メニューから：
```
メインメニュー → 「▶️ スケジューラーを起動する」を選択
```

- 1分ごとにキューをチェック
- 予定時刻を過ぎた投稿を自動実行
- 毎朝9時にデイリーサマリーをログ出力
- `Ctrl + C` で停止

**PCを閉じても動かし続けたい場合は** `pm2` などのプロセスマネージャーを使用してください：

```bash
npm install -g pm2
pm2 start "npm run run-scheduler" --name sns-scheduler
pm2 save
pm2 startup  # PC再起動後も自動起動
```

---

## よくある質問 / トラブルシューティング

### Q. `TWITTER_API_KEY が設定されていません` と出る

`.env` ファイルにキーが正しく設定されているか確認してください。  
キーの前後にスペースや引用符 (`"`) が入っていないか確認してください。

```env
# ✅ 正しい
TWITTER_API_KEY=AbCdEfGhIjKlMnOpQrSt

# ❌ 間違い（引用符がある）
TWITTER_API_KEY="AbCdEfGhIjKlMnOpQrSt"
```

---

### Q. Twitter投稿で `403 Forbidden` エラーが出る

Developer Portalでアプリの権限設定を確認してください。  
「User authentication settings」で **「Read and Write」** を選択して保存後、  
**アクセストークンを再生成**する必要があります。

---

### Q. Instagram投稿で `（#100）` エラーが出る

以下を確認してください：
- InstagramアカウントがBusiness/Creatorに切り替わっているか
- アクセストークンに `instagram_content_publish` 権限があるか
- 画像URLが外部から公開アクセスできるURLか（localhost不可）

---

### Q. TikTokで投稿できない

TikTok Direct Post APIは審査制です。  
審査が通るまでは、ツールが生成したキャプションをコピーして  
TikTokアプリから手動投稿してください。

---

### Q. コンテンツ生成が途中で止まる / エラーになる

- `ANTHROPIC_API_KEY` が正しく設定されているか確認
- [console.anthropic.com](https://console.anthropic.com) でAPI利用残高を確認

---

### Q. スケジュール投稿が実行されない

スケジューラー（`npm run run-scheduler`）が起動中か確認してください。  
スケジューラーが停止していると投稿は実行されません。

---

### Q. 投稿履歴を確認・リセットしたい

`posts/queue.json` を直接テキストエディタで開くと  
全投稿履歴を確認・編集できます。  
完全にリセットする場合はファイルの中身を `[]` にしてください。
