/**
 * 使用者 → 部門コード を引く。
 * @param {string} user - parseFilename().user
 * @param {Array<Array<string>>} userMasterRows - _使用者マスタ の全行（ヘッダ込み）
 * @returns {string|null} 部門コード
 */
function classifyDepartment(user, userMasterRows) {
  if (!user) return null;
  for (let i = 1; i < userMasterRows.length; i++) {
    const row = userMasterRows[i];
    if (row[0] === user) return row[2] || null;
  }
  return null;
}

/**
 * 支払先文字列 → 勘定科目を部分一致で引く。
 * @param {string} payee - DocAIで抽出された支払先
 * @param {Array<Array<string>>} accountMasterRows - _科目マスタ の全行（ヘッダ込み）
 * @returns {{account: string|null, accountCode: string|null, taxCode: string|null, confidence: string|null}}
 */
function classifyAccount(payee, accountMasterRows) {
  if (!payee) return {account: null, accountCode: null, taxCode: null, confidence: null};
  for (let i = 1; i < accountMasterRows.length; i++) {
    const [pattern, account, accountCode, taxCode, confidence] = accountMasterRows[i];
    if (pattern && payee.indexOf(pattern) >= 0) {
      return {account, accountCode, taxCode, confidence};
    }
  }
  return {account: null, accountCode: null, taxCode: null, confidence: null};
}

/**
 * 按分対象か判定する。
 * @param {string} payee
 * @param {number} amount
 * @param {Array<Array<string>>} allocMasterRows - _按分マスタ の全行
 * @returns {{required: boolean, pattern: string|null, config: string|null}}
 */
function classifyAllocation(payee, amount, allocMasterRows) {
  if (!payee) return {required: false, pattern: null, config: null};
  for (let i = 1; i < allocMasterRows.length; i++) {
    const [allocPayee, pattern, config] = allocMasterRows[i];
    if (allocPayee && payee.indexOf(allocPayee) >= 0) {
      return {required: true, pattern, config};
    }
  }
  return {required: false, pattern: null, config: null};
}
