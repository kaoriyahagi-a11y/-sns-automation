// X (Twitter) API v2 プラットフォームモジュール
import { TwitterApi } from 'twitter-api-v2';
import config from '../config/config.js';
import { logger } from '../utils/logger.js';

// Twitter APIクライアントを初期化する
function getClient() {
  const { apiKey, apiSecret, accessToken, accessTokenSecret } = config.twitter;

  if (!apiKey || !accessToken) {
    throw new Error('Twitter APIキーが設定されていません。.envファイルを確認してください。');
  }

  return new TwitterApi({
    appKey: apiKey,
    appSecret: apiSecret,
    accessToken: accessToken,
    accessSecret: accessTokenSecret,
  });
}

/**
 * ツイートを投稿する
 * @param {string} text - 投稿テキスト（280文字以内）
 * @param {string[]} hashtags - ハッシュタグ配列
 * @returns {Object} 投稿結果
 */
export async function postTweet(text, hashtags = []) {
  const client = getClient();
  const rwClient = client.readWrite;

  // ハッシュタグを本文に追加
  const hashtagText = hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
  const fullText = hashtagText ? `${text}\n\n${hashtagText}` : text;

  if (fullText.length > 280) {
    logger.warn(`ツイートが280文字を超えています（${fullText.length}文字）。切り詰めます。`);
  }

  logger.post('X (Twitter)', '投稿中...');

  const tweet = await rwClient.v2.tweet(fullText.slice(0, 280));

  logger.success(`ツイート投稿完了！ ID: ${tweet.data.id}`);
  return {
    id: tweet.data.id,
    text: tweet.data.text,
    url: `https://twitter.com/i/web/status/${tweet.data.id}`,
    platform: 'twitter',
    postedAt: new Date().toISOString(),
  };
}

/**
 * 自分のツイートのアナリティクスを取得する
 * @param {number} count - 取得するツイート数（最大100）
 * @returns {Object} アナリティクスデータ
 */
export async function getAnalytics(count = 10) {
  const client = getClient();

  logger.analytics('X (Twitter) のアナリティクスを取得中...');

  // 自分のユーザー情報を取得
  const me = await client.v2.me();
  const userId = me.data.id;

  // 最新ツイートを取得（エンゲージメント指標含む）
  const tweets = await client.v2.userTimeline(userId, {
    max_results: count,
    'tweet.fields': ['public_metrics', 'created_at', 'text'],
  });

  const tweetData = tweets.data?.data || [];

  // 集計
  const totals = tweetData.reduce(
    (acc, tweet) => {
      const m = tweet.public_metrics;
      acc.likes += m.like_count || 0;
      acc.retweets += m.retweet_count || 0;
      acc.replies += m.reply_count || 0;
      acc.impressions += m.impression_count || 0;
      return acc;
    },
    { likes: 0, retweets: 0, replies: 0, impressions: 0 }
  );

  const avgEngagement =
    tweetData.length > 0
      ? ((totals.likes + totals.retweets + totals.replies) / tweetData.length).toFixed(1)
      : 0;

  return {
    platform: 'twitter',
    period: `直近${tweetData.length}投稿`,
    totalTweets: tweetData.length,
    totals,
    averageEngagement: parseFloat(avgEngagement),
    topTweet: tweetData.sort(
      (a, b) =>
        (b.public_metrics.like_count + b.public_metrics.retweet_count) -
        (a.public_metrics.like_count + a.public_metrics.retweet_count)
    )[0] || null,
    tweets: tweetData.map((t) => ({
      id: t.id,
      text: t.text.slice(0, 50) + (t.text.length > 50 ? '...' : ''),
      metrics: t.public_metrics,
      createdAt: t.created_at,
    })),
  };
}

/**
 * フォロワー数を取得する
 * @returns {number} フォロワー数
 */
export async function getFollowerCount() {
  const client = getClient();
  const me = await client.v2.me({
    'user.fields': ['public_metrics'],
  });
  return me.data.public_metrics?.followers_count || 0;
}
