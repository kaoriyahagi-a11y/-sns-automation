# X自動投稿 内容整理（事故修正4点） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** X自動投稿で発生していた「曜日ずれ／モチーフ乱用／時間軸の捏造／暗い締め」の4事故を、プロンプト改修＋生成後フィルタ＋直近モチーフ検出で止血する。

**Architecture:** 既存の `post-now.js → generateMomEntrepreneurTweets → pickBest` フローに3層防御を追加。(1) `post-now.js` 側で JST日付・スロット・直近モチーフを算出して generator に注入、(2) `momEntrepreneurGenerator.js` の SYSTEM_PROMPT 本体から時刻奨励文を削除＋締めハッピー化ルール追加、(3) `pickBest` に時間軸違反検出フィルタを追加。

**Tech Stack:** Node.js (ESM), twitter-api-v2, @anthropic-ai/sdk, GitHub Actions（cron）。テストフレームワークは無いので、純粋関数は `node -e` でのアドホック検証、プロンプトは `node generate-tweets.js` での手動目視確認。

**Spec:** `docs/superpowers/specs/2026-05-10-x-auto-post-content-fixes-design.md`

---

## File Structure

| ファイル | 役割 | 変更種別 |
|---|---|---|
| `post-now.js` | GitHub Actions エントリ。直近投稿取得→候補生成→pickBest→投稿 | 修正（ヘルパー追加・呼び出し更新・フィルタ拡張） |
| `src/services/momEntrepreneurGenerator.js` | Claude API呼び出し、SYSTEM_PROMPT、ツイート生成 | 修正（シグネチャ拡張・user prompt注入・SYSTEM_PROMPT編集） |
| `src/services/dailyAutoPost.js` | ローカル運用用（現在未使用、シグネチャ整合のため） | 修正（呼び出しに同じ引数を渡せるよう調整） |
| `generate-tweets.js` | 手動生成スクリプト | 修正（slot/日付を擬似的に渡せるように） |

新規ファイルなし。すべて既存ファイルの修正。

---

## Task 1: post-now.js にヘルパー関数を追加

**Files:**
- Modify: `post-now.js`（ファイル冒頭の import 直後に挿入）

ヘルパー関数 4つを追加する：`getJstTodayInfo()`、`SLOT_LABELS`、`RATE_LIMITED_MOTIFS` + `detectBannedMotifs()`、`TIME_AXIS_PATTERNS` + `violatesTimeAxis()`。

- [ ] **Step 1: ヘルパー関数を追加**

`post-now.js` の `import` ブロック直後（`const SLOTS = {` の前）に以下を挿入：

```js
// ---- 内容ガード用ヘルパー（2026-05-17追加） ----

// JST 今日の "YYYY-MM-DD（曜日）" 表記を返す
function getJstTodayInfo() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  const dows = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
  const dow = dows[jst.getUTCDay()];
  return `${y}-${m}-${d}（${dow}）`;
}

const SLOT_LABELS = {
  morning: '朝8時（JST）',
  evening: '夜21時（JST）',
};

// 月1回程度に制限したいモチーフ
const RATE_LIMITED_MOTIFS = ['グミ', 'モンスター'];

// 直近30日のツイート群から、再利用禁止すべきモチーフを抽出
function detectBannedMotifs(tweets) {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const recent = tweets.filter((t) => new Date(t.created_at).getTime() >= cutoff);
  return RATE_LIMITED_MOTIFS.filter((m) =>
    recent.some((t) => t.text.includes(m))
  );
}

// 時間軸関連の禁止パターン
const TIME_AXIS_PATTERNS = [
  /\d{1,2}[:：]\d{2}/,                          // 7:11 / 21:00
  /\d{1,2}時(\d{1,2}分)?/,                      // 22時 / 7時11分（例外なし）
  /\d+\s*人(?!間|生|員|参|気)/,                 // 2000人（人間/人生/人員/人参/人気は除外）
  /(月商|売上|年商|単価|月収|月収入|年収)[^\s]*?\d/, // 月商500万
  /\d+\s*(分で|時間で|分かけて|時間かけて|分後|時間後)/, // 30分で / 1時間後
];

function violatesTimeAxis(text) {
  return TIME_AXIS_PATTERNS.some((p) => p.test(text));
}
```

