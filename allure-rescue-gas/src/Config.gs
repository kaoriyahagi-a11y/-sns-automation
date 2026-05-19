/**
 * グローバル設定定数。
 * スクリプトプロパティ依存値は getServiceAccountKey() のみ。
 */

const CONFIG = {
  SHEET_ID: '1BNI4MP40iNqVOEX9ecxkXgIhjpxrKbw6ECSYBEiJtNg',
  DRIVE_ROOT_FOLDER_ID: '1horqj0rzTvDLpLNVE91F8qoGncVhA9Fp',
  DOCAI: {
    PROJECT_ID: 'receipt-ocr-493416',
    LOCATION: 'us',
    PROCESSOR_ID: '260618b8e03af14b'
  },
  TABS: {
    LEDGER: 'Allure経費',
    TKC_OUTPUT: '_TKC出力',
    M_DEPT: '_部門マスタ',
    M_USER: '_使用者マスタ',
    M_ACCOUNT: '_科目マスタ',
    M_ALLOC: '_按分マスタ',
    OCR_LOG: '_OCRログ'
  },
  NOTIFY_EMAIL: 'orika.co.ltd@gmail.com',
  CSV_OUTPUT_FOLDER_NAME: 'TKC仕訳CSV',
  PROCESS_TIMESTAMP_KEY: 'lastProcessedTimestamp'
};

/**
 * サービスアカウント鍵をスクリプトプロパティから取得。
 * 初回セットアップ時に手動で SA_JSON プロパティに JSON 全文を貼り付けておくこと。
 */
function getServiceAccountKey() {
  const json = PropertiesService.getScriptProperties().getProperty('SA_JSON');
  if (!json) throw new Error('SA_JSON script property not set. See README.');
  return JSON.parse(json);
}
