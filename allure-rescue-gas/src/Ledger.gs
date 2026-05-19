/**
 * 「Allure経費」シートへの行追加と重複検知。
 *
 * シート列: A=NO, B=収日, C=支払先, D=勘定科目, E=合計金額, F=使用者, G=リンク, H=TKC, I=備考
 * 注: A列「NO」は自動採番（既存運用準拠、TBD-08で要確認）。
 *     本Plan 1ではA列を ROW()-2 自動採番で扱う。実シートのA列内容が違えばBootstrapで調整。
 */

/**
 * 純関数: 渡された既存行配列に対して、重複の有無を返す。
 * 重複条件: 収日（YYYY-MM-DD 文字列） × 金額（数値） × 支払先（部分一致のどちらかが他方を含む）
 */
function isDuplicateInRows(date, amount, payee, existingRows) {
  for (let i = 1; i < existingRows.length; i++) {
    const row = existingRows[i];
    const [_, eDate, ePayee, _account, eAmount] = row;
    if (!eDate) continue;
    const dateStr = (eDate instanceof Date)
      ? Utilities.formatDate(eDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(eDate);
    if (dateStr !== date) continue;
    if (Number(eAmount) !== Number(amount)) continue;
    if (!ePayee || !payee) continue;
    if (ePayee.indexOf(payee) >= 0 || payee.indexOf(ePayee) >= 0) return true;
  }
  return false;
}

/** I/O版: スプシから既存行を読んで重複判定。 */
function isDuplicate(date, amount, payee) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.TABS.LEDGER);
  const rows = sheet.getDataRange().getValues();
  return isDuplicateInRows(date, amount, payee, rows);
}

/**
 * 「Allure経費」シートに行を追加。要確認フラグがあればH列セルを黄色＋コメント。
 * @param {Object} row - {date, payee, account, amount, user, link, note, needsReview, reviewComment}
 * @returns {number} 追加した行番号
 */
function appendRow(row) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.TABS.LEDGER);
  const newRowNum = sheet.getLastRow() + 1;
  // A列「NO」は ROW()-2 自動採番運用（既存A列が空であることを前提）
  const values = [[
    newRowNum - 2,                  // A: NO（連番）
    row.date || '',                 // B: 収日
    row.payee || '',                // C: 支払先
    row.account || '',              // D: 勘定科目
    row.amount || '',               // E: 金額
    row.user || '',                 // F: 使用者
    row.link || '',                 // G: リンク
    false,                          // H: TKC（未取込）
    row.note || ''                  // I: 備考
  ]];
  sheet.getRange(newRowNum, 1, 1, 9).setValues(values);

  if (row.needsReview) {
    const hCell = sheet.getRange(newRowNum, 8);
    hCell.setBackground('#fff59d');  // 黄
    if (row.reviewComment) hCell.setComment(row.reviewComment);
  }
  return newRowNum;
}
