/**
 * onOpen でカスタムメニュー登録、setupTimeTrigger で日次cron登録。
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('経理自動化')
    .addItem('🧾 領収書OCRを今すぐ実行', 'processDailyReceipts')
    .addItem('📤 TKC CSV出力', 'exportTkcCsv')
    .addSeparator()
    .addItem('▶ テスト実行（runAllTests）', 'runAllTests')
    .addItem('🛠 初回セットアップ（bootstrapSheets）', 'bootstrapSheets')
    .addItem('⏰ 時間トリガ設定（setupTimeTrigger）', 'setupTimeTrigger')
    .addToUi();
}

/** 毎日 9時 と 21時 に processDailyReceipts を実行するトリガを登録。 */
function setupTimeTrigger() {
  // 既存トリガをクリーンアップ
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processDailyReceipts')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('processDailyReceipts')
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();
  ScriptApp.newTrigger('processDailyReceipts')
    .timeBased()
    .atHour(21)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();
  SpreadsheetApp.getUi().alert('時間トリガ登録完了：毎日 9:00 と 21:00 に処理が走ります。');
}
