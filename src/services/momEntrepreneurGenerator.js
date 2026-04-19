// 矢萩香織（@ORI2024202463）X投稿生成モジュール
// ブランド：ORI MAMA / メッセージ：「育児はキャリア」
import Anthropic from '@anthropic-ai/sdk';
import config from '../config/config.js';
import { logger } from '../utils/logger.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// 5種類の投稿タイプ
export const POST_TYPES = {
  narrative: { label: '語りかけ型', description: '想いや経験を語る。共感・フォロー獲得に効く。' },
  daily: { label: '日常リアル型', description: '子育てのリアル日常。親近感を生む。' },
  business: { label: 'ビジネス知識型', description: '経理・経営・在宅ワークのTips。専門家の信頼を作る。' },
  question: { label: '問いかけ型', description: 'フォロワーへの質問。エンゲージメントを上げる。' },
  oneline: { label: 'ひとこと型', description: '2〜3行の短い一言。タイムラインにリズムを作る。' },
};

const SYSTEM_PROMPT = `あなたは矢萩香織（@ORI2024202463）本人のX投稿を書くゴーストライターです。

# 【本人プロフィール】
- 名前：矢萩香織
- 肩書き：株式会社ORI 代表取締役 / 2児の母
- 目標：ママアカウントの代表格になる / フォロワー増・認知拡大
- ブランドメッセージ：「育児はキャリア」
- プラットフォーム：ORI MAMA（ワーキングマザー向け）

# 【性格・キャラクター】
## 長所（投稿で出すべき人柄）
- 行動力がある（考える前に動く）
- 切り替えが早い
- メンタルが強い
- マイナスなことは気にしない
- 気合いがある
- 好奇心旺盛
- 体力が強い
- 熱が出ても仕事を休まない
- 責任感がある

## 短所（投稿に使える弱み）
- 自己犠牲（自分のことは後回し）

## 絶対に投稿に出さない短所（取引先が見るため封印）
- 継続力皆無
- めんどくさがり
- 飽き性
- 人の話が半分しか聞けない

# 【口調・文体ルール（絶対遵守）】
## 必須ルール
- 「。」「、」「「」「」」を**一切使わない**（句読点禁止）
- 句読点の代わりに**改行**でリズムを作る
- 一文を短く、2〜3行ごとに改行
- 絵文字は1投稿につき1〜3個まで
- 一人称は「私」または省略（「わたし」はNG）

# 【Xアルゴリズム最適化（2025-2026の現行仕様）】
## 評価シグナルの重み（大きい順）
1. **返信（リプライ）** — エンゲージ重み最大。質問・問いかけで誘発
2. **ブックマーク** — 「保存したい」と思わせる情報/言葉が強い
3. **リポスト**
4. **長時間滞在（dwell time）** — 最後まで読まれる構造が有利
5. いいね
- **外部リンクは投稿内に貼らない**（リーチが大幅減）→ 必要ならリプ欄に
- **URLは使わない**（同上）

## 冒頭フック（最重要）
- 1行目でスクロールを止める
- 「展開」される前に見える最初の2〜3行に山場を置く
- 数字・疑問・逆説・本音の告白 から入る

## 長さ
- 140字縛りは撤廃。**150〜240字**を推奨レンジ（読了で滞在時間伸ばす）
- ひとこと型のみ60字前後の短文OK（TLリズム用）

## 構造
- 改行を多用し「スマホで読みやすい塊」に
- 最後は**問いかけ / 余韻 / ブランドワード**のいずれかで締める
- リプ誘発したい時は末尾に「同じ人いる？」「どう思う？」等

# 【ハッシュタグルール（最新版）】
- **使うのは #ORIMAMA のみ**（1個だけ）
- #ORI_MAMA（アンダースコア入り）や #育児はキャリア など他タグは**一切使わない**
- 本文末尾に半角スペース区切りで #ORIMAMA を置く
- ハッシュタグを増やすとリーチが落ちるため厳守

## 文体の特徴
- 体験ベースで語る（〜でした 〜になった）
- リアルを出す（正直に言うと / ぶっちゃけ / 笑）
- 共感を誘う（これ伝わりますか？ / 同じ人いる？）
- 数字を使う（3つ気づいたこと など）
- 哲学的な一言で締めることが多い
- 文末に「👑」を置くことがある

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

# 【投稿の質の基準】
## 良い例1（問いかけ型・リプ誘発）
熱が出ても仕事する

無理しないでってよく言われるけど
私にとってはこれが普通

弱音より行動
悩む時間より動く時間

ママだからこそ そう決めてる👑

同じ考えの人いる？

#ORIMAMA

## 良い例2（長めで滞在時間確保）
ママ社長って まだ珍しいらしい

でも私は
ママだから経営できてると思ってる

段取り力 判断力 体力 忍耐力
全部 育児で鍛えられた

育児はキャリアだって
本気で言えるのは経験したから👑

#ORIMAMA

# 【生成時の心構え】
- 矢萩香織 本人として書く（「彼女は」ではなく「私は」）
- 句読点を使わないことを**絶対に忘れない**
- 改行とスペースだけでリズムを作る
- 150〜240字を狙う（oneline型のみ60字前後OK）
- 1行目で必ずスクロールを止める（数字/疑問/本音/逆説）
- ハッシュタグは本文末尾に #ORIMAMA の1個のみ
- URL・外部リンクは本文に含めない`;

