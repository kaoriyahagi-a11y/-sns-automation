// アナリティクス集計・レポートサービス
import chalk from 'chalk';
import { getAnalytics as twitterAnalytics, getFollowerCount as twitterFollowers } from '../platforms/twitter.js';
import { getAnalytics as instagramAnalytics, getFollowerCount as instagramFollowers } from '../platforms/instagram.js';
import { getAnalytics as tiktokAnalytics, getUserInfo as tiktokUser } from '../platforms/tiktok.js';
import { generateAnalyticsAdvice } from './contentGenerator.js';
import { logger } from '../utils/logger.js';
import config from '../config/config.js';

/**
 * 全プラットフォームのアナリティクスを取得してレポートを生成する
 * @param {string[]} platforms - 対象プラットフォーム
 * @param {boolean} aiAdvice - Claude AIアドバイスを含めるか
 */
export async function generateReport(platforms = ['twitter', 'instagram', 'tiktok'], aiAdvice = false) {
  logger.header('📊 SNS アナリティクスレポート');

  const results = {};
  const errors = {};

  // 各プラットフォームのデータを並行取得
  const fetchTasks = [];

  if (platforms.includes('twitter') && config.twitter.apiKey) {
    fetchTasks.push(
      twitterAnalytics(10)
        .then((data) => { results.twitter = data; })
        .catch((err) => { errors.twitter = err.message; })
    );
  }

  if (platforms.includes('instagram') && config.instagram.accessToken) {
    fetchTasks.push(
      instagramAnalytics(10)
        .then((data) => { results.instagram = data; })
        .catch((err) => { errors.instagram = err.message; })
    );
  }

  if (platforms.includes('tiktok') && config.tiktok.accessToken) {
    fetchTasks.push(
      tiktokAnalytics()
        .then((data) => { results.tiktok = data; })
        .catch((err) => { errors.tiktok = err.message; })
    );
  }

  await Promise.all(fetchTasks);

  // レポートを表示
  printReport(results, errors);

  // Claude AIアドバイスを生成
  if (aiAdvice && Object.keys(results).length > 0) {
    logger.header('🤖 Claude AI 改善アドバイス');
    try {
      const advice = await generateAnalyticsAdvice(results);
      console.log(chalk.white(advice));
    } catch (err) {
      logger.error(`AIアドバイス生成失敗: ${err.message}`);
    }
  }

  return { results, errors };
}

/**
 * レポートをコンソールに表示する
 */
function printReport(results, errors) {
  // エラーを表示
  for (const [platform, msg] of Object.entries(errors)) {
    console.log(chalk.red(`  ${platform}: ❌ ${msg}`));
  }

  // 各プラットフォームのデータを表示
  for (const [platform, data] of Object.entries(results)) {
    const icon = platform === 'twitter' ? '𝕏' : platform === 'instagram' ? '📸' : '🎵';
    console.log('');
    console.log(chalk.bold.white(`  ${icon} ${platform.toUpperCase()}`));
    console.log(chalk.gray('  ─'.repeat(30)));

    if (data.note) {
      console.log(chalk.yellow(`  ⚠️  ${data.note}`));
      continue;
    }

    // 共通指標
    if (data.totalTweets !== undefined) {
      console.log(chalk.cyan(`  投稿数: ${data.totalTweets}`));
    }
    if (data.totalPosts !== undefined) {
      console.log(chalk.cyan(`  投稿数: ${data.totalPosts}`));
    }
    if (data.totalVideos !== undefined) {
      console.log(chalk.cyan(`  動画数: ${data.totalVideos}`));
    }

    // エンゲージメント
    const t = data.totals;
    if (t) {
      const rows = [];
      if (t.impressions) rows.push(`インプレッション: ${t.impressions.toLocaleString()}`);
      if (t.likes !== undefined) rows.push(`いいね: ${t.likes.toLocaleString()}`);
      if (t.retweets !== undefined) rows.push(`リポスト: ${t.retweets.toLocaleString()}`);
      if (t.replies !== undefined) rows.push(`返信: ${t.replies.toLocaleString()}`);
      if (t.comments !== undefined) rows.push(`コメント: ${t.comments.toLocaleString()}`);
      if (t.views !== undefined) rows.push(`視聴回数: ${t.views.toLocaleString()}`);
      if (t.shares !== undefined) rows.push(`シェア: ${t.shares.toLocaleString()}`);

      for (const row of rows) {
        console.log(chalk.green(`  ✅ ${row}`));
      }
    }

    if (data.averageEngagement !== undefined) {
      console.log(chalk.yellow(`  平均エンゲージメント: ${data.averageEngagement}`));
    }
    if (data.averageViews !== undefined) {
      console.log(chalk.yellow(`  平均視聴回数: ${data.averageViews.toLocaleString()}`));
    }

    // トップ投稿
    if (data.topTweet) {
      console.log(chalk.magenta(`  🏆 トップツイート: "${data.topTweet.text?.slice(0, 40)}..."`));
    }
  }

  console.log('');
  logger.divider();
}

/**
 * フォロワー数サマリーを取得する
 */
export async function getFollowerSummary(platforms = ['twitter', 'instagram', 'tiktok']) {
  logger.header('👥 フォロワー数サマリー');

  const tasks = [];

  if (platforms.includes('twitter') && config.twitter.apiKey) {
    tasks.push(
      twitterFollowers()
        .then((count) => ({ platform: 'X (Twitter)', count }))
        .catch(() => ({ platform: 'X (Twitter)', count: 'エラー' }))
    );
  }

  if (platforms.includes('instagram') && config.instagram.accessToken) {
    tasks.push(
      instagramFollowers()
        .then((count) => ({ platform: 'Instagram', count }))
        .catch(() => ({ platform: 'Instagram', count: 'エラー' }))
    );
  }

  if (platforms.includes('tiktok') && config.tiktok.accessToken) {
    tasks.push(
      tiktokUser()
        .then((user) => ({ platform: 'TikTok', count: user?.follower_count || 0 }))
        .catch(() => ({ platform: 'TikTok', count: 'エラー' }))
    );
  }

  const results = await Promise.all(tasks);

  for (const r of results) {
    const countStr = typeof r.count === 'number' ? r.count.toLocaleString() + ' 人' : r.count;
    console.log(chalk.cyan(`  ${r.platform}: ${countStr}`));
  }

  return results;
}
