// Claude APIを使ったコンテンツ生成サービス
import Anthropic from '@anthropic-ai/sdk';
import config, { PLATFORM_CONFIG } from '../config/config.js';
import { logger } from '../utils/logger.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

/**
 * プラットフォーム別の最適化されたSNS投稿文を生成する
 * @param {Object} options
 * @param {string} options.topic - 投稿テーマ・トピック
 * @param {string[]} options.platforms - 対象プラットフォーム配列 ['twitter','instagram','tiktok']
 * @param {string} options.tone - トーン ('casual'|'professional'|'fun'|'informative')
 * @param {string} options.industry - 業種・ジャンル（任意）
 * @param {string} options.goal - 目的 ('engagement'|'followers'|'sales'|'awareness')
 * @returns {Object} プラットフォームごとの生成コンテンツ
 */
export async function generateContent({ topic, platforms, tone = 'casual', industry = '', goal = 'engagement' }) {
  logger.ai('Claude AIがコンテンツを生成中...');

  const platformDetails = platforms.map((p) => {
    const cfg = PLATFORM_CONFIG[p];
    return `- ${cfg.name}: 最大${cfg.maxChars}文字、推奨ハッシュタグ${cfg.recommendedHashtags}個`;
  }).join('\n');

  const prompt = `あなたはSNSマーケティングの専門家です。以下の条件でSNS投稿文を生成してください。

【投稿テーマ】
${topic}

【対象プラットフォームと制約】
${platformDetails}

【投稿のトーン】
${tone === 'casual' ? 'カジュアル・親しみやすい' :
  tone === 'professional' ? 'プロフェッショナル・信頼感のある' :
  tone === 'fun' ? '楽しい・エンタメ寄り' : '情報提供型・分かりやすい'}

${industry ? `【業種・ジャンル】\n${industry}\n` : ''}
【投稿の目的】
${goal === 'engagement' ? 'エンゲージメント（いいね・コメント・シェア）増加' :
  goal === 'followers' ? 'フォロワー獲得' :
  goal === 'sales' ? '商品・サービスの販売促進' : 'ブランド認知度向上'}

以下のJSON形式で各プラットフォーム向けのコンテンツを返してください：

\`\`\`json
{
  "twitter": {
    "text": "投稿本文（280文字以内）",
    "hashtags": ["ハッシュタグ1", "ハッシュタグ2"],
    "callToAction": "CTAテキスト",
    "optimalTime": "最適投稿時間の理由"
  },
  "instagram": {
    "text": "投稿本文（2200文字以内、改行・絵文字を効果的に使う）",
    "hashtags": ["タグ1", "タグ2", "...（最大15個）"],
    "callToAction": "CTAテキスト",
    "optimalTime": "最適投稿時間の理由"
  },
  "tiktok": {
    "text": "動画の説明文（2200文字以内）",
    "hashtags": ["タグ1", "タグ2", "タグ3"],
    "videoIdeas": ["動画アイデア1", "動画アイデア2"],
    "callToAction": "CTAテキスト",
    "optimalTime": "最適投稿時間の理由"
  }
}
\`\`\`

対象プラットフォームのみ含めてください。フォロワーが思わずエンゲージしたくなる、魅力的なコンテンツを作成してください。`;

  try {
    const stream = client.messages.stream({
      model: config.anthropic.model,
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
    });

    let fullText = '';
    process.stdout.write(chalk_placeholder('🤖 生成中: '));

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullText += event.delta.text;
        process.stdout.write('.');
      }
    }
    console.log(' 完了\n');

    // JSONを抽出してパース
    const jsonMatch = fullText.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      throw new Error('JSONレスポンスの解析に失敗しました');
    }

    const result = JSON.parse(jsonMatch[1]);

    // 指定プラットフォームのみ返す
    const filtered = {};
    for (const p of platforms) {
      if (result[p]) {
        filtered[p] = result[p];
      }
    }

    logger.success('コンテンツ生成完了');
    return filtered;
  } catch (err) {
    logger.error(`コンテンツ生成失敗: ${err.message}`);
    throw err;
  }
}

/**
 * 投稿パフォーマンスを分析してアドバイスを生成する
 * @param {Object} analyticsData - 各プラットフォームのアナリティクスデータ
 * @returns {string} 改善アドバイス
 */
export async function generateAnalyticsAdvice(analyticsData) {
  logger.ai('アナリティクスを分析してアドバイスを生成中...');

  const prompt = `SNSマーケターとして、以下のアナリティクスデータを分析し、フォロワー増加と エンゲージメント向上のための具体的なアドバイスを日本語で提供してください。

【アナリティクスデータ】
${JSON.stringify(analyticsData, null, 2)}

以下の観点で分析してください：
1. 高パフォーマンス投稿の共通点
2. 改善が必要な点
3. 次の1週間で試すべき施策（具体的に3つ）
4. 最適な投稿時間・頻度の推奨

分かりやすく、実践的なアドバイスをお願いします。`;

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content.find((b) => b.type === 'text')?.text || '';
}

// ストリーミング中のchalkの代替（importが非同期のため）
function chalk_placeholder(text) {
  return text;
}
