/**
 * 初回セットアップ用。Apps Scriptエディタから手動で1回だけ実行する。
 * 既存タブがあれば作成スキップ。マスタにはseedデータを投入。
 */
function bootstrapSheets() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  setupMasterDept(ss);
  setupMasterUser(ss);
  setupMasterAccount(ss);
  setupMasterAllocation(ss);
  setupTkcOutput(ss);
  setupOcrLog(ss);
  console.log('Bootstrap complete. Open the spreadsheet and verify tabs.');
}

function setupMasterDept(ss) {
  const name = CONFIG.TABS.M_DEPT;
  if (ss.getSheetByName(name)) { console.log(`${name} already exists, skipping`); return; }
  const s = ss.insertSheet(name);
  s.getRange('A1').setValue('部門マスタ。TKC部門コード正式値はPhase 0確認後に更新。');
  s.getRange('A2:D2').setValues([['部門コード', '部門名', 'TKC部門コード', '備考']]);
  s.getRange('A3:D8').setValues([
    ['001', 'Allure', 'TBD', '本店、戸田社長分もここ'],
    ['002', 'FONS', 'TBD', ''],
    ['003', 'IVY', 'TBD', ''],
    ['004', 'ICY', 'TBD', ''],
    ['005', 'NI', 'TBD', ''],
    ['007', 'Fivent', 'TBD', 'soshiji連動、duftはv1.1で追加']
  ]);
  s.getRange('A2:D2').setFontWeight('bold').setBackground('#e0e0e0');
}

function setupMasterUser(ss) {
  const name = CONFIG.TABS.M_USER;
  if (ss.getSheetByName(name)) { console.log(`${name} already exists, skipping`); return; }
  const s = ss.insertSheet(name);
  s.getRange('A1').setValue('使用者マスタ。ファイル名から抽出した使用者IDを部門コードに紐づける。');
  s.getRange('A2:D2').setValues([['使用者ID', '表示名', '部門コード', 'ファイル名キー']]);
  s.getRange('A3:D8').setValues([
    ['戸田', '戸田社長', '001', '戸田'],
    ['NI', 'NIスタッフ共通', '005', 'NI / ni / Ni'],
    ['IVY', 'IVYスタッフ共通', '003', 'IVY / Ivy / ivy'],
    ['ICY', 'ICYスタッフ共通', '004', 'ICY / Icy / icy'],
    ['FONS', 'FONSスタッフ共通', '002', 'FONS / Fons / fons'],
    ['Allure', 'Allureスタッフ共通', '001', 'Allure / allure / ALLURE']
  ]);
  s.getRange('A2:D2').setFontWeight('bold').setBackground('#e0e0e0');
}

function setupMasterAccount(ss) {
  const name = CONFIG.TABS.M_ACCOUNT;
  if (ss.getSheetByName(name)) { console.log(`${name} already exists, skipping`); return; }
  const s = ss.insertSheet(name);
  s.getRange('A1').setValue('科目マスタ。支払先パターンに部分一致で勘定科目を決定。先頭一致から順に評価。');
  s.getRange('A2:E2').setValues([['パターン（部分一致）', '勘定科目', '科目コード', '税区分', '信頼度']]);
  s.getRange('A3:E15').setValues([
    ['マツモトキヨシ', '消耗品費', 'TBD', '課仕10%', '高'],
    ['スギ薬局', '消耗品費', 'TBD', '課仕10%', '高'],
    ['JR', '旅費交通費', 'TBD', '不課税', '高'],
    ['東急電鉄', '旅費交通費', 'TBD', '不課税', '高'],
    ['東京地下鉄', '旅費交通費', 'TBD', '不課税', '高'],
    ['パスモ', '旅費交通費', 'TBD', '不課税', '高'],
    ['ASKUL', '消耗品費', 'TBD', '課仕10%', '高'],
    ['アクセスオンライン', '通信費', 'TBD', '課仕10%', '高'],
    ['ULTOWA office', '仕入費', 'TBD', '課仕10%', '高'],
    ['ファイブ表参道', '仕入費', 'TBD', '課仕10%', '高'],
    ['サンレンタオル', '仕入費', 'TBD', '課仕10%', '高'],
    ['プリントパック', '広告宣伝費', 'TBD', '課仕10%', '高'],
    ['きくや美粧堂', '仕入費', 'TBD', '課仕10%', '高']
  ]);
  s.getRange('A2:E2').setFontWeight('bold').setBackground('#e0e0e0');
}

