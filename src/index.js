#!/usr/bin/env node
// SNS自動化ツール - メインエントリーポイント
import inquirer from 'inquirer';
import chalk from 'chalk';
import { generateContent } from './services/contentGenerator.js';
import { schedulePost, getScheduledPosts, startScheduler, executeNow, removePost } from './services/scheduler.js';
import { generateReport, getFollowerSummary } from './services/analytics.js';
import { postTweet } from './platforms/twitter.js';
import { postPhoto } from './platforms/instagram.js';
import { postVideo } from './platforms/tiktok.js';
import { logger } from './utils/logger.js';
import { PLATFORM_CONFIG, OPTIMAL_POSTING_TIMES } from './config/config.js';

// バナー表示
function showBanner() {
  console.log('');
  console.log(chalk.bold.cyan('╔══════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║   🚀  SNS 自動化ツール  v1.0.0              ║'));
  console.log(chalk.bold.cyan('║   X / Instagram / TikTok + Claude AI         ║'));
  console.log(chalk.bold.cyan('╚══════════════════════════════════════════════╝'));
  console.log('');
}

// メインメニュー
async function mainMenu() {
  showBanner();

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: '何をしますか？',
      choices: [
        { name: '🤖 コンテンツを生成する（Claude AI）', value: 'generate' },
        { name: '📤 今すぐ投稿する', value: 'post' },
        { name: '⏰ 投稿をスケジュールする', value: 'schedule' },
        { name: '📋 スケジュール一覧を見る', value: 'list' },
        { name: '📊 アナリティクスを確認する', value: 'analytics' },
        { name: '▶️  スケジューラーを起動する', value: 'run-scheduler' },
        { name: '❌ 終了', value: 'exit' },
      ],
    },
  ]);

  switch (action) {
    case 'generate':
      await handleGenerate();
      break;
    case 'post':
      await handlePost();
      break;
    case 'schedule':
      await handleSchedule();
      break;
    case 'list':
      await handleList();
      break;
    case 'analytics':
      await handleAnalytics();
      break;
    case 'run-scheduler':
      startScheduler();
      return; // スケジューラーは起動したまま
    case 'exit':
      console.log(chalk.gray('\nさようなら！👋\n'));
      process.exit(0);
  }

  // メニューに戻る
  await mainMenu();
}

// コンテンツ生成ハンドラー
async function handleGenerate() {
  logger.header('🤖 コンテンツ生成');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'topic',
      message: '投稿テーマを入力してください:',
      validate: (v) => v.trim() ? true : 'テーマを入力してください',
    },
    {
      type: 'checkbox',
      name: 'platforms',
      message: '対象プラットフォームを選択:',
      choices: [
        { name: '𝕏 X (Twitter)', value: 'twitter', checked: true },
        { name: '📸 Instagram', value: 'instagram', checked: true },
        { name: '🎵 TikTok', value: 'tiktok', checked: true },
      ],
      validate: (v) => v.length > 0 ? true : '最低1つ選択してください',
    },
    {
      type: 'list',
      name: 'tone',
      message: '投稿のトーン:',
      choices: [
        { name: 'カジュアル・親しみやすい', value: 'casual' },
        { name: 'プロフェッショナル・信頼感', value: 'professional' },
        { name: '楽しい・エンタメ', value: 'fun' },
        { name: '情報提供・教育的', value: 'informative' },
      ],
    },
    {
      type: 'list',
      name: 'goal',
      message: '投稿の目的:',
      choices: [
        { name: 'エンゲージメント増加（いいね・コメント）', value: 'engagement' },
        { name: 'フォロワー獲得', value: 'followers' },
        { name: '商品・サービスの販売促進', value: 'sales' },
        { name: 'ブランド認知度向上', value: 'awareness' },
      ],
    },
    {
      type: 'input',
      name: 'industry',
      message: '業種・ジャンル（任意、例: 飲食・IT・ファッション）:',
    },
  ]);

  const content = await generateContent(answers);

  // 生成結果を表示
  logger.header('✨ 生成されたコンテンツ');

  for (const [platform, data] of Object.entries(content)) {
    const cfg = PLATFORM_CONFIG[platform];
    console.log('');
    console.log(chalk.bold.white(`  ${cfg.emoji} ${cfg.name}`));
    console.log(chalk.gray('  ─'.repeat(40)));
    console.log(chalk.white(`  📝 本文:\n  ${data.text.replace(/\n/g, '\n  ')}`));
    console.log(chalk.cyan(`  #️⃣  ハッシュタグ: ${data.hashtags.map((h) => `#${h}`).join(' ')}`));
    console.log(chalk.yellow(`  📣 CTA: ${data.callToAction}`));
    if (data.videoIdeas) {
      console.log(chalk.magenta(`  🎬 動画アイデア: ${data.videoIdeas.join(' / ')}`));
    }
    console.log(chalk.green(`  ⏰ 最適時間: ${data.optimalTime}`));
  }

  // このまま投稿またはスケジュールするか聞く
  const { next } = await inquirer.prompt([
    {
      type: 'list',
      name: 'next',
      message: '次のアクション:',
      choices: [
        { name: '今すぐ投稿する', value: 'post' },
        { name: 'スケジュールに追加する', value: 'schedule' },
        { name: 'メニューに戻る', value: 'back' },
      ],
    },
  ]);

  if (next === 'post') {
    await postGeneratedContent(content);
  } else if (next === 'schedule') {
    await scheduleGeneratedContent(content);
  }
}

// 生成済みコンテンツを即座に投稿する
async function postGeneratedContent(content) {
  for (const [platform, data] of Object.entries(content)) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `${PLATFORM_CONFIG[platform].name} に今すぐ投稿しますか？`,
        default: true,
      },
    ]);

    if (!confirm) continue;

    try {
      switch (platform) {
        case 'twitter':
          await postTweet(data.text, data.hashtags);
          break;
        case 'instagram': {
          const { imageUrl } = await inquirer.prompt([
            { type: 'input', name: 'imageUrl', message: '投稿する画像のURL:' },
          ]);
          await postPhoto(data.text, data.hashtags, imageUrl);
          break;
        }
        case 'tiktok':
          await postVideo({ caption: data.text, hashtags: data.hashtags });
          break;
      }
    } catch (err) {
      logger.error(`${platform} 投稿失敗: ${err.message}`);
    }
  }
}

