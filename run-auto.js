// X自動投稿デーモン
// - 07:30 JST: 朝用ツイート5本生成→ベスト1本を08:00にスケジュール
// - 20:30 JST: 夜用ツイート5本生成→ベスト1本を21:00にスケジュール
// - 毎分: queue.jsonをチェックし予定時刻を過ぎた投稿を実行
import cron from 'node-cron';
import { startScheduler } from './src/services/scheduler.js';
import { generateAndScheduleSlot } from './src/services/dailyAutoPost.js';
import { logger } from './src/utils/logger.js';

const TZ = 'Asia/Tokyo';

async function runSlot(slotName) {
  try {
    await generateAndScheduleSlot(slotName);
  } catch (err) {
    logger.error(`[${slotName}] 生成/予約失敗: ${err.message}`);
  }
}

function showBanner() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   🤖 X自動投稿デーモン（ORI MAMA）          ║');
  console.log('║   07:30 朝生成 → 08:00 投稿                  ║');
  console.log('║   20:30 夜生成 → 21:00 投稿                  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
}

async function main() {
  showBanner();

  cron.schedule('30 7 * * *', () => runSlot('morning'), { timezone: TZ });
  cron.schedule('30 20 * * *', () => runSlot('evening'), { timezone: TZ });
  logger.success('生成cron登録完了（07:30 / 20:30 JST）');

  startScheduler();

  if (process.argv.includes('--now-morning')) await runSlot('morning');
  if (process.argv.includes('--now-evening')) await runSlot('evening');
}

main().catch((e) => {
  logger.error(e.message);
  process.exit(1);
});