function setupMasterAllocation(ss) {
  const name = CONFIG.TABS.M_ALLOC;
  if (ss.getSheetByName(name)) { console.log(`${name} already exists, skipping`); return; }
  const s = ss.insertSheet(name);
  s.getRange('A1').setValue('按分マスタ。指定支払先は要確認フラグを立てる（実按分はv2、当面手作業）。');
  s.getRange('A2:C2').setValues([['支払先', '按分パターン', '配分']]);
  s.getRange('A3:C5').setValues([
    ['サンレンタオル', '4店按分', 'Allure/FONS/IVY/ICY 金額別'],
    ['ASKUL', '使用者按分', 'F列の使用者値をそのまま部門に'],
    ['きくや美粧堂', 'Fivent按分', '戸田社長確認後に設定']
  ]);
  s.getRange('A2:C2').setFontWeight('bold').setBackground('#e0e0e0');
}

function setupTkcOutput(ss) {
  const name = CONFIG.TABS.TKC_OUTPUT;
  if (ss.getSheetByName(name)) { console.log(`${name} already exists, skipping`); return; }
  const s = ss.insertSheet(name);
  s.getRange('A1').setValue('TKC FX2 取込CSVソース。Allure経費を関数ミラー＋マスタJOINで補完。GAS書き込み禁止、人手編集禁止。');
  s.getRange('A2:K2').setValues([[
    '元行', '仕訳日付', '借方科目コード', '借方部門コード', '借方税区分',
    '借方金額', '貸方科目コード', '貸方金額', '摘要', '証憑番号', 'TKC'
  ]]);
  // A3にARRAYFORMULA：Allure経費の各行をミラー
  // 注: B-K列はVLOOKUPで個別に組む。1セルの大ARRAYFORMULAより、列ごとARRAYFORMULAの方が
  // 数式の保守がしやすい。
  s.getRange('A3').setFormula(`=ARRAYFORMULA(IF(Allure経費!A3:A="", "", Allure経費!A3:A))`);
  s.getRange('B3').setFormula(`=ARRAYFORMULA(IF(Allure経費!A3:A="", "", Allure経費!B3:B))`);
  s.getRange('C3').setFormula(`=ARRAYFORMULA(IF(Allure経費!A3:A="", "", IFERROR(VLOOKUP(Allure経費!D3:D, _科目マスタ!B:C, 2, FALSE), "")))`);
  s.getRange('D3').setFormula(`=ARRAYFORMULA(IF(Allure経費!A3:A="", "", IFERROR(VLOOKUP(Allure経費!F3:F, _使用者マスタ!A:C, 3, FALSE), "")))`);
  s.getRange('E3').setFormula(`=ARRAYFORMULA(IF(Allure経費!A3:A="", "", IFERROR(VLOOKUP(Allure経費!D3:D, _科目マスタ!B:D, 3, FALSE), "")))`);
  s.getRange('F3').setFormula(`=ARRAYFORMULA(IF(Allure経費!A3:A="", "", Allure経費!E3:E))`);
  s.getRange('G3').setFormula(`=ARRAYFORMULA(IF(Allure経費!A3:A="", "", "1110"))`);
  s.getRange('H3').setFormula(`=ARRAYFORMULA(IF(Allure経費!A3:A="", "", Allure経費!E3:E))`);
  s.getRange('I3').setFormula(`=ARRAYFORMULA(IF(Allure経費!A3:A="", "", Allure経費!C3:C & "／" & Allure経費!F3:F))`);
  s.getRange('J3').setFormula(`=ARRAYFORMULA(IF(Allure経費!A3:A="", "", IFERROR(REGEXEXTRACT(Allure経費!G3:G, "[^/]+$"), "")))`);
  s.getRange('K3').setFormula(`=ARRAYFORMULA(IF(Allure経費!A3:A="", "", Allure経費!H3:H))`);
  s.getRange('A2:K2').setFontWeight('bold').setBackground('#e0e0e0');
}

function setupOcrLog(ss) {
  const name = CONFIG.TABS.OCR_LOG;
  if (ss.getSheetByName(name)) { console.log(`${name} already exists, skipping`); return; }
  const s = ss.insertSheet(name);
  s.getRange('A1').setValue('OCR処理ログ。日次OCRの成功・失敗・重複・要確認をすべて記録。');
  s.getRange('A2:G2').setValues([[
    '時刻', 'Drive ID', 'ファイル名', '結果', '信頼度', '追加行', 'エラー'
  ]]);
  s.getRange('A2:G2').setFontWeight('bold').setBackground('#e0e0e0');
}
