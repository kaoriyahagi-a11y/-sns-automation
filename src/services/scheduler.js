// 投稿スケジューラー（node-cron + JSONキュー）
import cron from 'node-cron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import config from '../config/config.js';
import { logger } from '../utils/logger.js';
import { postTweet } from '../platforms/twitter.js';
import { postPhoto } from '../platforms/instagram.js';
import { postVideo } from '../platforms/tiktok.js';

/**
 * キューファイルを読み込む
 * @returns {Object[]} スケジュール済み投稿リスト
 */
function loadQueue() {
  const { queueFile, postsDir } = config.app;

  if (!existsSync(postsDir)) {
    mkdirSync(postsDir, { recursive: true });
  }

  if (!existsSync(queueFile)) {
    writeFileSync(queueFile, JSON.stringify([], null, 2));
    return [];
  }

  return JSON.parse(readFileSync(queueFile, 'utf-8'));
}

/**
 * キューファイルに書き込む
 */
function saveQueue(queue) {
  const { queueFile } = config.app;
  writeFileSync(queueFile, JSON.stringify(queue, null, 2));
}

/**
 * 投稿をキューに追加する
 * @param {Object} post
 * @param {string} post.platform - 'twitter'|'instagram'|'tiktok'
 * @param {string} post.text - 投稿テキスト
 * @param {string[]} post.hashtags - ハッシュタグ
 * @param {string} post.scheduledAt - ISO 8601形式の予定日時
 * @param {string} [post.imageUrl] - Instagram用画像URL
 * @param {string} [post.videoPath] - TikTok用動画パス
 * @returns {string} 投稿ID
 */
export function schedulePost(post) {
  const queue = loadQueue();

  const id = `post_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const newPost = {
    id,
    ...post,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  queue.push(newPost);
  saveQueue(queue);

  logger.success(`投稿をスケジュール追加しました [${id}]`);
  logger.info(`予定日時: ${new Date(post.scheduledAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

  return id;
}

/**
 * スケジュール済み投稿の一覧を取得する
 * @param {string} status - フィルター ('pending'|'posted'|'failed'|'all')
 */
export function getScheduledPosts(status = 'pending') {
  const queue = loadQueue();
  if (status === 'all') return queue;
  return queue.filter((p) => p.status === status);
}

/**
 * スケジュール済み投稿を削除する
 */
export function removePost(id) {
  const queue = loadQueue();
  const filtered = queue.filter((p) => p.id !== id);
  saveQueue(filtered);
  logger.success(`投稿 [${id}] を削除しました`);
}

/**
 * 実際に投稿を実行する
 */
async function executePost(post) {
  const queue = loadQueue();
  const idx = queue.findIndex((p) => p.id === post.id);

  try {
    let result;

    switch (post.platform) {
      case 'twitter':
        result = await postTweet(post.text, post.hashtags);
        break;

      case 'instagram':
        if (!post.imageUrl) {
          throw new Error('Instagram投稿には画像URLが必要です');
        }
        result = await postPhoto(post.text, post.hashtags, post.imageUrl);
        break;

      case 'tiktok':
        result = await postVideo({
          videoPath: post.videoPath,
          caption: post.text,
          hashtags: post.hashtags,
        });
        break;

      default:
        throw new Error(`未対応のプラットフォーム: ${post.platform}`);
    }

    // ステータスを更新
    if (idx !== -1) {
      queue[idx].status = 'posted';
      queue[idx].postedAt = new Date().toISOString();
      queue[idx].result = result;
      saveQueue(queue);
    }

    logger.success(`[${post.platform}] 投稿完了`);
    return result;
  } catch (err) {
    // エラーを記録
    if (idx !== -1) {
      queue[idx].status = 'failed';
      queue[idx].error = err.message;
      queue[idx].failedAt = new Date().toISOString();
      saveQueue(queue);
    }

    logger.error(`[${post.platform}] 投稿失敗: ${err.message}`);
    throw err;
  }
}

/**
 * スケジューラーを起動する（1分ごとにキューをチェック）
 */
export function startScheduler() {
  logger.info('スケジューラーを起動しました（1分ごとにキューをチェック）');
  logger.info('Ctrl+C で停止');

  // 毎分0秒に実行
  cron.schedule('* * * * *', async () => {
    const queue = loadQueue();
    const now = new Date();

    // 実行すべき投稿を抽出
    const duePost = queue.filter(
      (p) => p.status === 'pending' && new Date(p.scheduledAt) <= now
    );

    if (duePost.length === 0) return;

    logger.info(`${duePost.length}件の投稿を実行します`);

    for (const post of duePost) {
      try {
        await executePost(post);
      } catch {
        // エラーはexecutePost内でログ済み
      }
    }
  });

  // 毎日のサマリーを出力（午前9時）
  cron.schedule('0 9 * * *', () => {
    const queue = loadQueue();
    const pending = queue.filter((p) => p.status === 'pending').length;
    const posted = queue.filter((p) => p.status === 'posted').length;
    logger.info(`📅 デイリーサマリー: 予定中 ${pending}件 / 投稿済 ${posted}件`);
  });
}

/**
 * 今すぐ指定の投稿を実行する
 */
export async function executeNow(postId) {
  const queue = loadQueue();
  const post = queue.find((p) => p.id === postId);

  if (!post) {
    throw new Error(`投稿ID [${postId}] が見つかりません`);
  }

  return executePost(post);
}
