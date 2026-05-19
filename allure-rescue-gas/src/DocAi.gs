/**
 * Document AI REST client。サービスアカウント鍵でJWTを発行→OAuth2 access tokenを取得→
 * processor を REST で叩く。
 */

/** Google OAuth2 access token をサービスアカウント鍵から取得。 */
function getAccessToken() {
  const sa = getServiceAccountKey();
  const now = Math.floor(Date.now() / 1000);
  const header = {alg: 'RS256', typ: 'JWT'};
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const toB64Url = obj => Utilities.base64EncodeWebSafe(
    typeof obj === 'string' ? obj : JSON.stringify(obj)
  ).replace(/=+$/, '');
  const headerB64 = toB64Url(header);
  const claimB64 = toB64Url(claim);
  const signInput = headerB64 + '.' + claimB64;
  const sig = Utilities.computeRsaSha256Signature(signInput, sa.private_key);
  const sigB64 = Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
  const assertion = signInput + '.' + sigB64;

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion
    },
    muteHttpExceptions: true
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error('OAuth2 token exchange failed: ' + res.getContentText());
  }
  return body.access_token;
}

/**
 * Document AI processor を叩いて PDF blob から構造化データを取得。
 * @param {GoogleAppsScript.Base.Blob} pdfBlob - DriveApp.getFileById(id).getBlob() で取れる Blob
 * @returns {{date: string|null, totalAmount: number|null, payee: string|null, raw: Object}}
 */
function processDocument(pdfBlob) {
  const token = getAccessToken();
  const url = `https://${CONFIG.DOCAI.LOCATION}-documentai.googleapis.com/v1/projects/${CONFIG.DOCAI.PROJECT_ID}/locations/${CONFIG.DOCAI.LOCATION}/processors/${CONFIG.DOCAI.PROCESSOR_ID}:process`;
  const payload = {
    rawDocument: {
      content: Utilities.base64Encode(pdfBlob.getBytes()),
      mimeType: 'application/pdf'
    }
  };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + token},
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('DocAI failed: ' + res.getResponseCode() + ' ' + res.getContentText().substring(0, 500));
  }
  const body = JSON.parse(res.getContentText());
  return extractEntities(body.document);
}

/** DocAI のレスポンスから日付・金額・支払先を抽出。 */
function extractEntities(doc) {
  const result = {date: null, totalAmount: null, payee: null, raw: doc};
  if (!doc.entities) return result;
  for (const e of doc.entities) {
    const t = e.type;
    const v = e.mentionText || (e.normalizedValue && e.normalizedValue.text) || null;
    if (!v) continue;
    if (t === 'receipt_date' || t === 'date') {
      // normalize to YYYY-MM-DD if normalized exists
      if (e.normalizedValue && e.normalizedValue.dateValue) {
        const d = e.normalizedValue.dateValue;
        result.date = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
      } else {
        result.date = v;
      }
    } else if (t === 'total_amount' || t === 'total' || t === 'amount') {
      const num = parseFloat(String(v).replace(/[,¥￥円\s]/g, ''));
      if (!isNaN(num)) result.totalAmount = num;
    } else if (t === 'supplier_name' || t === 'merchant_name' || t === 'payee') {
      result.payee = v;
    }
  }
  return result;
}

/**
 * 手動テスト用。Apps Scriptエディタから 1 ファイルだけ処理してみる。
 * @param {string} fileId - 領収書PDFのDrive ID
 */
function smokeTestDocAi(fileId) {
  const blob = DriveApp.getFileById(fileId).getBlob();
  const r = processDocument(blob);
  console.log('DocAI result:', JSON.stringify(r, null, 2));
  return r;
}