- [ ] **Step 2: `violatesTimeAxis` をアドホック検証**

PowerShell で：

```powershell
node -e "
const TIME_AXIS_PATTERNS = [
  /\d{1,2}[:：]\d{2}/,
  /\d{1,2}時(\d{1,2}分)?/,
  /\d+\s*人(?!間|生|員|参|気)/,
  /(月商|売上|年商|単価|月収|月収入|年収)[^\s]*?\d/,
  /\d+\s*(分で|時間で|分かけて|時間かけて|分後|時間後)/,
];
const v = (t) => TIME_AXIS_PATTERNS.some(p => p.test(t));
// 違反するはず
console.log('7:11 ->', v('7:11に起きた'));
console.log('22時 ->', v('夜22時にお風呂'));
console.log('朝7時 ->', v('朝7時に起きて'));
console.log('2000人 ->', v('2000人超えて'));
console.log('月商 ->', v('月商500万'));
console.log('30分で ->', v('30分で終わった'));
// 違反しないはず
console.log('3つ気づいた ->', v('3つ気づいた'));
console.log('2児の母 ->', v('2児の母として'));
console.log('人参 ->', v('人参を切る'));
console.log('人気 ->', v('人気者'));
"
```

Expected: 最初の6個が全部 `true`、最後の4個が全部 `false`。

- [ ] **Step 3: `getJstTodayInfo` をアドホック検証**

```powershell
node -e "
function getJstTodayInfo() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  const dows = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
  const dow = dows[jst.getUTCDay()];
  return y + '-' + m + '-' + d + '（' + dow + '）';
}
console.log(getJstTodayInfo());
"
```

Expected: `2026-05-17（日曜日）` のような形式（実行日に応じて）。

- [ ] **Step 4: コミット**

```powershell
git add post-now.js
git commit -m @'
add helpers for content guards (date / slot / motif / time-axis)

post-now.js に getJstTodayInfo / SLOT_LABELS / detectBannedMotifs /
violatesTimeAxis を追加。まだ呼び出し側には繋いでいない。
'@
```

---

## Task 2: post-now.js の pickBest に時間軸フィルタを追加

**Files:**
- Modify: `post-now.js` 内 `pickBest` 関数

- [ ] **Step 1: pickBest の valid 判定に violatesTimeAxis を追加**

現在の `pickBest`（`post-now.js:89-116`）：

```js
function pickBest(tweets, recentTexts) {
  const valid = tweets.filter(
    (t) =>
      t.text.length <= 280 &&
      /#ORIMAMA\b/.test(t.text) &&
      !/[。、「」]/.test(t.text) &&
      !/https?:\/\//.test(t.text)
  );
  const pool = valid.length > 0 ? valid : tweets;
  ...
```

これを以下に置換：

```js
function pickBest(tweets, recentTexts) {
  const baseValid = tweets.filter(
    (t) =>
      t.text.length <= 280 &&
      /#ORIMAMA\b/.test(t.text) &&
      !/[。、「」]/.test(t.text) &&
      !/https?:\/\//.test(t.text)
  );
  const valid = baseValid.filter((t) => !violatesTimeAxis(t.text));

  if (baseValid.length > 0 && valid.length === 0) {
    logger.warn(
      `全候補が時間軸ルール違反。基本条件は満たすプールから195字に近いものを採用します。`
    );
  }

  // 違反フィルタで全滅したら baseValid（基本条件OKな集合）で代用、それも空なら tweets
  const pool = valid.length > 0 ? valid : baseValid.length > 0 ? baseValid : tweets;

  // 直近投稿との類似度0.10未満のみを残す（既存ロジック）
  const SIMILARITY_THRESHOLD = 0.1;
  const filtered = pool.filter((t) => {
    const maxSim = recentTexts.reduce(
      (max, r) => Math.max(max, ngramSimilarity(t.text, r, 4)),
      0
    );
    return maxSim < SIMILARITY_THRESHOLD;
  });
  const finalPool = filtered.length > 0 ? filtered : pool;
  if (filtered.length === 0 && pool.length > 0) {
    logger.warn('全候補が直近投稿と類似（しきい値未満なし）。やむを得ず全候補から選定。');
  }

  return finalPool.sort(
    (a, b) => Math.abs(195 - a.text.length) - Math.abs(195 - b.text.length)
  )[0];
}
```

