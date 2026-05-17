// GitHub Actions用: 5本生成→ベスト1本を即投稿
// 実行: node post-now.js morning | evening
// - 同スロット内で既に投稿済みなら重複防止でスキップ
// - 直近投稿との類似度をチェックし、被るものは除外
// - 投稿タイプは曜日でローテーション（仕事楽しさ型を含む）
import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';
import { generateMomEntrepreneurTweets } from './src/services/momEntrepreneurGenerator.js';
import { postTweet } from './src/platforms/twitter.js';
import { logger } from './src/utils/logger.js';

// ---- 内容ガード用ヘルパー（2026-05-17追加） ----

// JST 今日の "YYYY-MM-DD（曜日）" 表記を返す
function getJstTodayInfo() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  const dows = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
  const dow = dows[jst.getUTCDay()];
  return `${y}-${m}-${d}（${dow}）`;
}

const SLOT_LABELS = {
  morning: '朝8時（JST）',
  evening: '夜21時（JST）',
};

// 月1回程度に制限したいモチーフ
const RATE_LIMITED_MOTIFS = ['グミ', 'モンスター'];

// 直近30日のツイート群から、再利用禁止すべきモチーフを抽出
function detectBannedMotifs(tweets) {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const recent = tweets.filter((t) => new Date(t.created_at).getTime() >= cutoff);
  return RATE_LIMITED_MOTIFS.filter((m) =>
    recent.some((t) => t.text?.includes(m))
  );
}

// 時間軸関連の禁止パターン
const TIME_AXIS_PATTERNS = [
  /\d{1,2}[:：]\d{2}/,                          // 7:11 / 21:00
  /\d{1,2}時(?!間)(\d{1,2}分)?/,                // 22時 / 7時11分（「8時間」等の duration は除外）
  /\d{2,}\s*人(?!間|生|員|参|気|前|柄|脈|材|数|事|物)/, // 2000人（1人/人参/人前 等は除外）
  /(月商|売上|年商|単価|月収|月収入|年収)[^\s]*?\d/, // 月商500万
  /\d+\s*(分で|時間で|分かけて|時間かけて|分後|時間後)/, // 30分で / 1時間後
];

function violatesTimeAxis(text) {
  // 全角数字をASCIIに正規化してから判定
  const normalized = text.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
  );
  return TIME_AXIS_PATTERNS.some((p) => p.test(normalized));
}

const SLOTS = {
  morning: {
    cutoffHourJst: 7,
    rotation: [
      { postType: 'narrative', theme: '朝の始まり／一日の覚悟／仕事への気持ち' },
      { postType: 'work', theme: '仕事の手応え／経営の面白さ／達成感（子ども・育児の話なし）' },
      { postType: 'question', theme: '経営者ママへの問いかけ／フォロワーとの会話' },
    ],
  },
  evening: {
    cutoffHourJst: 20,
    rotation: [
      { postType: 'daily', theme: '一日の終わり／素直な気持ち' },
      { postType: 'oneline', theme: '刺さる短い一言／ブランドメッセージ' },
      { postType: 'work', theme: '仕事への愛着／一日の振り返り（子ども・育児の話なし）' },
    ],
  },
};

function pickRotation(slot) {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const day = jst.getUTCDate();
  return slot.rotation[day % slot.rotation.length];
}

// 直近の投稿を取得（重複ガード用 + cutoff判定の両方に使う）
async function fetchRecentPosts(cutoffHourJst) {
  const client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
  });
  const me = await client.v2.me();
  const tl = await client.v2.userTimeline(me.data.id, {
    max_results: 30,
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
  const alreadyPosted = tweets.some((t) => new Date(t.created_at) >= cutoff);

  return { alreadyPosted, tweets };
}

// 直近投稿の冒頭2行を avoidPhrases として抽出
function buildAvoidPhrases(tweets, max = 20) {
  return tweets.slice(0, max).map((t) => {
    const lines = t.text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('http'));
    return lines.slice(0, 2).join(' / ').slice(0, 60);
  }).filter((p) => p.length > 0);
}

