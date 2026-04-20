// GitHub Actions用: 5本生成→ベスト1本を即投稿
// 実行: node post-now.js morning | evening
// 同スロット内で既に投稿済みなら重複防止でスキップ
import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';
import { generateMomEntrepreneurTweets } from './src/services/momEntrepreneurGenerator.js';
import { postTweet } from './src/platforms/twitter.js';
import { logger } from './src/utils/logger.js';

const SLOTS = {
  morning: {
    postType: 'narrative',
    theme: '朝の始まり／一日の覚悟／育児と仕事の両立',
    // 朝スロット: 今日の7:00 JST以降に投稿済みならスキップ
    cutoffHourJst: 7,
  },
  evening: {
    postType: 'daily',
    theme: '一日の終わり／子どもとの時間／素直な気持ち',
    // 夜スロット: 今日の20:00 JST以降に投稿済みならスキップ
    cutoffHourJst: 20,
  },
};

async function alreadyPostedInSlot(cutoffHourJst) {
  const client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
  });
  const me = await client.v2.me();
  const tl = await client.v2.userTimeline(me.data.id, {
    max_results: 10,
    'tweet.fields': ['created_at'],
    exclude: ['retweets', 'replies'],
  });
  const tweets = tl.data?.data || [];
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  const hh = String(cutoffHourJst).padStart(2, '0');
  const cutoff = new Date(`${y}-${m}-${d}T${hh}:00:00+09:00`);
  return tweets.some((t) => new Date(t.created_at) >= cutoff);
}

function pickBest(tweets) {
  const valid = tweets.filter(
    (t) =>
      t.text.length <= 280 &&
      /#ORIMAMA\b/.test(t.text) &&
      !/[。、「」]/.test(t.text) &&
      !/https?:\/\//.test(t.text)
  );
  const pool = valid.length > 0 ? valid : tweets;
  return pool.sort(
    (a, b) => Math.abs(195 - a.text.length) - Math.abs(195 - b.text.length)
  )[0];
}

const slotName = process.argv[2];
if (!SLOTS[slotName]) {
  logger.error(`スロット名が不正です: ${slotName}（morning | evening）`);
  process.exit(1);
}

const slot = SLOTS[slotName];
logger.header(`[${slotName}] 自動投稿`);

// 重複防止: 同スロット内の既投稿を確認
if (await alreadyPostedInSlot(slot.cutoffHourJst)) {
  logger.info(`[${slotName}] 本日${slot.cutoffHourJst}時以降に投稿済み。スキップします。`);
  process.exit(0);
}

const candidates = await generateMomEntrepreneurTweets({
  postType: slot.postType,
  count: 5,
  theme: slot.theme,
});

const best = pickBest(candidates);
logger.info(`採用: ${best.text.length}文字 / ${best.postType}`);
console.log('---本文---');
console.log(best.text);
console.log('----------');

const result = await postTweet(best.text, []);
logger.success(`投稿完了！ ${result.url}`);
