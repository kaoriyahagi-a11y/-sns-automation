// 下書きから選んで投稿するスクリプト
// 実行: node post-draft.js <番号>   例: node post-draft.js 1
//       node post-draft.js list    (下書き一覧)
import 'dotenv/config';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { postTweet } from './src/platforms/twitter.js';
import { logger } from './src/utils/logger.js';
import { POST_TYPES } from './src/services/momEntrepreneurGenerator.js';
import chalk from 'chalk';

const draftsPath = './posts/drafts.json';
if (!existsSync(draftsPath)) {
  logger.error('posts/drafts.json が見つかりません。先に `node generate-tweets.js` を実行してください。');
  process.exit(1);
}

const drafts = JSON.parse(await readFile(draftsPath, 'utf8'));
const pending = drafts.filter((d) => d.status === 'draft');

const arg = process.argv[2];

if (!arg || arg === 'list') {
  logger.header(`下書き一覧（${pending.length}本）`);
  pending.forEach((d, i) => {
    const label = POST_TYPES[d.postType]?.label || d.postType;
    console.log('');
    console.log(chalk.bold.yellow(`[${i + 1}] ${chalk.cyan(label)} ${chalk.gray(d.hook_type)} ${chalk.gray(d.text.length + '文字')}`));
    console.log(chalk.white(d.text));
  });
  console.log('');
  console.log(chalk.gray('投稿するには: node post-draft.js <番号>'));
  process.exit(0);
}

const index = parseInt(arg, 10) - 1;
if (isNaN(index) || index < 0 || index >= pending.length) {
  logger.error(`番号が不正です。1〜${pending.length}の範囲で指定してください。`);
  process.exit(1);
}

const draft = pending[index];
logger.header('投稿確認');
console.log(chalk.white(draft.text));
console.log('');
console.log(chalk.gray(`タイプ: ${POST_TYPES[draft.postType]?.label || draft.postType} / ${draft.text.length}文字`));
logger.divider();

logger.post('X (Twitter)', '投稿中...');
const result = await postTweet(draft.text, []);

// draftのstatusを更新
const allDrafts = JSON.parse(await readFile(draftsPath, 'utf8'));
const target = allDrafts.find((d) => d.id === draft.id);
if (target) {
  target.status = 'posted';
  target.postedAt = result.postedAt;
  target.postUrl = result.url;
  target.tweetId = result.id;
  await writeFile(draftsPath, JSON.stringify(allDrafts, null, 2), 'utf8');
}

console.log('');
logger.success('投稿完了！');
console.log(chalk.cyan(`🔗 ${result.url}`));
