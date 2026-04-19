// 朝夜のツイートを自動生成してqueue.jsonに予約投入する
import { generateMomEntrepreneurTweets } from './momEntrepreneurGenerator.js';
import { schedulePost, getScheduledPosts } from './scheduler.js';
import { logger } from '../utils/logger.js';

const SLOTS = {
  morning: {
    hour: 8,
    postType: 'narrative',
    theme: '朝の始まり／一日の覚悟／育児と仕事の両立',
  },
  evening: {
    hour: 21,
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

function buildScheduledAt(date, hourJst) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(hourJst).padStart(2, '0');
  return new Date(`${y}-${m}-${d}T${hh}:00:00+09:00`).toISOString();
}

function alreadyScheduled(scheduledAtIso) {
  const pending = getScheduledPosts('pending');
  return pending.some(
    (p) => p.platform === 'twitter' && p.scheduledAt === scheduledAtIso
  );
}

export async function generateAndScheduleSlot(slotName, targetDate = new Date()) {
  const slot = SLOTS[slotName];
  if (!slot) throw new Error(`未対応スロット: ${slotName}`);

  const scheduledAt = buildScheduledAt(targetDate, slot.hour);

  if (alreadyScheduled(scheduledAt)) {
    logger.info(`[${slotName}] ${scheduledAt} は既に予約済み。スキップ`);
    return null;
  }

  logger.info(`[${slotName}] ツイート5本生成中...`);
  const candidates = await generateMomEntrepreneurTweets({
    postType: slot.postType,
    count: 5,
    theme: slot.theme,
  });

  const best = pickBest(candidates);
  logger.info(`[${slotName}] 採用: ${best.text.length}文字`);
  logger.info(`[${slotName}] 本文:\n${best.text}`);

  const id = schedulePost({
    platform: 'twitter',
    text: best.text,
    hashtags: [],
    scheduledAt,
  });

  return { id, text: best.text, scheduledAt };
}
