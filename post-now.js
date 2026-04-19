// GitHub Actions用: 5本生成→ベスト1本を即投稿
// 実行: node post-now.js morning | evening
import 'dotenv/config';
import { generateMomEntrepreneurTweets } from './src/services/momEntrepreneurGenerator.js';
import { postTweet } from './src/platforms/twitter.js';
import { logger } from './src/utils/logger.js';

const SLOTS = {
  morning: {
    postType: 'narrative',
    theme: '朝の始まり／一日の覚悟／育児と仕事の両立',
  },
  evening: {
    postType: 'daily',
    theme: '一日の終わり／子どもとの時間／素直な気持ち',
  },
};

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
