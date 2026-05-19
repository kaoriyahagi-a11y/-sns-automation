/**
 * 領収書PDFのファイル名から使用者・期間・indexを抽出する純関数。
 *
 * 期待フォーマット: 「領収書（{使用者}）{期間}{丸数字}.pdf」
 *   例: 「領収書（戸田）25.10上③.pdf」 → {user: '戸田', period: '25.10上', index: 3}
 *
 * 使用者の正規化: 大文字小文字を吸収し、既知のユーザーIDに正規化（NI/IVY/ICY/FONS/Allure/戸田）。
 *
 * @param {string} filename - PDFファイル名（拡張子含む）
 * @returns {{user: string|null, period: string|null, index: number|null}}
 */
function parseFilename(filename) {
  const KNOWN_USERS = {
    'NI': 'NI', 'ni': 'NI', 'Ni': 'NI',
    'IVY': 'IVY', 'Ivy': 'IVY', 'ivy': 'IVY',
    'ICY': 'ICY', 'Icy': 'ICY', 'icy': 'ICY',
    'FONS': 'FONS', 'Fons': 'FONS', 'fons': 'FONS',
    'Allure': 'Allure', 'allure': 'Allure', 'ALLURE': 'Allure',
    '戸田': '戸田'
  };
  const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

  const match = filename.match(/領収書（([^）]+)）([0-9.上中下]+?)([①-⑳])?\.pdf$/);
  if (!match) return {user: null, period: null, index: null};

  const rawUser = match[1];
  const user = KNOWN_USERS[rawUser] || null;
  const period = match[2];
  const indexChar = match[3];
  const index = indexChar ? CIRCLED.indexOf(indexChar) + 1 : null;

  return {user, period, index};
}
