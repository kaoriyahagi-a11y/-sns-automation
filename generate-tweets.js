// 矢萩香織 X投稿生成スクリプト
// 実行: node generate-tweets.js
//   --type=narrative|daily|business|question|oneline|mixed
//   --count=5
//   --theme="任意のテーマ"
import 'dotenv/config';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { generateMomEntrepreneurTweets, POST_TYPES } from './src/services/momEntrepreneurGenerator.js';
import { logger } from './src/utils/logger.js';
import chalk from 'chalk';

const args = process.argv.slice(2).reduce((acc, a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) acc[m[1]] = m[2] ?? true;
  return acc;
}, {});

const postType = args.type || 'mixed';
const count = parseInt(args.count || '5', 10);
const theme = args.theme || '';

logger.header(`矢萩香織 X投稿生成（@ORI2024202463 / ORI MAMA）`);
console.log(`  タイプ: ${postType === 'mixed' ? 'ミックス（5タイプをバランスよく）' : POST_TYPES[postType]?.label || postType}`);
console.log(`  本数: ${count}`);
if (theme) console.log(`  テーマ: ${theme}`);
logger.divider();

const tweets = await generateMomEntrepreneurTweets({ postType, count, theme });

const typeColor = {
  narrative: chalk.bgMagenta.white,
  daily: chalk.bgYellow.black,
  business: chalk.bgBlue.white,
  question: chalk.bgCyan.black,
  oneline: chalk.bgGreen.black,
};

tweets.forEach((t, i) => {
  console.log('');
  console.log(chalk.bold.yellow(`━━━ No.${i + 1} ━━━`));
  const label = POST_TYPES[t.postType]?.label || t.postType;
  const color = typeColor[t.postType] || chalk.bgGray.white;
  console.log(`  ${color(` ${label} `)} ${chalk.gray(`${t.text.length}文字`)}`);
  console.log('');
  console.log(chalk.white(t.text));
  console.log('');
  console.log(chalk.gray(`  💡 ${t.memo}`));
});

console.log('');
logger.divider();

// posts/drafts.json に保存
const draftsPath = './posts/drafts.json';
if (!existsSync('./posts')) await mkdir('./posts', { recursive: true });

let drafts = [];
if (existsSync(draftsPath)) {
  try { drafts = JSON.parse(await readFile(draftsPath, 'utf8')); } catch { drafts = []; }
}

const newDrafts = tweets.map((t, i) => ({
  id: `${Date.now()}-${i}`,
  text: t.text,
  postType: t.postType,
  memo: t.memo,
  createdAt: new Date().toISOString(),
  status: 'draft',
}));

drafts.push(...newDrafts);
await writeFile(draftsPath, JSON.stringify(drafts, null, 2), 'utf8');

logger.success(`${tweets.length}本を posts/drafts.json に保存`);
console.log('');
console.log(chalk.bold('📤 投稿したい場合：'));
console.log(chalk.gray('  node post-draft.js list         下書き一覧'));
console.log(chalk.gray('  node post-draft.js <番号>       投稿'));
