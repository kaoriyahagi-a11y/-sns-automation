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