- [ ] **Step 2: 構文チェック**

```powershell
node --check post-now.js
```

Expected: 何も出力されない（構文OK）。

- [ ] **Step 3: コミット**

```powershell
git add post-now.js
git commit -m @'
add time-axis filter to pickBest

時間軸違反（具体時刻・人数・売上の数字）を含む候補を pickBest から除外。
全滅時は警告ログ＋基本条件のみ満たすプールへフォールバック。
'@
```

---

## Task 3: post-now.js の fetchRecentPosts 拡張 + メインフロー配線

**Files:**
- Modify: `post-now.js`（`fetchRecentPosts` と末尾のメインフロー）

- [ ] **Step 1: fetchRecentPosts の取得件数を 30→60 に拡張**

`post-now.js` の `fetchRecentPosts` 内で：

```js
const tl = await client.v2.userTimeline(me.data.id, {
  max_results: 30,
  ...
```

を以下に変更：

```js
const tl = await client.v2.userTimeline(me.data.id, {
  max_results: 60,  // 1日2投稿×30日相当（直近モチーフ検出のため）
  ...
```

- [ ] **Step 2: メインフローで新変数を計算して generator に渡す**

ファイル末尾の以下の部分（`post-now.js:124-148` 付近）：

```js
const slot = SLOTS[slotName];
const r = pickRotation(slot);
logger.header(`[${slotName}] 自動投稿 / postType=${r.postType}`);

// 直近投稿を取得して、cutoff判定 + avoidPhrases構築
const { alreadyPosted, tweets: recent } = await fetchRecentPosts(slot.cutoffHourJst);

if (alreadyPosted) {
  logger.info(`[${slotName}] 本日${slot.cutoffHourJst}時以降に投稿済み。スキップします。`);
  process.exit(0);
}

const avoidPhrases = buildAvoidPhrases(recent, 20);
logger.info(`重複ガード: 直近${avoidPhrases.length}件のフレーズを除外指示`);

const candidates = await generateMomEntrepreneurTweets({
  postType: r.postType,
  count: 5,
  theme: r.theme,
  avoidPhrases,
});
```

これを以下に置換：

```js
const slot = SLOTS[slotName];
const r = pickRotation(slot);
logger.header(`[${slotName}] 自動投稿 / postType=${r.postType}`);

// 直近投稿を取得して、cutoff判定 + avoidPhrases構築 + モチーフ検出
const { alreadyPosted, tweets: recent } = await fetchRecentPosts(slot.cutoffHourJst);

if (alreadyPosted) {
  logger.info(`[${slotName}] 本日${slot.cutoffHourJst}時以降に投稿済み。スキップします。`);
  process.exit(0);
}

const avoidPhrases = buildAvoidPhrases(recent, 20);
logger.info(`重複ガード: 直近${avoidPhrases.length}件のフレーズを除外指示`);

const todayJst = getJstTodayInfo();
const slotInfo = SLOT_LABELS[slotName];
const bannedMotifs = detectBannedMotifs(recent);
logger.info(`日付/スロット: ${todayJst} / ${slotInfo}`);
if (bannedMotifs.length > 0) {
  logger.info(`禁止モチーフ（直近30日に使用済み）: ${bannedMotifs.join('、')}`);
}

const candidates = await generateMomEntrepreneurTweets({
  postType: r.postType,
  count: 5,
  theme: r.theme,
  avoidPhrases,
  todayJst,
  slotInfo,
  bannedMotifs,
});
```

- [ ] **Step 3: 構文チェック**

```powershell
node --check post-now.js
```

Expected: 何も出力されない。

- [ ] **Step 4: コミット**

```powershell
git add post-now.js
git commit -m @'
wire date / slot / banned motifs into generator call

fetchRecentPosts を 60件取得に拡張し、todayJst / slotInfo / bannedMotifs を
算出して generateMomEntrepreneurTweets に渡す。generator 側の受け取りは次タスク。
'@
```

---

## Task 4: momEntrepreneurGenerator.js のシグネチャ拡張 + user prompt 注入

**Files:**
- Modify: `src/services/momEntrepreneurGenerator.js`（`generateMomEntrepreneurTweets` 関数）

- [ ] **Step 1: 関数シグネチャに 3引数を追加**

現在（`momEntrepreneurGenerator.js:265`）：