// 生成済みコンテンツをスケジュールする
async function scheduleGeneratedContent(content) {
  for (const [platform, data] of Object.entries(content)) {
    const { scheduledAt } = await inquirer.prompt([
      {
        type: 'input',
        name: 'scheduledAt',
        message: `${PLATFORM_CONFIG[platform].name} の投稿日時 (例: 2025-06-01 19:00):`,
        validate: (v) => {
          const d = new Date(v);
          return isNaN(d.getTime()) ? '正しい日時形式で入力してください' : true;
        },
      },
    ]);

    let imageUrl;
    if (platform === 'instagram') {
      const ans = await inquirer.prompt([
        { type: 'input', name: 'imageUrl', message: '投稿する画像のURL:' },
      ]);
      imageUrl = ans.imageUrl;
    }

    schedulePost({
      platform,
      text: data.text,
      hashtags: data.hashtags,
      scheduledAt: new Date(scheduledAt).toISOString(),
      imageUrl,
    });
  }
}

// 手動投稿ハンドラー
async function handlePost() {
  logger.header('📤 今すぐ投稿');

  const { platform } = await inquirer.prompt([
    {
      type: 'list',
      name: 'platform',
      message: '投稿先:',
      choices: [
        { name: '𝕏 X (Twitter)', value: 'twitter' },
        { name: '📸 Instagram', value: 'instagram' },
        { name: '🎵 TikTok', value: 'tiktok' },
      ],
    },
  ]);

  const { text } = await inquirer.prompt([
    {
      type: 'editor',
      name: 'text',
      message: '投稿テキストを入力（エディタが開きます）:',
    },
  ]);

  const { hashtagInput } = await inquirer.prompt([
    {
      type: 'input',
      name: 'hashtagInput',
      message: 'ハッシュタグ（カンマ区切り、任意）:',
    },
  ]);

  const hashtags = hashtagInput ? hashtagInput.split(',').map((h) => h.trim()) : [];

  try {
    switch (platform) {
      case 'twitter':
        await postTweet(text, hashtags);
        break;
      case 'instagram': {
        const { imageUrl } = await inquirer.prompt([
          { type: 'input', name: 'imageUrl', message: '画像URL:' },
        ]);
        await postPhoto(text, hashtags, imageUrl);
        break;
      }
      case 'tiktok':
        await postVideo({ caption: text, hashtags });
        break;
    }
  } catch (err) {
    logger.error(`投稿失敗: ${err.message}`);
  }
}

