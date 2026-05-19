/**
 * TKC FX2 取込CSVを _TKC出力 タブから生成。
 * 列順は Phase 0 で確定するまでは仮スキーマ。
 *
 * 仮スキーマ:
 *   仕訳日付, 借方科目コード, 借方部門コード, 借方税区分, 借方金額,
 *   貸方科目コード, 貸方金額, 摘要, 証憑番号
 */

function exportTkcCsv() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.TABS.TKC_OUTPUT);
  const data = sheet.getDataRange().getValues();
  // ヘッダは A2:K2、データは A3 以降。A=元行 B=日付 C=借方科目 D=部門 E=税区分
  // F=借方金額 G=貸方科目 H=貸方金額 I=摘要 J=証憑 K=TKC（取込済みフラグ）
  const rows = [];
  for (let i = 2; i < data.length; i++) {  // skip A1 description + A2 header
    const r = data[i];
    if (!r[0]) continue;             // 空行スキップ
    if (r[10] === true) continue;    // TKC=TRUE（取込済み）スキップ
    // 必須欄チェック：科目コード、部門コード、税区分、金額
    if (!r[2] || !r[3] || !r[4] || !r[5]) {
      console.warn(`Skipped row ${r[0]}: missing required fields (科目/部門/税区分/金額)`);
      continue;
    }
    rows.push([
      formatDateForTkc(r[1]),  // 仕訳日付 YYYYMMDD
      r[2],                    // 借方科目コード
      r[3],                    // 借方部門コード
      r[4],                    // 借方税区分
      r[5],                    // 借方金額
      r[6],                    // 貸方科目コード
      r[7],                    // 貸方金額
      r[8],                    // 摘要
      r[9]                     // 証憑番号
    ]);
  }
  if (rows.length === 0) {
    SpreadsheetApp.getUi().alert('出力対象の行がありません（TKC=FALSE & 必須欄充足 の行が0件）。');
    return;
  }
  const header = ['仕訳日付', '借方科目コード', '借方部門コード', '借方税区分', '借方金額', '貸方科目コード', '貸方金額', '摘要', '証憑番号'];
  const csv = [header].concat(rows).map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = Utilities.newBlob('﻿' + csv, 'text/csv', csvFilename());
  const folder = getOrCreateCsvFolder();
  const file = folder.createFile(blob);
  const url = file.getUrl();
  notifyCsvExport(url, rows.length);
  SpreadsheetApp.getUi().alert(`CSV出力完了：${rows.length}行\n${url}`);
}

function csvFilename() {
  const ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
  return `TKC仕訳_${ts}.csv`;
}

function csvEscape(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  if (s.indexOf('"') >= 0 || s.indexOf(',') >= 0 || s.indexOf('\n') >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function formatDateForTkc(d) {
  if (!d) return '';
  if (d instanceof Date) return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyyMMdd');
  return String(d).replace(/-/g, '').replace(/\//g, '');
}

function getOrCreateCsvFolder() {
  const root = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
  const it = root.getFoldersByName(CONFIG.CSV_OUTPUT_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return root.createFolder(CONFIG.CSV_OUTPUT_FOLDER_NAME);
}
