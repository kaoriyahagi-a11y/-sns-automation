// TikTok API プラットフォームモジュール
// 注意: Content Posting APIはTikTok Developerの審査が必要
// このモジュールはアナリティクスとコンテンツ準備に対応
import axios from 'axios';
import config from '../config/config.js';
import { logger } from '../utils/logger.js';

const BASE_URL = 'https://open.tiktokapis.com/v2';

/**
 * TikTok APIにリクエストを送る
 */
async function request(method, endpoint, data = {}) {
  const { accessToken } = config.tiktok;

  if (!accessToken) {
    throw new Error('TikTok APIの認証情報が設定されていません。.envファイルを確認してください。');
  }

  const response = await axios({
    method,
    url: `${BASE_URL}${endpoint}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    data: method !== 'GET' ? data : undefined,
    params: method === 'GET' ? data : undefined,
  });

  return response.data;
}

/**
 * TikTok動画を投稿する（Direct Post API - 審査が必要）
 * @param {Object} postData
 * @param {string} postData.videoPath - 動画ファイルパス
 * @param {string} postData.caption - キャプション
 * @param {string[]} postData.hashtags - ハッシュタグ
 */
export async function postVideo({ videoPath, caption, hashtags = [] }) {
  logger.warn('TikTok Direct Post APIは審査が必要です。');
  logger.info('コンテンツを準備してTikTokアプリから手動投稿してください。');

  const hashtagText = hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
  const fullCaption = hashtagText ? `${caption} ${hashtagText}` : caption;

  // 投稿準備情報を返す（手動投稿用）
  return {
    platform: 'tiktok',
    status: 'prepared',
    caption: fullCaption,
    videoPath,
    message: '以下のキャプションをコピーしてTikTokアプリから投稿してください',
    preparedAt: new Date().toISOString(),
  };
}

/**
 * TikTok動画投稿のリクエストを作成する（Direct Post API）
 * @param {string} caption - キャプション（ハッシュタグ含む）
 * @param {Object} videoInfo - 動画情報
 */
export async function initVideoPost(caption, videoInfo = {}) {
  try {
    const result = await request('POST', '/post/publish/video/init/', {
      post_info: {
        title: caption,
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 0,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoInfo.size || 0,
        chunk_size: videoInfo.chunkSize || 10000000,
        total_chunk_count: videoInfo.chunks || 1,
      },
    });

    logger.success('TikTok投稿リクエスト作成完了');
    return result;
  } catch (err) {
    logger.error(`TikTok投稿エラー: ${err.response?.data?.error?.message || err.message}`);
    logger.info('ヒント: Content Posting APIにアクセスするにはTikTok Developerコンソールで申請が必要です');
    throw err;
  }
}

/**
 * TikTokのアナリティクスを取得する
 * @param {string} startDate - 開始日 (YYYYMMDD)
 * @param {string} endDate - 終了日 (YYYYMMDD)
 */
export async function getAnalytics(startDate, endDate) {
  logger.analytics('TikTokのアナリティクスを取得中...');

  try {
    const result = await request('POST', '/research/video/query/', {
      filters: {
        create_date_range: {
          start_date: startDate || getDateString(-7),
          end_date: endDate || getDateString(0),
        },
      },
      fields: ['id', 'title', 'create_time', 'like_count', 'comment_count', 'share_count', 'view_count'],
      max_count: 20,
    });

    const videos = result.data?.videos || [];

    const totals = videos.reduce(
      (acc, v) => {
        acc.views += v.view_count || 0;
        acc.likes += v.like_count || 0;
        acc.comments += v.comment_count || 0;
        acc.shares += v.share_count || 0;
        return acc;
      },
      { views: 0, likes: 0, comments: 0, shares: 0 }
    );

    return {
      platform: 'tiktok',
      period: `${startDate || '7日前'} 〜 ${endDate || '今日'}`,
      totalVideos: videos.length,
      totals,
      averageViews: videos.length > 0 ? Math.round(totals.views / videos.length) : 0,
      videos: videos.map((v) => ({
        id: v.id,
        title: (v.title || '').slice(0, 50),
        views: v.view_count,
        likes: v.like_count,
        comments: v.comment_count,
        shares: v.share_count,
      })),
    };
  } catch (err) {
    logger.warn(`TikTokアナリティクス取得エラー: ${err.message}`);
    // モックデータを返す（APIアクセス権がない場合のデモ用）
    return {
      platform: 'tiktok',
      period: '直近7日間',
      note: 'APIアクセス権が必要です。TikTok Developerコンソールで設定してください。',
      totalVideos: 0,
      totals: { views: 0, likes: 0, comments: 0, shares: 0 },
    };
  }
}

/**
 * ユーザー情報を取得する
 */
export async function getUserInfo() {
  try {
    const result = await request('GET', '/user/info/', {
      fields: ['display_name', 'follower_count', 'following_count', 'likes_count', 'video_count'],
    });
    return result.data?.user || null;
  } catch (err) {
    logger.warn(`TikTokユーザー情報取得エラー: ${err.message}`);
    return null;
  }
}

// 日付文字列を生成するヘルパー
function getDateString(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