```js
export async function generateMomEntrepreneurTweets({ postType = 'mixed', count = 5, theme = '', avoidPhrases = [] } = {}) {
```

を以下に変更：

```js
export async function generateMomEntrepreneurTweets({
  postType = 'mixed',
  count = 5,
  theme = '',
  avoidPhrases = [],
  todayJst = '',
  slotInfo = '',
  bannedMotifs = [],
} = {}) {
```

- [ ] **Step 2: user prompt に新ブロックを注入**

現在の `userPrompt` 構築部分（`momEntrepreneurGenerator.js:276-308`）の `avoidBlock` 定義の直後に、新しいブロックを追加。

`avoidBlock` 定義の直後（`const userPrompt = \`...\`` の直前）に以下を挿入：

```js
  const dateBlock = todayJst
    ? `\n【投稿が出る日付・曜日】\n${todayJst}\n→ 曜日を語るならこの曜日に合わせること。合わせられないなら曜日を一切口にしないこと。\n`
    : '';

  const slotBlock = slotInfo
    ? `\n【投稿スロット】\n${slotInfo} に投稿されます。投稿時刻より未来の時刻を本文に書かないこと。\n`
    : '';

  const motifBlock = bannedMotifs.length > 0
    ? `\n【今回の投稿で使わない単語（直近30日に使用済みのため）】\n${bannedMotifs.map((m) => `- ${m}`).join('\n')}\n`
    : '';

  const timeAxisRule = `
【時間軸ルール（絶対遵守）】
- 具体時刻（○時／○:○○／○時○○分）を本文に書かない（例外なし、「朝7時起き」もNG）
- 人数の数字（2000人／フォロワー○人）を書かない
- 売上・金額の数字（月商○万円／単価○円）を書かない
- 時間軸を匂わせる数字（30分で／2時間かけて／1時間後）も書かない
- 許可される時間表現: 「朝」「お昼」「夜」「夜遅く」「真夜中」程度の粗さ＋行動ベース
`;

  const endingRule = `
【締めのトーン（最重要・絶対遵守）】
最後の1〜2行は必ず明るく前向きに着地させてください。
- ベース世界観: 「仕事も子育ても好き／がむしゃらな毎日が楽しい」
- 冒頭〜中盤で大変さ・本音を出すのはOK、ただし最後は必ず光・好き・がんばれる・しあわせ に転じる
- 「疲れた」「限界」「辛い」「やめたい」「これでいいのかな」「誰にもわかってもらえない」のような暗い・諦め・愚痴・自虐で締めるのは禁止
`;
```

そして `userPrompt` テンプレートリテラル内、既存の `${avoidBlock}` の直後に、新しいブロックを追加：

現在：

```js
  const userPrompt = `${typeInstruction}
${avoidBlock}
${theme ? `【テーマ・キーワード】\n${theme}\n` : ''}
【指示】
矢萩香織 本人が書く投稿を **${count}本** 生成してください。
```

これを以下に変更：

```js
  const userPrompt = `${typeInstruction}
${avoidBlock}${dateBlock}${slotBlock}${motifBlock}${timeAxisRule}${endingRule}
${theme ? `【テーマ・キーワード】\n${theme}\n` : ''}
【指示】
矢萩香織 本人が書く投稿を **${count}本** 生成してください。
```

- [ ] **Step 3: 既存の指示リストに「最重要」項目を追加**

同じ userPrompt 内、既存の箇条書き指示部分（`- 句読点「。」「、」を一切使わない` から始まる）の末尾に追加：

現在：

```js
- **フォロワー増加視点**: プロフを見たくなる一貫性と本音を出す
```

の直後に追加：

```js
- **時刻・人数・売上の数字を本文に書かない**（時間軸ルール厳守）
- **最後の1〜2行は必ず明るく前向きに着地**（締めのトーン厳守・例外なし）
```

- [ ] **Step 4: 構文チェック**

```powershell
node --check src/services/momEntrepreneurGenerator.js
```

Expected: 何も出力されない。

- [ ] **Step 5: コミット**

```powershell
git add src/services/momEntrepreneurGenerator.js
git commit -m @'
inject date / slot / motif / time-axis / ending rules into user prompt

generateMomEntrepreneurTweets に todayJst / slotInfo / bannedMotifs 引数を追加。
user prompt に時間軸禁止ルールと締めハッピー化ルールも注入。
SYSTEM_PROMPT 本体の修正は次タスク。
'@
```

