/**
 * _OCRログ への追記。各PDF処理1件 = 1行。
 */
function logOcrEvent(driveId, filename, result, confidence, rowNum, errorMsg) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.TABS.OCR_LOG);
  sheet.appendRow([
    new Date(),
    driveId || '',
    filename || '',
    result,                           // 'success' | 'duplicate' | 'needs_review' | 'failure'
    confidence !== undefined ? confidence : '',
    rowNum || '',
    errorMsg || ''
  ]);
}
