// ロガーユーティリティ（カラー出力付き）
import chalk from 'chalk';

const timestamp = () => new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

export const logger = {
  info: (msg) => console.log(chalk.blue(`[${timestamp()}] ℹ️  ${msg}`)),
  success: (msg) => console.log(chalk.green(`[${timestamp()}] ✅ ${msg}`)),
  warn: (msg) => console.log(chalk.yellow(`[${timestamp()}] ⚠️  ${msg}`)),
  error: (msg) => console.log(chalk.red(`[${timestamp()}] ❌ ${msg}`)),
  post: (platform, msg) => console.log(chalk.magenta(`[${timestamp()}] 📤 [${platform}] ${msg}`)),
  analytics: (msg) => console.log(chalk.cyan(`[${timestamp()}] 📊 ${msg}`)),
  ai: (msg) => console.log(chalk.yellow(`[${timestamp()}] 🤖 ${msg}`)),
  divider: () => console.log(chalk.gray('─'.repeat(60))),
  header: (title) => {
    console.log('');
    console.log(chalk.bold.white(`  ${title}`));
    console.log(chalk.gray('─'.repeat(60)));
  },
};