---

## Task 5: SYSTEM_PROMPT 本体の改修

**Files:**
- Modify: `src/services/momEntrepreneurGenerator.js`（`SYSTEM_PROMPT` 内、4箇所）

SYSTEM_PROMPT は `cache_control: { type: 'ephemeral' }` でキャッシュされているため、編集すると次回呼び出し時に **キャッシュ再作成のコストが1回発生**する（以降は通常通りヒット）。

- [ ] **Step 1: 冒頭フックの「数字」例から時刻・人数を削除**

検索：

```
- **数字**: 「朝5時」「30分で」「2000人超えて思う」
```

`momEntrepreneurGenerator.js` 内の冒頭フックセクション（`:117` 付近、1箇所のみ）を以下に置換：

```
- **数字**: 「3つ気づいた」「2回連続で」（時刻・人数・売上の数字は禁止）
```

- [ ] **Step 2: 良い例3 を時刻ゼロに差し替え**

検索：

```
## 良い例3（日常リアル・絵文字4個）
朝7時に起きて
娘の小学校の支度しながら
片手でLINE確認してる☕

娘が行ってから息子を起こして
保育園の準備しながら
もう今日のタスク考えてる😵‍💫

朝から仕事の頭
これが日常になって数年🥲

共感してくれる人いる？💓

#ORIMAMA
```

これを以下に置換：

```
## 良い例3（日常リアル・絵文字4個）
娘の支度を横目に
片手でLINE返してる☕

娘を送り出してから息子を起こして
保育園の準備しながら
もう今日のタスクが頭で回ってる😵‍💫

バタバタの中で仕事の頭
でもこの忙しさが好きなんだよね🥹

同じ毎日のママいる？一緒にがんばろ💓

#ORIMAMA
```

- [ ] **Step 3: 「やってはいけないこと」に時間軸＋暗い締めの禁止を追加**

検索：

```
# 【やってはいけないこと】
- 句読点「。」「、」「「」「」」を使う
- 「います」「おります」など丁寧すぎる表現の連発
- AI感のある長々とした説明
- 他社・他者の批判
- 政治・宗教・思想への言及
- クライアント社名・金額・取引情報を出す
- 副業・MLM・勧誘と誤解される内容
- 「完璧な起業家ママ」を演じすぎる
- 既存の投稿をほぼそのままパクる
- きれいごとだけ並べる
```

これの末尾（`きれいごとだけ並べる` の直後）に以下を追加：

```
- 具体時刻（○時／○:○○／○時○○分）を本文に書く（例外なし）
- 「朝○時に起きる／起きた」など時刻起点の描写
- 人数の数字（2000人／フォロワー○人達成）を書く
- 売上・金額の数字（月商○万円／単価○円）を本文に出す
- 時間軸を匂わせる数字（30分で／2時間かけて／1時間後）を書く
- 暗いトーン・諦め・愚痴・自虐で締める（最後の1〜2行が暗いのは禁止）
```

- [ ] **Step 4: 「投稿の質の基準」の冒頭に【最重要】締めルールを追加**

検索：

```
# 【投稿の質の基準】
## 良い例1（問いかけ型・リプ誘発・絵文字3個）
```

これの間（`# 【投稿の質の基準】` の直後、`## 良い例1` の直前）に以下を挿入：

```
## 【最重要】締めのトーン
**最後の1〜2行は必ず明るく前向きに終わる。例外なし。**
- 冒頭〜中盤で大変さ・本音・しんどさを出すのはOK
- ただし最後は必ず「光・好き・がんばれる・しあわせ」に着地させる
- ベースの世界観: 「仕事も子育ても好き／がむしゃらな毎日が楽しい」

### 締めのOK例
- だから今日もがんばれる💪✨
- この忙しさが好きなんだよね🥹
- 同じ人いる？一緒にがんばろ💓
- 明日も全部やるって決めた❤️‍🔥
- 結局これが私のしあわせかも🌸

### 締めのNG例
- 「疲れた」「限界」「辛い」「やめたい」で締める
- 「これでいいのかな…」のような迷い・不安で終わる
- 「誰にもわかってもらえない」のような孤独で終わる
- 自虐・卑下で終わる

```

