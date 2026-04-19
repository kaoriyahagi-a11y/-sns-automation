// Instagram Graph API プラットフォームモジュール
// 注意: Business/Creatorアカウントとアクセストークンが必要
import axios from 'axios';
import config from '../config/config.js';
import { logger } from '../utils/logger.js';

const BASE_URL = 'https://graph.instagram.com/v21.0';

/**
 * Instagram Graph APIにリクエストを送る
 */
async function request(method, endpoint, params = {}) {
  const { accessToken, userId } = config.instagram;

  if (!accessToken || !userId) {
    throw new Error('Instagram APIの認証情報が設定されていません。.envファイルを確認してください。');
  }

  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;

  const response = await axios({
    method,
    url,
    params: { access_token: accessToken, ...params },
    data: method !== 'GET' ? params : undefined,
  });

  return response.data;
}

/**
 * Instagram投稿を作成する（画像URL必須）
 * @param {string} caption - キャプション本文
 * @param {string[]} hashtags - ハッシュタグ配列
 * @param {string} imageUrl - 投稿する画像のURL（公開アクセス可能なURL）
 * @returns {Object} 投稿結果
 */
export async function postPhoto(caption, hashtags = [], imageUrl) {
  const { userId } = config.instagram;

  if (!imageUrl) {
    throw new Error('Instagram投稿には画像URLが必要です。');
  }

  // ハッシュタグをキャプションに追加
  const hashtagText = hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
  const fullCaption = hashtagText ? `${caption}\n\n${hashtagText}` : caption;

  logger.post('Instagram', 'メディアコンテナを作成中...');

  // Step 1: メディアコンテナを作成
  const container = await request('POST', `/${userId}/media`, {
    image_url: imageUrl,
    caption: fullCaption,
  });

  logger.post('Instagram', `コンテナID: ${container.id} - 公開中...`);

  // Step 2: コンテナを公開
  const result = await request('POST', `/${userId}/media_publish`, {
    creation_id: container.id,
  });

  logger.success(`Instagram投稿完了！ メディアID: ${result.id}`);
  return {
    id: result.id,
    url: `https://www.instagram.com/p/${result.id}/`,
    platform: 'instagram',
    postedAt: new Date().toISOString(),
  };
}

/**
 * カルーセル投稿（複数画像）を作成する
 * @param {string} caption - キャプション
 * @param {string[]} hashtags - ハッシュタグ
 * @param {string[]} imageUrls - 画像URLの配列（最大10枚）
 */
export async function postCarousel(caption, hashtags = [], imageUrls) {
  const { userId } = config.instagram;

  if (!imageUrls || imageUrls.length < 2) {
    throw new Error('カルーセル投稿には2枚以上の画像が必要です。');
  }

  logger.post('Instagram', `カルーセル（${imageUrls.length}枚）を作成中...`);

  // Step 1: 各画像のコンテナを作成
  const itemIds = [];
  for (const imgUrl of imageUrls.slice(0, 10)) {
    const item = await request('POST', `/${userId}/media`, {
      image_url: imgUrl,
      is_carousel_item: true,
    });
    itemIds.push(item.id);
  }

  const hashtagText = hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
  const fullCaption = hashtagText ? `${caption}\n\n${hashtagText}` : caption;

  // Step 2: カルーセルコンテナを作成
  const carousel = await request('POST', `/${userId}/media`, {
    media_type: 'CAROUSEL',
    caption: fullCaption,
    children: itemIds.join(','),
  });

  // Step 3: 公開
  const result = await request('POST', `/${userId}/media_publish`, {
    creation_id: carousel.id,
  });

  logger.success(`Instagramカルーセル投稿完了！ ID: ${result.id}`);
  return {
    id: result.id,
    platform: 'instagram',
    type: 'carousel',
    postedAt: new Date().toISOString(),
  };
}

/**
 * Instagram投稿のアナリティクスを取得する
 * @param {number} count - 取得するメディア数
 */
export async function getAnalytics(count = 10) {
  const { userId } = config.instagram;

  logger.analytics('Instagramのアナリティクスを取得中...');

  // 最新メディアを取得
  const mediaList = await request('GET', `/${userId}/media`, {
    fields: 'id,caption,media_type,timestamp,like_count,comments_count',
    limit: count,
  });

  const posts = mediaList.data || [];

  // 各投稿のインサイトを取得
  const postsWithInsights = [];
  for (const post of posts) {
    try {
      const insights = await request('GET', `/${post.id}/insights`, {
        metric: 'impressions,reach,engagement',
      });

      const metricsMap = {};
      for (const m of (insights.data || [])) {
        metricsMap[m.name] = m.values?.[0]?.value || 0;
      }

      postsWithInsights.push({
        id: post.id,
        caption: (post.caption || '').slice(0, 50) + '...',
        type: post.media_type,
        likes: post.like_count || 0,
        comments: post.comments_count || 0,
        impressions: metricsMap.impressions || 0,
        reach: metricsMap.reach || 0,
        engagement: metricsMap.engagement || 0,
        timestamp: post.timestamp,
      });
    } catch {
      postsWithInsights.push({
        id: post.id,
        likes: post.like_count || 0,
        comments: post.comments_count || 0,
      });
    }
  }

  const totals = postsWithInsights.reduce(
    (acc, p) => {
      acc.likes += p.likes;
      acc.comments += p.comments;
      acc.impressions += p.impressions || 0;
      return acc;
    },
    { likes: 0, comments: 0, impressions: 0 }
  );

  const avgEngagement =
    posts.length > 0
      ? ((totals.likes + totals.comments) / posts.length).toFixed(1)
      : 0;

  return {
    platform: 'instagram',
    period: `直近${posts.length}投稿`,
    totalPosts: posts.length,
    totals,
    averageEngagement: parseFloat(avgEngagement),
    posts: postsWithInsights,
  };
}

/**
 * フォロワー数を取得する
 */
export async function getFollowerCount() {
  const { userId } = config.instagram;
  const data = await request('GET', `/${userId}`, {
    fields: 'followers_count',
  });
  return data.followers_count || 0;
}
