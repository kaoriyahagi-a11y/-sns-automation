/**
 * Gmail通知。日次サマリ／CSV出力完了／緊急アラート用。
 */

function notifyDailySummary(report) {
  const subject = `[Allure経理] 日次OCRサマリ ${Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MM/dd HH:mm')}`;
  const body = [
    'Allure経理 OCRパイプライン 日次レポート',
    '',
    `処理対象PDF数:      ${report.totalPdfs}`,
    `行追加（成功）:     ${report.added}`,
    `要確認:             ${report.needsReview}`,
    `重複スキップ:       ${report.duplicates}`,
    `失敗:               ${report.failures}`,
    '',
    `シート: https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/edit`,
    '',
    '要確認行はH列セルが黄色になっています。コメントの指示通り対応してください。'
  ].join('\n');
  GmailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, body);
}

function notifyCsvExport(csvUrl, rowCount) {
  const subject = `[Allure経理] TKC CSV出力完了 ${rowCount}行`;
  const body = [
    `TKC FX2 取込用CSVを出力しました。`,
    '',
    `行数: ${rowCount}`,
    `ダウンロード: ${csvUrl}`,
    '',
    'TKC FX2 にアップロードし、取込完了後にシート「Allure経費」H列を一括TRUEにしてください。'
  ].join('\n');
  GmailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, body);
}

function notifyError(context, errorMsg) {
  const subject = `[Allure経理] ⚠ エラー発生: ${context}`;
  const body = `エラーコンテキスト: ${context}\n\nメッセージ:\n${errorMsg}`;
  GmailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, body);
}
