// Cloudflare Worker エントリポイント
// - scheduled(): Cron Trigger 発火時（08:00 / 21:00 JST）
// - fetch(): 手動テスト用エンドポイント `/test/morning` `/test/evening`
import { generateTweets } from './generator.js';
import { postTweet } from './twitter.js';

// 各スロットで使う投稿タイプ（経営者視点を意識的に増やす）
// businessは2回入れて出現率を上げる（フォロワー増のための差別化要素）
const SLOT_VARIANTS = {
  morning: [
    { postType: 'business', theme: '経営者として朝考えてること／外注判断／組織のこと／時給換算' },
    { postType: 'business', theme: '経理代行3年目のリアル／社員4人／紹介集客／単価感' },
    { postType: 'narrative', theme: '朝の始まり×経営者の視点（育児しながら頭は仕事）' },
    { postType: 'question', theme: '経営者ママへの朝の問いかけ／今日どう動く？' },
    { postType: 'oneline', theme: '朝のひとこと（経営者目線も混ぜる）' },
  ],
  evening: [
    { postType: 'business', theme: '今日の経営判断／外注／クライアント対応／数字の振り返り' },
    { postType: 'narrative', theme: '一日を振り返って／育児と経営のリアル両方混ぜる' },
    { postType: 'daily', theme: '夜の子どもとの時間×今日の仕事の余韻' },
    { postType: 'question', theme: '経営者ママへの夜の問いかけ／今日どうだった？' },
    { postType: 'oneline', theme: '夜のひとこと（経営者の本音も混ぜる）' },
  ],
};

function pickSlotVariant(slotName) {
  const variants = SLOT_VARIANTS[slotName];
  if (!variants) throw new Error(`Unknown slot: ${slotName}`);
  return variants[Math.floor(Math.random() * variants.length)];
}

// AI感・テンプレ表現を検知するパターン（人間味フィルタ）
const AI_TEMPLATE_PATTERNS = [
  /正直に言うと/,
  /ぶっちゃけ/,
  /同じ人いる[？?]/,
  /共感してくれる人いる[？?]/,
  /伝わる人いる[？?]/,
  /わかる人[〜～]*[？?]/,
];

// 2026-05-28 ルール強化: 時刻・人数・売上・時間軸の数字を全部NG
// 矢萩本人方針:「時間軸はとにかくNG」「人や売上の数字もNG」
// 全角数字を ASCII に正規化してから判定するので、パターンは半角数字でOK
const TIME_AXIS_PATTERNS = [
  // 分刻み時刻: 7:42 / 8:03 / 21:00
  /\d{1,2}[:：]\d{2}/,
  // ○時単独 / ○時○分（「8時間」等の duration は除外）: 朝9時 / 22時 / 7時11分
  /\d{1,2}\s*時(?!間)(\s*\d{1,2}\s*分)?/,
  // 大きい人数（1〜9 人は許容、人間/人参/人前 等の語尾は除外）: 2000人 / 100人達成
  /\d{2,}\s*人(?!間|生|員|参|気|前|柄|脈|材|数|事|物)/,
  // 金額・売上系の数字: 月商500万 / 単価3万円 / 売上2倍（数字とセットの時だけ NG）
  /(月商|売上|年商|単価|月収|月収入|年収|時給)[^\n]{0,12}\d/,
  /\d+\s*(万|百万|千万|億)\s*円?/,
  // 時間軸の "分前 / 時間前" も追加
  /\d+\s*(分前|時間前)/,
  // クライアント数・社員数・スタッフ数: クライアント11社 / スタッフ4人 / 社員2人
  /(クライアント|スタッフ|社員|従業員|顧客|フォロワー|チームメンバー)[\sがをはのに〜と、・]{0,4}\d+\s*(人|名|社|件)/,
  // 時間軸の所要時間: 30分で / 1時間後 / 15分立ち話
  /\d+\s*(分で|時間で|分かけて|時間かけて|分後|時間後|分立ち|時間立ち|分の)/,
];

function violatesTimeAxis(text) {
  // 全角数字をASCIIに正規化してから判定
  const normalized = text.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xFEE0)
  );
  return TIME_AXIS_PATTERNS.some((p) => p.test(normalized));
}

// 月1回までモチーフ（過去ログから動的に渡される使用済モチーフを除外）
const MONTHLY_MOTIF_PATTERNS = [
  { key: 'グミ', re: /グミ/ },
  { key: 'モンスター', re: /モンスター|monster/i },
  { key: 'カフェラテ', re: /カフェラテ/ },
  { key: 'ルイボスティー', re: /ルイボスティー|ルイボス/ },
];