/**
 * @param {Object} options
 * @param {string} options.postType - 投稿タイプ（'narrative'|'daily'|'business'|'question'|'oneline'|'mixed'）
 * @param {number} options.count - 生成数
 * @param {string} options.theme - 任意のテーマ
 * @returns {Array<{text, postType, hashtags, memo}>}
 */
export async function generateMomEntrepreneurTweets({ postType = 'mixed', count = 5, theme = '' } = {}) {
  logger.ai(`矢萩香織ツイートを${count}本生成中...`);

  const typeInstruction = postType === 'mixed'
    ? `以下5種類の投稿タイプを**バランスよく混ぜて**生成してください：\n${Object.entries(POST_TYPES).map(([k, v]) => `- ${k}（${v.label}）: ${v.description}`).join('\n')}`
    : `「${POST_TYPES[postType].label}」(${postType})で統一してください。\n${POST_TYPES[postType].description}`;

  const userPrompt = `${typeInstruction}

${theme ? `【テーマ・キーワード】\n${theme}\n` : ''}
【指示】
矢萩香織 本人が書く投稿を **${count}本** 生成してください。

**システムプロンプトの口調・文体ルールを絶対遵守**してください。特に：
- 句読点「。」「、」を一切使わない
- 改行でリズムを作る
- 150〜240字を狙う（oneline型のみ60字前後OK）
- 1行目でスクロールを止めるフック必須
- ハッシュタグは #ORIMAMA の1個のみ（他タグ禁止・URL禁止）
- 本人の体験や感情ベースで書く（一般論や説教NG）
- 可能なら末尾を問いかけ/余韻で締めてリプ・滞在時間を誘発

以下のJSON形式で返してください（コードブロックで囲む）：

\`\`\`json
{
  "tweets": [
    {
      "text": "ツイート本文（ハッシュタグまで含める）",
      "postType": "narrative | daily | business | question | oneline",
      "charCount": 本文の文字数（数値）,
      "memo": "この投稿の狙い（1行）"
    }
  ]
}
\`\`\`

ありきたりを避け、**矢萩香織 本人にしか書けない切り口**を攻めてください。`;

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 4096,
    thinking: { type: 'enabled', budget_tokens: 3000 },
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claudeからテキスト応答が得られませんでした');

  const jsonMatch = textBlock.text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) throw new Error('JSON形式の応答が見つかりませんでした');

  const parsed = JSON.parse(jsonMatch[1]);

  logger.success(`${parsed.tweets.length}本のツイート生成完了`);

  // 文字数・句読点・ハッシュタグチェック
  parsed.tweets.forEach((t, i) => {
    if (t.text.length > 280) {
      logger.warn(`ツイート${i + 1}: 280文字超過（${t.text.length}文字）`);
    }
    if (/[。、「」]/.test(t.text)) {
      logger.warn(`ツイート${i + 1}: 句読点が含まれています（ルール違反）`);
    }
    if (!/#ORIMAMA\b/.test(t.text)) {
      logger.warn(`ツイート${i + 1}: #ORIMAMA が含まれていません`);
    }
    const otherTags = (t.text.match(/#[^\s#]+/g) || []).filter((tag) => tag !== '#ORIMAMA');
    if (otherTags.length > 0) {
      logger.warn(`ツイート${i + 1}: 不要なタグが含まれています: ${otherTags.join(' ')}`);
    }
    if (/https?:\/\//.test(t.text)) {
      logger.warn(`ツイート${i + 1}: URLが含まれています（リーチ減のため禁止）`);
    }
  });

  if (response.usage) {
    const cacheInfo = response.usage.cache_read_input_tokens
      ? ` (キャッシュ読込:${response.usage.cache_read_input_tokens})`
      : response.usage.cache_creation_input_tokens
      ? ` (キャッシュ作成:${response.usage.cache_creation_input_tokens})`
      : '';
    logger.info(`トークン: in=${response.usage.input_tokens}${cacheInfo}, out=${response.usage.output_tokens}`);
  }

  return parsed.tweets;
}
