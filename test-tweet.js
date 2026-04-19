// X投稿テストスクリプト
// 実行方法: node test-tweet.js
import 'dotenv/config';
import { postTweet } from './src/platforms/twitter.js';

const testText = `【テスト投稿】SNS自動化ツールのセットアップ完了テスト 🎉\n投稿時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`;

try {
  console.log('📤 テスト投稿を実行します...');
  console.log('---投稿内容---');
  console.log(testText);
  console.log('--------------');

  const result = await postTweet(testText, []);

  console.log('\n✅ 投稿成功！');
  console.log(`🔗 URL: ${result.url}`);
  console.log(`📝 ツイートID: ${result.id}`);
} catch (error) {
  console.error('\n❌ 投稿失敗:');
  console.error(`エラー: ${error.message}`);
  if (error.data) {
    console.error('詳細:', JSON.stringify(error.data, null, 2));
  }
  console.error('\n📋 確認ポイント:');
  console.error('1. .env の5つのキーがすべて正しく貼り付けられているか');
  console.error('2. X Developer Portalで「Read and write」権限になっているか');
  console.error('3. 権限変更後にアクセストークンを再生成したか');
  process.exit(1);
}
