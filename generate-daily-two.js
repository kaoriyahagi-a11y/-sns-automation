// 朝夜2本を生成してqueue.jsonに予約投入する一回限りのスクリプト
import { generateMomEntrepreneurTweets } from './src/services/momEntrepreneurGenerator.js';
import { schedulePost } from './src/services/scheduler.js';
import { logger } from './src/utils/logger.js';

const TARGET_DATE = process.argv[2] || '2026-04-17';

async function main() {
  // 朝用：語りかけ/ビジネス寄り
  logger.info('=== 朝用ツイート生成（語りかけ型）===');
  const morning = await generateMomEntrepreneurTweets({
    postType: 'narrative',
    count: 5,
    theme: '朝の始まり／一日の覚悟／育児と仕事の両立',
  });

  // 夜用：日常/問いかけ寄り
  logger.info('=== 夜用ツイート生成（日常リアル型）===');
  const evening = await generateMomEntrepreneurTweets({
    postType: 'daily',
    count: 5,
    theme: '一日の終わり／子どもとの時間／素直な気持ち',
  });

  // ベスト1本を自動選定：140字以内・必須タグあり・句読点なし で最短のもの
  const pickBest = (tweets) => {
    const valid = tweets.filter(
      (t) => t.text.length <= 280 && /#ORI_MAMA|#育児はキャリア/.test(t.text) && !/[。、「」]/.test(t.text)
    );
    const pool = valid.length > 0 ? valid : tweets;
    return pool.sort((a, b) => Math.abs(140 - a.text.length) - Math.abs(140 - b.text.length))[0];
  };

  const morningPick = pickBest(morning);
  const eveningPick = pickBest(evening);

  console.log('\n========== 朝 08:00 予定 ==========');
  console.log(morningPick.text);
  console.log(`[${morningPick.text.length}文字 / ${morningPick.postType}]`);
  console.log('狙い:', morningPick.memo);

  console.log('\n========== 夜 21:00 予定 ==========');
  console.log(eveningPick.text);
  console.log(`[${eveningPick.text.length}文字 / ${eveningPick.postType}]`);
  console.log('狙い:', eveningPick.memo);

  if (process.argv.includes('--commit')) {
    schedulePost({
      platform: 'twitter',
      text: morningPick.text,
      hashtags: [],
      scheduledAt: new Date(`${TARGET_DATE}T08:00:00+09:00`).toISOString(),
    });
    schedulePost({
      platform: 'twitter',
      text: eveningPick.text,
      hashtags: [],
      scheduledAt: new Date(`${TARGET_DATE}T21:00:00+09:00`).toISOString(),
    });
    logger.success(`${TARGET_DATE} の2本を予約しました`);
  } else {
    console.log('\n※ プレビューのみ。予約するには --commit を付けて再実行してください');
  }
}

main().catch((e) => {
  logger.error(e.message);
  process.exit(1);
});