// LINE未読/タスク数の「少ない数字」検知
// （「LINE … 数件」「未読 N件」「既読スルー N件」など 1〜2桁の小さい数）
const SMALL_COUNT_PATTERNS = [
  /(LINE|ライン|既読(スルー)?|未読|メール|通知|タスク)[^\n]{0,8}\d{1,2}\s*(件|通|本|個)/,
];

// 投稿時刻より未来の時刻が過去形で書かれていないかチェック
function hasFuturePastTense(text, postingHourJst) {
  if (postingHourJst == null) return false;
  // 「23時」「22時」「21:30」など本文中の時刻を抽出
  const matches = [...text.matchAll(/(\d{1,2})\s*(?:時|[:：]\d{2})/g)];
  for (const m of matches) {
    const hh = parseInt(m[1], 10);
    if (hh > postingHourJst && hh <= 26) {
      // 周辺50文字以内に「だった/超えた/終わった/まで〜た」など過去形が含まれるか
      const idx = m.index;
      const window = text.slice(Math.max(0, idx - 10), Math.min(text.length, idx + 40));
      if (/(だった|超えた|過ぎた|終わった|になった|までやった|まで残業|まで起きて|まで仕事)/.test(window)) {
        return true;
      }
    }
  }
  return false;
}

function pickBest(tweets, recentUsedMotifs = [], postingHourJst = null) {
  // 基本の妥当性チェック（句読点なし・長さ・URL無し）。#ORIMAMAは任意。
  const valid = tweets.filter(
    (t) =>
      t.text.length <= 280 &&
      !/[。、「」]/.test(t.text) &&
      !/https?:\/\//.test(t.text)
  );
  const basePool = valid.length > 0 ? valid : tweets;

  // 段階的に厳しいフィルタを当て、空になったら一つ前に戻る（フォールバック方式）
  const filters = [
    {
      label: 'AI感テンプレ',
      fn: (t) => !AI_TEMPLATE_PATTERNS.some((p) => p.test(t.text)),
    },
    {
      label: '時刻・人数・売上・時間軸の数字',
      fn: (t) => !violatesTimeAxis(t.text),
    },
    {
      label: '少ない数字盛り',
      fn: (t) => !SMALL_COUNT_PATTERNS.some((p) => p.test(t.text)),
    },
    {
      label: '未来時刻を過去形',
      fn: (t) => !hasFuturePastTense(t.text, postingHourJst),
    },
    {
      label: '直近モチーフ被り',
      fn: (t) => {
        for (const key of recentUsedMotifs) {
          const motif = MONTHLY_MOTIF_PATTERNS.find((m) => m.key === key);
          if (motif && motif.re.test(t.text)) return false;
        }
        return true;
      },
    },
  ];

  let pool = basePool;
  for (const f of filters) {
    const next = pool.filter(f.fn);
    if (next.length === 0) {
      console.warn(`[pickBest] フィルタ "${f.label}" で全候補が落ちた。前段の候補のままにする。`);
      continue;
    }
    pool = next;
  }

  return pool.sort(
    (a, b) => Math.abs(195 - a.text.length) - Math.abs(195 - b.text.length)
  )[0];
}

function todayJstKey(slotName) {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `posted:${slotName}:${y}-${m}-${d}`;
}

function jstNowString() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  const mm = String(jst.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

const JST_DOW_LABEL = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
function jstDowLabel() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return JST_DOW_LABEL[jst.getUTCDay()];
}

// 直近の投稿履歴をKVから取得（重複検知回避＋多様性確保）
async function fetchRecentTweets(env, limit = 10) {
  const list = await env.KV.list({ prefix: 'history:' });
  // KVの list は新しい順ではないので timestamp で並べ替え
  const sorted = list.keys
    .map((k) => k.name)
    .sort()
    .reverse()
    .slice(0, limit);
  const texts = [];
  for (const key of sorted) {
    const text = await env.KV.get(key);
    if (text) texts.push(text);
  }
  return texts;
}

// 投稿成功時に履歴へ追記（30日で自動削除）
async function appendHistory(env, text) {
  const ts = new Date().toISOString();
  await env.KV.put(`history:${ts}`, text, { expirationTtl: 86400 * 30 });
}

