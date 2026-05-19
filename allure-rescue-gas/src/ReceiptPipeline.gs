/**
 * 日次オーケストレータ: Drive新着PDF → DocAI → 分類 → 重複検知 → シート行追加 → ログ → 通知
 * 時間トリガから呼ばれる。
 */

function processDailyReceipts() {
  const report = {totalPdfs: 0, added: 0, needsReview: 0, duplicates: 0, failures: 0};
  try {
    const masters = loadAllMasters();
    const pdfs = listNewReceiptPdfs();
    report.totalPdfs = pdfs.length;
    for (const pdf of pdfs) {
      processOnePdf(pdf, masters, report);
    }
    notifyDailySummary(report);
    PropertiesService.getScriptProperties().setProperty(
      CONFIG.PROCESS_TIMESTAMP_KEY, new Date().toISOString()
    );
  } catch (e) {
    notifyError('processDailyReceipts', e.message + '\n' + e.stack);
    throw e;
  }
}

function processOnePdf(pdfFile, masters, report) {
  const fileId = pdfFile.getId();
  const filename = pdfFile.getName();
  try {
    const parsed = parseFilename(filename);
    const ocr = processDocument(pdfFile.getBlob());
    if (!ocr.date || !ocr.totalAmount) {
      // 致命的: 日付か金額がない → 行を作らない、要確認ログ
      logOcrEvent(fileId, filename, 'failure', '', '', 'date or amount missing from OCR');
      report.failures++;
      return;
    }
    if (isDuplicate(ocr.date, ocr.totalAmount, ocr.payee || '')) {
      logOcrEvent(fileId, filename, 'duplicate', '', '', '');
      report.duplicates++;
      return;
    }
    const dept = classifyDepartment(parsed.user, masters.user);
    const account = classifyAccount(ocr.payee, masters.account);
    const alloc = classifyAllocation(ocr.payee, ocr.totalAmount, masters.alloc);

    const reasons = [];
    if (!parsed.user) reasons.push('ファイル名から使用者抽出失敗');
    if (parsed.user && !dept) reasons.push(`使用者「${parsed.user}」が _使用者マスタ にありません`);
    if (!account.account) reasons.push(`支払先「${ocr.payee}」が _科目マスタ にありません`);
    if (alloc.required) reasons.push(`按分対象（${alloc.pattern}）`);
    const needsReview = reasons.length > 0;
    const reviewComment = reasons.join(' / ');

    const link = `https://drive.google.com/file/d/${fileId}/view`;
    const rowNum = appendRow({
      date: ocr.date,
      payee: ocr.payee || '',
      account: account.account || '',
      amount: ocr.totalAmount,
      user: parsed.user || '不明',
      link,
      note: needsReview ? '要確認: ' + reviewComment : '',
      needsReview,
      reviewComment
    });
    logOcrEvent(fileId, filename, needsReview ? 'needs_review' : 'success', '', rowNum, '');
    if (needsReview) report.needsReview++;
    else report.added++;
  } catch (e) {
    logOcrEvent(fileId, filename, 'failure', '', '', e.message);
    report.failures++;
  }
}

/** Driveから前回処理時刻以降の新着PDFを列挙。 */
function listNewReceiptPdfs() {
  const props = PropertiesService.getScriptProperties();
  const lastIso = props.getProperty(CONFIG.PROCESS_TIMESTAMP_KEY);
  const since = lastIso ? new Date(lastIso) : new Date(0);
  const root = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
  const pdfs = [];
  collectPdfsRecursive(root, since, pdfs);
  return pdfs;
}

function collectPdfsRecursive(folder, since, out) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.getName().endsWith('.pdf') && f.getLastUpdated() > since) {
      out.push(f);
    }
  }
  const subs = folder.getFolders();
  while (subs.hasNext()) {
    collectPdfsRecursive(subs.next(), since, out);
  }
}

function loadAllMasters() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  return {
    user: ss.getSheetByName(CONFIG.TABS.M_USER).getDataRange().getValues(),
    account: ss.getSheetByName(CONFIG.TABS.M_ACCOUNT).getDataRange().getValues(),
    alloc: ss.getSheetByName(CONFIG.TABS.M_ALLOC).getDataRange().getValues()
  };
}

/** 手動デバッグ用。1ファイルだけ処理して結果をログ出力。 */
function processOnePdfManually(fileId) {
  const file = DriveApp.getFileById(fileId);
  const masters = loadAllMasters();
  const report = {totalPdfs: 1, added: 0, needsReview: 0, duplicates: 0, failures: 0};
  processOnePdf(file, masters, report);
  console.log('Result:', JSON.stringify(report));
}
