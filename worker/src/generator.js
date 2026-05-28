// Claude API (Anthropic) を fetch で直接叩く実装
// プロンプトキャッシュで長いシステムプロンプトのコストを圧縮
import { SYSTEM_PROMPT, POST_TYPES } from './prompt.js';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// 直近の投稿テキストから、月1回までに抑えたいモチーフのうち**既に使われたもの**を抽出
const MOTIF_PATTERNS = [
  { key: 'グミ', re: /グミ/ },
  { key: 'モンスター', re: /モンスター|monster/i },
  { key: 'カフェラテ', re: /カフェラテ/ },
  { key: 'ルイボスティー', re: /ルイボスティー|ルイボス/ },
];

function detectUsedMotifs(recentTweets) {
  const used = new Set();
  for (const t of recentTweets) {
    for (const m of MOTIF_PATTERNS) {
      if (m.re.test(t)) used.add(m.key);
    }
  }
  return [...used];
}

/**
 * @param {Object} options
 * @param {'narrative'|'daily'|'business'|'question'|'oneline'} options.postType
 * @param {number} options.count
 * @param {string} options.theme
 * @param {string[]} [options.recentTweets] 直近の投稿テキスト（重複回避用）
 * @param {string} [options.postingTime] 投稿される時刻（JST、"YYYY-MM-DD HH:MM" 形式）
 * @param {string} [options.postingDow] 投稿される曜日（例: "水曜日"）
 * @param {{ANTHROPIC_API_KEY: string}} env
 * @returns {Promise<Array<{text: string, postType: string, memo: string, charCount: number}>>}
 */
export async function generateTweets({ postType, count = 5, theme = '', recentTweets = [], postingTime = null, postingDow = null }, env) {
  const typeMeta = POST_TYPES[postType];
  const typeInstruction = `「${typeMeta.label}」(${postType})で統一してください。\n${typeMeta.description}`;

  const dowBlock = postingDow
    ? `

【曜日整合性（絶対遵守）】
この投稿が公開される曜日: **${postingDow}**
- 「月曜の朝」「金曜だから」など**曜日を口にするなら必ず ${postingDow} に合わせる**
- 合わせられないなら**曜日を言わない**（「今日」「朝」「夜」など曜日不問の表現にする）
`
    : '';

  const timingBlock = postingTime
    ? `

【投稿タイミング（時刻矛盾防止・最重要）】
この投稿が公開される時刻: **${postingTime} JST**

- この時刻より**未来の時刻を「〜だった」など過去形で書かない**
  例：21:00投稿で「夜23時超えた」「23時半まで残業した」はNG（その時刻はまだ来ていない＝矛盾）
- 過去の時刻を書く場合は、必ず**この時刻より前の時刻**にする
- 息子の寝かしつけは通常**22時頃**。投稿時刻が22時より前なら「寝かしつけ後」を過去形で書くのはNG
- **「7:42」「8:03」「7時11分」など分刻みの具体時刻は絶対に書かない**（本人はそんな時刻を覚えていない＝AI感の元）
- 時刻を入れずに「朝」「お昼」「夜」「さっき」「今日」など**曖昧表現でも人間味は出る**（むしろこちらが推奨）
`
    : '';

  const usedMotifs = detectUsedMotifs(recentTweets);
  const motifBlock = usedMotifs.length > 0
    ? `

【モチーフ濫用防止（絶対遵守）】
以下のモチーフは**直近の投稿で既に使われている**ため、今回の投稿には**1単語も登場させない**こと：
${usedMotifs.map((m) => `- ${m}`).join('\n')}
（同じ理由で「モンスター3本目」「グミ2袋」など回数・個数の盛りも禁止。ディテールはシーン・行動・感情で出す）
`
    : `

【モチーフの扱い】
「グミ」「モンスター」「カフェラテ」「ルイボスティー」は**月1回まで**しか出せない。今回出すなら1つだけ・1箇所だけ。複数モチーフの同居や回数盛り（「3本目」「2袋」）は禁止。
`;

  const recentBlock = recentTweets.length > 0
    ? `

【直近の投稿（重複・類似禁止）】
以下は最近実際に投稿した内容です。
**Twitter重複検知に引っかかるため、これらと類似した切り口・フック・締め方は絶対に避けてください**。
全く違うテーマ・違う表現・違う構造で書くこと。

${recentTweets.map((t, i) => `--- 投稿${i + 1} ---\n${t}`).join('\n\n')}
--- 履歴ここまで ---
`
    : '';

  const userPrompt = `${typeInstruction}

${theme ? `【テーマ・キーワード】\n${theme}\n` : ''}${dowBlock}${timingBlock}${motifBlock}${recentBlock}
【指示】
矢萩香織 本人が書く投稿を **${count}本** 生成してください。

**システムプロンプトの口調・文体ルールを絶対遵守**してください。特に：
- 句読点「。」「、」を一切使わない
- 改行でリズムを作る
- 120〜220字を狙う（oneline型のみ60〜90字OK）
- 1行目でスクロールを止めるフック必須（**分刻み時刻は使わない**。粗い時間帯・疑問・本音・具体シーンで止める）
- 絵文字は0〜3個。無しもアリ。連打（💪🏻✨🙌）は絶対NG
- **「正直に言うと」「ぶっちゃけ」「同じ人いる？」「共感してくれる人いる？」は絶対禁止**
- ハッシュタグ#ORIMAMAは任意（3-4本に1本程度、無しがデフォルト）
- 本人の体験や感情ベースで書く（一般論や説教NG）
- **${count}本のうち約8割は明るくポジティブな締め**（「明日も全力でいく✨」「やっぱり仕事好きだわ」など）。2割だけ弱音・余韻OK
- **LINEの未読／タスク数など「少ない数字」は書かない**（本人の実態は500件超）
- **フォロワー増加視点**: プロフを見たくなる一貫性と本音を出す

ありきたりを避け、**矢萩香織 本人にしか書けない切り口**を攻めてください。
直近の投稿とは全く違うアプローチで、毎回新鮮な内容にすること。`;

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      thinking: { type: 'disabled' },
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPrompt }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              tweets: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    postType: {
                      type: 'string',
                      enum: ['narrative', 'daily', 'business', 'question', 'oneline'],
                    },
                    charCount: { type: 'integer' },
                    memo: { type: 'string' },
                  },
                  required: ['text', 'postType', 'charCount', 'memo'],
                  additionalProperties: false,
                },
              },
            },
            required: ['tweets'],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b) => b.type === 'text');
  if (!textBlock) {
    console.error('[anthropic] textブロック無し / stop_reason=' + data.stop_reason);
    console.error('[anthropic] content blocks=' + JSON.stringify(data.content?.map((b) => ({ type: b.type, len: b.text?.length || b.thinking?.length || 0 }))));
    throw new Error(`Claudeからテキスト応答が得られませんでした (stop_reason=${data.stop_reason})`);
  }

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (e) {
    console.error('[anthropic] JSON parse失敗。textBlock冒頭500字: ' + textBlock.text.slice(0, 500));
    throw new Error(`JSON parse失敗: ${e.message}`);
  }

  const usage = data.usage || {};
  console.log(
    `[anthropic] tokens in=${usage.input_tokens} out=${usage.output_tokens} ` +
      `cache_read=${usage.cache_read_input_tokens || 0} cache_create=${usage.cache_creation_input_tokens || 0}`
  );

  return parsed.tweets;
}