async function runSlot(slotName, env) {
  const slot = pickSlotVariant(slotName);

  console.log(`[${slotName}] 開始 (type=${slot.postType})`);

  const key = todayJstKey(slotName);
  const already = await env.KV.get(key);
  if (already) {
    console.log(`[${slotName}] 既に投稿済み: ${already}`);
    return { skipped: true, reason: 'already posted', existing: JSON.parse(already) };
  }

  // 直近30日の投稿履歴を取得（多様性確保）
  const recentTweets = await fetchRecentTweets(env, 10);
  console.log(`[${slotName}] 直近${recentTweets.length}投稿を取得`);

  const postingTime = jstNowString();
  const postingDow = jstDowLabel();
  const postingHourJst = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours();
  console.log(`[${slotName}] ツイート5本生成中... (theme=${slot.theme}, time=${postingTime}, dow=${postingDow})`);
  const candidates = await generateTweets(
    { postType: slot.postType, count: 5, theme: slot.theme, recentTweets, postingTime, postingDow },
    env
  );

  const usedMotifs = MONTHLY_MOTIF_PATTERNS
    .filter((m) => recentTweets.some((t) => m.re.test(t)))
    .map((m) => m.key);
  const best = pickBest(candidates, usedMotifs, postingHourJst);
  console.log(`[${slotName}] 採用: ${best.text.length}文字 / ${best.postType}`);
  console.log('---本文---\n' + best.text + '\n----------');

  const result = await postTweet(best.text, env);
  console.log(`[${slotName}] 投稿完了: ${result.url}`);

  // 投稿成功フラグ（同日重複防止用、48時間TTL）
  await env.KV.put(
    key,
    JSON.stringify({
      tweetId: result.id,
      url: result.url,
      postedAt: new Date().toISOString(),
    }),
    { expirationTtl: 86400 * 2 }
  );

  // 投稿履歴（30日保持、次回プロンプトに渡す用）
  await appendHistory(env, best.text);

  return { success: true, url: result.url, tweetId: result.id };
}

// Cron → slot 名 へのマッピング
function slotFromCron(cron) {
  if (cron === '0 23 * * *') return 'morning'; // 23:00 UTC = 08:00 JST
  if (cron === '0 12 * * *') return 'evening'; // 12:00 UTC = 21:00 JST
  throw new Error(`Unknown cron: ${cron}`);
}

export default {
  async scheduled(event, env, ctx) {
    const slotName = slotFromCron(event.cron);
    ctx.waitUntil(
      runSlot(slotName, env).catch((err) => {
        console.error(`[${slotName}] エラー: ${err.message}`);
        throw err;
      })
    );
  },

  // 手動テスト:
  //   /test/morning|evening    → 生成 + 実投稿（Twitter消費）
  //   /preview/morning|evening → 生成のみ（投稿しない・Twitter消費なし）
  async fetch(request, env) {
    const url = new URL(request.url);

    // 認証
    const checkAuth = () => {
      const auth = request.headers.get('x-test-token');
      return env.TEST_TOKEN && auth === env.TEST_TOKEN;
    };

    // 生成のみ（投稿しない）
    const previewMatch = url.pathname.match(/^\/preview\/(morning|evening)$/);
    if (previewMatch) {
      if (!checkAuth()) return new Response('Unauthorized', { status: 401 });
      try {
        const slot = pickSlotVariant(previewMatch[1]);
        const recentTweets = await fetchRecentTweets(env, 10);
        const postingTime = jstNowString();
        const postingDow = jstDowLabel();
        const postingHourJst = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours();
        const candidates = await generateTweets(
          { postType: slot.postType, count: 5, theme: slot.theme, recentTweets, postingTime, postingDow },
          env
        );
        const usedMotifs = MONTHLY_MOTIF_PATTERNS
          .filter((m) => recentTweets.some((t) => m.re.test(t)))
          .map((m) => m.key);
        const best = pickBest(candidates, usedMotifs, postingHourJst);
        return Response.json({
          slot: previewMatch[1],
          postType: slot.postType,
          theme: slot.theme,
          postingTime,
          postingDow,
          postingHourJst,
          usedMotifs,
          recentTweetsCount: recentTweets.length,
          best,
          allCandidates: candidates,
        });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    // 実投稿
    const testMatch = url.pathname.match(/^\/test\/(morning|evening)$/);
    if (testMatch) {
      if (!checkAuth()) return new Response('Unauthorized', { status: 401 });
      try {
        const result = await runSlot(testMatch[1], env);
        return Response.json(result);
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    return new Response('SNS Auto Poster (ORIMAMA) - OK', { status: 200 });
  },
};