- [ ] **Step 5: 「生成時の心構え」末尾に注意喚起を追加**

検索：

```
- URL・外部リンクは本文に含めない`;
```

これの直前に以下の項目を追加（同じバッククォート閉じの前）：

```
- 時刻・人数・売上の数字は本文に書かない（時間軸ルール厳守）
- 締めは必ず明るく前向きに（最後の1〜2行が暗いのは禁止）
- 投稿が出る日付・曜日・スロットは user prompt で渡される。それに従う
- URL・外部リンクは本文に含めない`;
```

（つまり既存の `- URL・外部リンクは本文に含めない` を残しつつ、その前に3行追加）

- [ ] **Step 6: 構文チェック**

```powershell
node --check src/services/momEntrepreneurGenerator.js
```

Expected: 何も出力されない。

- [ ] **Step 7: SYSTEM_PROMPT に残った問題表現が無いか grep**

```powershell
node -e "
const fs = require('fs');
const t = fs.readFileSync('src/services/momEntrepreneurGenerator.js', 'utf8');
// SYSTEM_PROMPT 内に残っていてはいけない表現
const ngStrings = ['朝5時', '朝7時に起きて', '2000人超えて', '30分で'];
ngStrings.forEach(s => {
  const found = t.includes(s);
  console.log((found ? 'STILL PRESENT' : 'OK removed') + ': ' + s);
});
"
```

Expected: 全て `OK removed`。1つでも `STILL PRESENT` が出たら該当箇所を修正。

- [ ] **Step 8: コミット**

```powershell
git add src/services/momEntrepreneurGenerator.js
git commit -m @'
overhaul SYSTEM_PROMPT: remove time encouragements + add happy ending rule

数字フック例から朝5時/30分で/2000人超えてを除去、良い例3を時刻ゼロに差し替え、
やってはいけないこと/生成時の心構え に時間軸ルールと暗い締め禁止を追加、
投稿の質の基準の冒頭に【最重要】締めのトーン セクションを追加。
'@
```

---

## Task 6: dailyAutoPost.js のシグネチャ整合

**Files:**
- Modify: `src/services/dailyAutoPost.js`

現在は未使用だが、将来再開時に同じ引数を渡せるよう整合させておく。

- [ ] **Step 1: generateAndScheduleSlot 内の呼び出しに新引数を渡す**

`src/services/dailyAutoPost.js:60-64`：

```js
const candidates = await generateMomEntrepreneurTweets({
  postType: slot.postType,
  count: 5,
  theme: slot.theme,
});
```

これを以下に置換：

```js
// JST 今日の表記
const jst = new Date(Date.now() + 9 * 3600 * 1000);
const y = jst.getUTCFullYear();
const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
const d = String(jst.getUTCDate()).padStart(2, '0');
const dows = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
const todayJst = `${y}-${m}-${d}（${dows[jst.getUTCDay()]}）`;
const slotInfo = slotName === 'morning' ? '朝8時（JST）' : '夜21時（JST）';

const candidates = await generateMomEntrepreneurTweets({
  postType: slot.postType,
  count: 5,
  theme: slot.theme,
  todayJst,
  slotInfo,
  bannedMotifs: [],  // ローカル運用ではタイムライン取得しない簡易版
});
```

- [ ] **Step 2: 構文チェック**

```powershell
node --check src/services/dailyAutoPost.js
```

Expected: 何も出力されない。

- [ ] **Step 3: コミット**

```powershell
git add src/services/dailyAutoPost.js
git commit -m @'
align dailyAutoPost call signature with new generator params

ローカル運用用 dailyAutoPost.js も todayJst / slotInfo を渡すよう調整。
bannedMotifs は簡易版（空配列）。現在未使用だが将来再開時の整合性確保。
'@
```

---

## Task 7: generate-tweets.js を手動検証用に拡張

**Files:**
- Modify: `generate-tweets.js`

- [ ] **Step 1: CLI フラグで slot を受け取れるようにする**

現在の `generate-tweets.js:13-29` を以下のように修正。

`const postType = args.type || 'mixed';` の直後に以下を追加：

```js
const slotArg = args.slot || 'evening'; // 'morning' | 'evening'
```

`const tweets = await generateMomEntrepreneurTweets(...)` の呼び出しを以下に変更：