// スケジュールハンドラー
async function handleSchedule() {
  logger.header('⏰ 投稿スケジュール');

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'platform',
      message: '投稿先:',
      choices: [
        { name: '𝕏 X (Twitter)', value: 'twitter' },
        { name: '📸 Instagram', value: 'instagram' },
        { name: '🎵 TikTok', value: 'tiktok' },
      ],
    },
    {
      type: 'input',
      name: 'text',
      message: '投稿テキスト:',
      validate: (v) => v.trim() ? true : 'テキストを入力してください',
    },
    {
      type: 'input',
      name: 'hashtagInput',
      message: 'ハッシュタグ（カンマ区切り、任意）:',
    },
    {
      type: 'input',
      name: 'scheduledAt',
      message: '投稿日時 (例: 2025-06-01 19:00):',
      validate: (v) => {
        const d = new Date(v);
        return isNaN(d.getTime()) ? '正しい日時形式で入力してください' : true;
      },
    },
  ]);

  const hashtags = answers.hashtagInput
    ? answers.hashtagInput.split(',').map((h) => h.trim())
    : [];

  let imageUrl;
  if (answers.platform === 'instagram') {
    const ans = await inquirer.prompt([
      { type: 'input', name: 'imageUrl', message: '画像URL:' },
    ]);
    imageUrl = ans.imageUrl;
  }

  schedulePost({
    platform: answers.platform,
    text: answers.text,
    hashtags,
    scheduledAt: new Date(answers.scheduledAt).toISOString(),
    imageUrl,
  });
}

// スケジュール一覧ハンドラー
async function handleList() {
  logger.header('📋 スケジュール一覧');

  const { statusFilter } = await inquirer.prompt([
    {
      type: 'list',
      name: 'statusFilter',
      message: '表示するステータス:',
      choices: [
        { name: '予定中のみ', value: 'pending' },
        { name: '投稿済みのみ', value: 'posted' },
        { name: 'すべて', value: 'all' },
      ],
    },
  ]);

  const posts = getScheduledPosts(statusFilter);

  if (posts.length === 0) {
    logger.info('スケジュール済み投稿がありません');
    return;
  }

  console.log('');
  for (const post of posts) {
    const statusIcon = post.status === 'pending' ? '⏳' : post.status === 'posted' ? '✅' : '❌';
    const time = new Date(post.scheduledAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const cfg = PLATFORM_CONFIG[post.platform];

    console.log(chalk.white(`  ${statusIcon} [${post.id}]`));
    console.log(chalk.cyan(`     ${cfg.emoji} ${cfg.name} | ${time}`));
    console.log(chalk.gray(`     "${post.text.slice(0, 50)}..."`));
    console.log('');
  }

  // 操作メニュー
  if (statusFilter === 'pending' && posts.length > 0) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '操作:',
        choices: [
          { name: '今すぐ実行する', value: 'execute' },
          { name: '削除する', value: 'delete' },
          { name: '戻る', value: 'back' },
        ],
      },
    ]);

    if (action === 'execute' || action === 'delete') {
      const { postId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'postId',
          message: '対象の投稿IDを入力:',
        },
      ]);

      if (action === 'execute') {
        await executeNow(postId);
      } else {
        removePost(postId);
      }
    }
  }
}

// アナリティクスハンドラー
async function handleAnalytics() {
  const { platforms, withAdvice } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'platforms',
      message: '確認するプラットフォーム:',
      choices: [
        { name: '𝕏 X (Twitter)', value: 'twitter', checked: true },
        { name: '📸 Instagram', value: 'instagram', checked: true },
        { name: '🎵 TikTok', value: 'tiktok', checked: true },
      ],
    },
    {
      type: 'confirm',
      name: 'withAdvice',
      message: 'Claude AIによる改善アドバイスも表示しますか？',
      default: false,
    },
  ]);

  await getFollowerSummary(platforms);
  await generateReport(platforms, withAdvice);
}

// コマンドライン引数での起動もサポート
const args = process.argv.slice(2);
if (args[0]) {
  switch (args[0]) {
    case 'run-scheduler':
      showBanner();
      startScheduler();
      break;
    case 'analytics':
      await generateReport(['twitter', 'instagram', 'tiktok'], false);
      process.exit(0);
      break;
    default:
      await mainMenu();
  }
} else {
  await mainMenu();
}
