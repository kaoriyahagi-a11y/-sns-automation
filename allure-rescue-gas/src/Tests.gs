/**
 * GAS用テスト基盤。pytest は使えないので自前で assertion を持つ。
 * 各テスト関数は test* で始め、runAllTests() から自動収集される。
 */

class AssertionError extends Error {}

function assertEqual(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new AssertionError(
      `${msg || 'assertEqual'} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new AssertionError(msg || 'assertTrue failed');
}

function assertFalse(cond, msg) {
  if (cond) throw new AssertionError(msg || 'assertFalse failed');
}

function assertThrows(fn, expectedMessageSubstring, msg) {
  try {
    fn();
  } catch (e) {
    if (expectedMessageSubstring && e.message.indexOf(expectedMessageSubstring) < 0) {
      throw new AssertionError(
        `${msg || 'assertThrows'} — expected error containing "${expectedMessageSubstring}", got "${e.message}"`
      );
    }
    return;
  }
  throw new AssertionError(`${msg || 'assertThrows'} — function did not throw`);
}

/**
 * Apps Script エディタからこの関数を実行するとログに結果が出る。
 * グローバル名前空間の test* 関数すべてを実行する。
 */
function runAllTests() {
  const results = [];
  const tests = Object.keys(this)
    .filter(k => k.startsWith('test') && typeof this[k] === 'function');
  for (const name of tests) {
    try {
      this[name]();
      results.push({name, status: 'PASS'});
    } catch (e) {
      results.push({name, status: 'FAIL', error: e.message});
    }
  }
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  console.log(`\n=== ${pass} passed, ${fail} failed (${results.length} total) ===\n`);
  for (const r of results) {
    if (r.status === 'PASS') console.log(`  ✅ ${r.name}`);
    else console.log(`  ❌ ${r.name}: ${r.error}`);
  }
  return {pass, fail, total: results.length};
}

// === FilenameParser tests ===

function testParseFilename_TodaSocho() {
  const r = parseFilename('領収書（戸田）25.10上③.pdf');
  assertEqual(r.user, '戸田');
  assertEqual(r.period, '25.10上');
  assertEqual(r.index, 3);
}

function testParseFilename_NI() {
  const r = parseFilename('領収書（NI）25.10下②.pdf');
  assertEqual(r.user, 'NI');
  assertEqual(r.period, '25.10下');
  assertEqual(r.index, 2);
}

function testParseFilename_IvyLowerCase() {
  const r = parseFilename('領収書（ivy）26.04①.pdf');
  assertEqual(r.user, 'IVY');
  assertEqual(r.period, '26.04');
  assertEqual(r.index, 1);
}

function testParseFilename_NoIndex() {
  const r = parseFilename('領収書（戸田）26.05.pdf');
  assertEqual(r.user, '戸田');
  assertEqual(r.period, '26.05');
  assertEqual(r.index, null);
}

function testParseFilename_UnknownUser() {
  const r = parseFilename('領収書（誰か）26.05.pdf');
  assertEqual(r.user, null);
  assertEqual(r.period, '26.05');
}

function testParseFilename_NoPattern() {
  const r = parseFilename('完全に意味不明.pdf');
  assertEqual(r.user, null);
  assertEqual(r.period, null);
  assertEqual(r.index, null);
}

// === Classifiers tests ===

function testClassifyDepartment_Known() {
  const m = [
    ['使用者ID', '表示名', '部門コード'],
    ['戸田', '戸田社長', '001'],
    ['NI', 'NIスタッフ', '005']
  ];
  assertEqual(classifyDepartment('戸田', m), '001');
  assertEqual(classifyDepartment('NI', m), '005');
}

function testClassifyDepartment_Unknown() {
  const m = [['使用者ID', '表示名', '部門コード'], ['戸田', '戸田社長', '001']];
  assertEqual(classifyDepartment('知らない人', m), null);
  assertEqual(classifyDepartment(null, m), null);
}

function testClassifyAccount_PartialMatch() {
  const m = [
    ['パターン', '勘定科目', '科目コード', '税区分', '信頼度'],
    ['マツモトキヨシ', '消耗品費', '7110', '課仕10%', '高'],
    ['JR', '旅費交通費', '7210', '不課税', '高']
  ];
  const r1 = classifyAccount('マツモトキヨシ薬局 渋谷店', m);
  assertEqual(r1.account, '消耗品費');
  assertEqual(r1.taxCode, '課仕10%');
  assertEqual(r1.confidence, '高');

  const r2 = classifyAccount('JR東日本 自動券売機', m);
  assertEqual(r2.account, '旅費交通費');
}

function testClassifyAccount_NoMatch() {
  const m = [['パターン', '勘定科目', '科目コード', '税区分', '信頼度']];
  const r = classifyAccount('未知の支払先', m);
  assertEqual(r.account, null);
  assertEqual(r.confidence, null);
}

function testClassifyAllocation_Required() {
  const m = [
    ['支払先', '按分パターン', '配分'],
    ['サンレンタオル', '4店按分', 'Allure/FONS/IVY/ICY']
  ];
  const r = classifyAllocation('サンレンタオル', 12000, m);
  assertTrue(r.required);
  assertEqual(r.pattern, '4店按分');
}

function testClassifyAllocation_NotRequired() {
  const m = [['支払先', '按分パターン', '配分'], ['サンレンタオル', '4店按分', 'Allure/FONS/IVY/ICY']];
  const r = classifyAllocation('セブンイレブン', 500, m);
  assertFalse(r.required);
}

// === Ledger tests ===

function testIsDuplicate_Match() {
  const existing = [
    ['NO', '収日', '支払先', '勘定科目', '金額', '使用者', 'リンク', 'TKC', '備考'],
    [1, '2026-05-10', 'マツモトキヨシ', '消耗品費', 1200, '戸田', 'url', false, '']
  ];
  assertTrue(isDuplicateInRows('2026-05-10', 1200, 'マツモトキヨシ薬局', existing));
}

function testIsDuplicate_NoMatch_DifferentDate() {
  const existing = [
    ['NO', '収日', '支払先', '勘定科目', '金額', '使用者', 'リンク', 'TKC', '備考'],
    [1, '2026-05-10', 'マツモトキヨシ', '消耗品費', 1200, '戸田', 'url', false, '']
  ];
  assertFalse(isDuplicateInRows('2026-05-11', 1200, 'マツモトキヨシ', existing));
}

function testIsDuplicate_NoMatch_DifferentAmount() {
  const existing = [
    ['NO', '収日', '支払先', '勘定科目', '金額', '使用者', 'リンク', 'TKC', '備考'],
    [1, '2026-05-10', 'マツモトキヨシ', '消耗品費', 1200, '戸田', 'url', false, '']
  ];
  assertFalse(isDuplicateInRows('2026-05-10', 1500, 'マツモトキヨシ', existing));
}

function testIsDuplicate_NoMatch_DifferentPayee() {
  const existing = [
    ['NO', '収日', '支払先', '勘定科目', '金額', '使用者', 'リンク', 'TKC', '備考'],
    [1, '2026-05-10', 'マツモトキヨシ', '消耗品費', 1200, '戸田', 'url', false, '']
  ];
  assertFalse(isDuplicateInRows('2026-05-10', 1200, '別の店', existing));
}