現在：

```js
const tweets = await generateMomEntrepreneurTweets({ postType, count, theme });
```

を以下に置換：

```js
// JST 今日の表記
const jst = new Date(Date.now() + 9 * 3600 * 1000);
const y = jst.getUTCFullYear();
const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
const d = String(jst.getUTCDate()).padStart(2, '0');
const dows = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
const todayJst = `${y}-${m}-${d}（${dows[jst.getUTCDay()]}）`;
const slotInfo = slotArg === 'morning' ? '朝8時（JST）' : '夜21時（JST）';

console.log(`  日付: ${todayJst}`);
console.log(`  スロット: ${slotInfo}`);
logger.divider();

const tweets = await generateMomEntrepreneurTweets({
  postType,
  count,
  theme,
  todayJst,
  slotInfo,
  bannedMotifs: ['グミ', 'モンスター'],  // 手動検証では常に禁止して挙動確認
});
```

- [ ] **Step 2: 構文チェック**

```powershell
node --check generate-tweets.js
```

Expected: 何も出力されない。

- [ ] **Step 3: コミット**

```powershell
git add generate-tweets.js
git commit -m @'
add slot flag and inject date/slot/banned motifs to manual generator

generate-tweets.js に --slot=morning|evening フラグを追加。
todayJst / slotInfo / bannedMotifs を渡せるようにし、手動検証で
新ルールの挙動を確認できる状態にする。
'@
```

---

## Task 8: 手動目視検証 + 最終確認

**Files:**
- なし（実行・確認のみ）

このタスクは投稿はせず、生成だけを行って目視確認する。

- [ ] **Step 1: morning スロットで 5本生成**

```powershell
node generate-tweets.js --type=mixed --count=5 --slot=morning
```

確認項目（生成された5本それぞれについて）:

- [ ] 時刻表現（`○時` `○:○○`）が **一切** 出ていない（「朝7時」「22時」「7:11」等もNG）
- [ ] 人数の数字（`2000人` 等）が出ていない
- [ ] 売上の数字（`月商○万` 等）が出ていない
- [ ] 「30分で」「2時間後」のような時間軸数字が出ていない
- [ ] 曜日に言及するなら **実行日と一致**（例: 実行日が日曜日なら「日曜の朝」等、月曜・他の曜日に言及していない）
- [ ] **グミ・モンスター が一切出ていない**
- [ ] 最後の1〜2行が明るく前向き（「疲れた」「限界」「これでいいのかな」「やめたい」等で終わっていない）
- [ ] ハッシュタグは `#ORIMAMA` の1個のみ

- [ ] **Step 2: evening スロットで 5本生成**

```powershell
node generate-tweets.js --type=mixed --count=5 --slot=evening
```

Step 1 と同じ確認項目を再度チェック。

- [ ] **Step 3: 違反があった場合の対処**

もし違反する投稿が混ざっていた場合：

- 1〜2本程度の混入なら、`pickBest` の `violatesTimeAxis` フィルタで除外されるので本番運用上は問題ない（記録して次回プロンプト調整の材料に）
- 5本中3本以上が違反する場合、SYSTEM_PROMPT のルール表現を強化する必要あり。Task 5 の Step 3〜5 を見直して再編集

- [ ] **Step 4: posts/drafts.json をユーザーに確認してもらう**

生成された 10本（morning 5本 + evening 5本）が `posts/drafts.json` に保存されている。ユーザーに見てもらい、納得感（明るさ、本人らしさ、ブランド適合）を確認。

- [ ] **Step 5: GitHub Actions へ push**

問題なければ：

```powershell
git push origin main
```

- [ ] **Step 6: 次回自動投稿の本文確認**

push 後、次の自動投稿（朝8時 or 夜21時）の本文をX上で確認。

- [ ] 時刻・モチーフ・暗い締めの問題が出ていないこと
- [ ] 曜日整合性に問題ないこと

問題があれば Task 5 の Step 3〜5 でプロンプトを追加調整する。

---

## 完了条件

- [ ] Task 1〜7 すべてのコードが本番ブランチにマージされている
- [ ] Task 8 の手動検証で 10本中 8本以上が全ルールを満たしている
- [ ] 次回の自動投稿（push 後初回）で時刻・モチーフ・暗い締めのどれかが事故っていない
