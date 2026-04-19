// 設定管理モジュール
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');

// .envファイルを読み込む
const envPath = join(rootDir, '.env');
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

// プラットフォームごとの文字数制限とハッシュタグ推奨数
export const PLATFORM_CONFIG = {
  twitter: {
    maxChars: 280,
    recommendedHashtags: 2,
    name: 'X (Twitter)',
    emoji: '𝕏',
  },
  instagram: {
    maxChars: 2200,
    recommendedHashtags: 15,
    name: 'Instagram',
    emoji: '📸',
  },
  tiktok: {
    maxChars: 2200,
    recommendedHashtags: 5,
    name: 'TikTok',
    emoji: '🎵',
  },
};

// 投稿に最適な時間帯（日本時間）
export const OPTIMAL_POSTING_TIMES = {
  twitter: ['07:00', '12:00', '18:00', '21:00'],
  instagram: ['08:00', '12:00', '19:00', '21:00'],
  tiktok: ['07:00', '15:00', '19:00', '22:00'],
};

export default {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-opus-4-6',
  },
  twitter: {
    apiKey: process.env.TWITTER_API_KEY,
    apiSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    bearerToken: process.env.TWITTER_BEARER_TOKEN,
  },
  instagram: {
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
    userId: process.env.INSTAGRAM_USER_ID,
  },
  tiktok: {
    accessToken: process.env.TIKTOK_ACCESS_TOKEN,
    openId: process.env.TIKTOK_OPEN_ID,
  },
  app: {
    language: process.env.DEFAULT_LANGUAGE || 'ja',
    timezone: process.env.TIMEZONE || 'Asia/Tokyo',
    postsDir: join(rootDir, 'posts'),
    queueFile: join(rootDir, 'posts', 'queue.json'),
  },
};