// n-gram類似度（4文字単位の共通率）
function ngramSimilarity(a, b, n = 4) {
  if (a.length < n || b.length < n) return 0;
  const grams = new Set();
  for (let i = 0; i <= a.length - n; i++) grams.add(a.slice(i, i + n));
  let hit = 0;
  const total = b.length - n + 1;
  for (let i = 0; i <= b.length - n; i++) {
    if (grams.has(b.slice(i, i + n))) hit++;
  }
  return hit / total;
}

function pickBest(tweets, recentTexts) {
  const baseValid = tweets.filter(
    (t) =>
      t.text.length <= 280 &&
      /#ORIMAMA\b/.test(t.text) &&
      !/[。、「」]/.test(t.text) &&
      !/https?:\/\//.test(t.text)
  );
  const valid = baseValid.filter((t) => !violatesTimeAxis(t.text));

  if (baseValid.length > 0 && valid.length === 0) {
    logger.warn(
      `全候補が時間軸ルール違反。基本条件は満たすプールから195字に近いものを採用します。`
    );
  }

  // 違反フィルタで全滅したら baseValid（基本条件OKな集合）で代用、それも空なら tweets
  const pool = valid.length > 0 ? valid : baseValid.length > 0 ? baseValid : tweets;

  // 直近投稿との類似度0.10未満のみを残す（既存ロジック）
  const SIMILARITY_THRESHOLD = 0.1;
  const filtered = pool.filter((t) => {
    const maxSim = recentTexts.reduce(
      (max, r) => Math.max(max, ngramSimilarity(t.text, r, 4)),
      0
    );
    return maxSim < SIMILARITY_THRESHOLD;
  });
  const finalPool = filtered.length > 0 ? filtered : pool;
  if (filtered.length === 0 && pool.length > 0) {
    logger.warn('全候補が直近投稿と類似（しきい値未満なし）。やむを得ず全候補から選定。');
  }

  return finalPool.sort(
    (a, b) => Math.abs(195 - a.text.length) - Math.abs(195 - b.text.length)
  )[0];
}

const slotName = process.argv[2];
if (!SLOTS[slotName]) {
  logger.error(`スロット名が不正です: ${slotName}（morning | evening）`);
  process.exit(1);
}

const slot = SLOTS[slotName];
const r = pickRotation(slot);
logger.header(`[${slotName}] 自動投稿 / postType=${r.postType}`);

// 直近投稿を取得して、cutoff判定 + avoidPhrases構築
const { alreadyPosted, tweets: recent } = await fetchRecentPosts(slot.cutoffHourJst);

if (alreadyPosted) {
  logger.info(`[${slotName}] 本日${slot.cutoffHourJst}時以降に投稿済み。スキップします。`);
  process.exit(0);
}

const avoidPhrases = buildAvoidPhrases(recent, 20);
logger.info(`重複ガード: 直近${avoidPhrases.length}件のフレーズを除外指示`);

// 公開時刻・曜日をJSTで組み立て（プロンプトの曜日整合性／時刻矛盾ガード用）
const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
const yyyy = jstNow.getUTCFullYear();
const mm = String(jstNow.getUTCMonth() + 1).padStart(2, '0');
const dd = String(jstNow.getUTCDate()).padStart(2, '0');
const hh = String(slotName === 'morning' ? 8 : 21).padStart(2, '0');
const postingTime = `${yyyy}-${mm}-${dd} ${hh}:00`;
const dowNames = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
const postingDow = dowNames[jstNow.getUTCDay()];
logger.info(`投稿コンテキスト: ${postingTime} JST / ${postingDow}`);

const recentTexts = recent.slice(0, 30).map((t) => t.text);

const candidates = await generateMomEntrepreneurTweets({
  postType: r.postType,
  count: 5,
  theme: r.theme,
  avoidPhrases,
  recentTweets: recentTexts,
  postingTime,
  postingDow,
});

const best = pickBest(candidates, recentTexts);
logger.info(`採用: ${best.text.length}文字 / ${best.postType}`);
console.log('---本文---');
console.log(best.text);
console.log('----------');

const result = await postTweet(best.text, []);
logger.success(`投稿完了！ ${result.url}`);
