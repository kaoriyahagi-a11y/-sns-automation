# Allure経理救援 v2 Plan 1: GAS+Sheets基盤 (C1 + C4 minimal viable) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 領収書PDFをDriveに置くだけで「Allure経費」シートに自動行追加され、矢萩さんがメニュー実行すると `_TKC出力` 由来のCSVがDriveに保存される、GAS+Sheets完結のMVPを稼働可能にする。バックテストで勘定科目判定90%、5月実データのシャドー運用で差分5%以下を確認。

**Architecture:** ローカルリポ `allure-rescue-gas/` で `.gs` ファイル群を版管理し、Apps Scriptプロジェクト（「Allure経費」スプレッドシート `1BNI4MP40iNqVOEX9ecxkXgIhjpxrKbw6ECSYBEiJtNg` に bound）にコピー反映。Document AIはサービスアカウントJWT認証でREST直叩き。シートはマニュアル準拠の9列構造を維持し、`_TKC出力` タブで ARRAYFORMULA + VLOOKUP の関数ミラーでコード付与。Claude/AI ランタイム依存ゼロ。

**Tech Stack:**
- Google Apps Script V8 (`.gs` ファイル、appsscript.json マニフェスト)
- Google Document AI REST API (processor `260618b8e03af14b` 流用)
- Google Sheets API (SpreadsheetApp 経由)
- Google Drive API (DriveApp 経由)
- Gmail API (GmailApp 経由)
- 認証: サービスアカウント `receipt-bot@receipt-ocr-493416.iam.gserviceaccount.com` のJWTを GAS から発行→OAuth2 access token 取得→Document AI 叩く
- 既存資産:
  - スプシ: `1BNI4MP40iNqVOEX9ecxkXgIhjpxrKbw6ECSYBEiJtNg`（「Allure経費」母艦）
  - Driveルート: `1horqj0rzTvDLpLNVE91F8qoGncVhA9Fp`（美容室Allure）
  - DocAI Processor: `260618b8e03af14b` (us, レシート処理用)
  - サービスアカウント鍵: `C:\Users\orika\Downloads\receipt-ocr-493416-99159478bf10.json`
- 参考実装: `receipt-ocr/main.py`（Python版、本Planでは手を入れない）

**Scope (Plan 1):** Stage 0（Phase 0文書） + Stage 1〜10（コード実装＋シャドー運用準備）+ Stage 11（運用マニュアル）。

**Scope (Plan 2/3、未作成):**
- Plan 2: C2 大型支払（通帳・カード明細パース＋ルール分類）、C3 仕入請求書OCR（6社パターン）
- Plan 3: 給与シート改善（`allure-payroll/` Plan 1 と統合検討）、TKC CSV 仕様確定後のスキーマfix

---

## ファイル構造（Plan 1で作成）

```
allure-rescue-gas/
├── README.md
├── .gitignore
├── appsscript.json
├── src/
│   ├── Config.gs
│   ├── Bootstrap.gs
│   ├── DocAi.gs
│   ├── FilenameParser.gs
│   ├── Classifiers.gs
│   ├── Ledger.gs
│   ├── ReceiptPipeline.gs
│   ├── TkcExporter.gs
│   ├── Triggers.gs
│   ├── Notify.gs
│   ├── Logger.gs
│   └── Tests.gs
└── docs/
    ├── phase0-questions.md
    └── operation-manual.md
```

各ファイルの責務：
- `Config.gs`: 定数（スプシID、DriveフォルダID、Processor ID等）と `getServiceAccountKey()` 読込
- `Bootstrap.gs`: 一回実行で必要なタブ4種＋`_TKC出力`＋`_OCRログ`を作る `bootstrapSheets()`
- `DocAi.gs`: JWT署名→OAuthトークン取得→Document AI REST 叩く `processDocument(pdfBlob)`
- `FilenameParser.gs`: 純関数 `parseFilename(name)` → `{使用者, 期間, index}`
- `Classifiers.gs`: 純関数 `classifyDepartment(user)` / `classifyAccount(payee)` / `classifyAllocation(payee, amount)`
- `Ledger.gs`: `appendRow(row)` / `isDuplicate(date, amount, payee)` シート操作
- `ReceiptPipeline.gs`: `processDailyReceipts()` オーケストレータ
- `TkcExporter.gs`: `exportTkcCsv()` → Driveに保存
- `Triggers.gs`: `onOpen()` メニュー登録、`setupTimeTrigger()` cron設定
- `Notify.gs`: `notifyDailySummary(report)` Gmail送信
- `Logger.gs`: `_OCRログ` への append
- `Tests.gs`: `assertEqual()` 等のassertion + `runAllTests()`

---

## Stage 0: Phase 0文書テンプレ

### Task 0.1: 矢萩さんが税理士・社長に送れる確認事項テンプレを作成

**Files:**
- Create: `allure-rescue-gas/docs/phase0-questions.md`

- [ ] **Step 1: ディレクトリ作成**

Run: `New-Item -ItemType Directory -Force allure-rescue-gas/docs, allure-rescue-gas/src`

Expected: フォルダ3つが存在する状態（`allure-rescue-gas/`, `allure-rescue-gas/docs/`, `allure-rescue-gas/src/`）

- [ ] **Step 2: phase0-questions.md 作成**

```markdown
# Allure経理 Phase 0 確認事項

宛先: 福光税理士事務所 御中（**第1部**）／戸田社長（**第2部**）
発信: 株式会社ORI 矢萩香織
件名: 仕訳自動化Phase 1 着手にあたっての確認事項
日付: YYYY-MM-DD

---

## 第1部: 福光税理士事務所への確認

仕訳起票の自動化（領収書PDF→「Allure経費」シート→TKC FX2 CSV取込）を構築するにあたり、以下5点ご確認ください。

### Q1. TKC FX2クラウドの汎用CSV取込機能
- 御契約に含まれていますか？
- 含まれている場合、CSV取込のメニュー位置・操作手順をご教示ください

### Q2. CSVフォーマット仕様書
Q1が「あり」の場合、以下をご提供いただけますか：
- 列順・列名（ヘッダ仕様）
- コード体系（部門・勘定科目・税区分）
- サンプルCSVファイル（過去に正常取込された実例）

### Q3. 部門コード一覧
6店舗の正式部門コードをご教示ください：
- Allure / FONS / IVY / ICY / NI / Fivent
（duftは2026-04開始の新店舗、運用準備中のため後日確認）

### Q4. 勘定科目コード一覧
特に以下の科目について、TKC上の正式コードをご教示ください：
- 消耗品費
- 旅費交通費
- 会議費
- 通信費
- 租税公課
- カード支払
- 未払金
- 現金
- 仕入費
- 広告宣伝費
- 支払手数料

### Q5. 税区分コード一覧
- 課仕10%
- 課仕8%軽
- 不課税
- 非課税

---

## 第2部: 戸田社長への確認

### Q6. きくや美粧堂のFivent按分ルール
- 金額按分でしょうか、固定割合でしょうか？
- 過去の按分実績を1〜2件ご教示いただけると判定式を組めます

### Q7. クレディセゾン明細の勘定科目分類方針
- カード支払をTKC上どの勘定科目で計上していますか？
- 内訳ごとに分けている場合、その分類ルール

### Q8. duft店舗の運用状況
- 2026-04開始済みでしょうか？
- 開始済みの場合、TKC上の部門コードと、領収書の使用者表記ルール

---

## 回答方法
このファイルに直接回答を書き込み、矢萩までご返却ください（メール・チャットいずれでも）。
急ぎ確認したい項目には ⚠️ を付けています（Q2, Q3 が最優先）。
```

- [ ] **Step 3: コミット**

```bash
git add allure-rescue-gas/docs/phase0-questions.md
git commit -m "feat(allure-rescue-gas): Phase 0 question template for accountant and CEO"
```

---

## Stage 1: ローカルプロジェクト雛形

### Task 1.1: README, .gitignore, appsscript.json

**Files:**
- Create: `allure-rescue-gas/README.md`
- Create: `allure-rescue-gas/.gitignore`
- Create: `allure-rescue-gas/appsscript.json`

- [ ] **Step 1: README.md 作成**

```markdown
# Allure経理救援 GAS v2

「Allure経費」スプレッドシートに bound する Google Apps Script プロジェクト。
領収書PDFのOCR→シート行追加→TKC FX2 取込CSV出力までを自動化する。

## 関連ドキュメント
- 設計書: `../docs/superpowers/specs/2026-05-19-allure-rescue-gas-rewrite-design.md`
- 実装プラン: `../docs/superpowers/plans/2026-05-19-allure-rescue-gas-rewrite-plan1.md`
- マニュアルv0.1 (AS-IS): `../docs/allure-rescue/expense-manual-v0.1.md`

## 対象シート
- `1BNI4MP40iNqVOEX9ecxkXgIhjpxrKbw6ECSYBEiJtNg`（「Allure経費」スプレッドシート）

## デプロイ
本プロジェクトは Apps Script エディタへ手動コピーで反映する（clasp 未使用）。
1. 「Allure経費」スプシを開き、メニュー: 拡張機能 → Apps Script
2. `src/*.gs` の各ファイルを Apps Script エディタに同名で作成、内容を貼付
3. `appsscript.json` の中身を マニフェストエディタに貼付（左メニュー: プロジェクト設定 → 「appsscript.json マニフェスト ファイルをエディタで表示する」を有効化）
4. スクリプトプロパティに `SA_JSON` キーでサービスアカウントJSONを保存（プロジェクト設定 → スクリプト プロパティ）
5. 初回のみ `bootstrapSheets()` を1回実行（タブ作成）
6. `setupTimeTrigger()` を1回実行（毎日9時・21時のcron登録）

## 開発フロー
- ローカルで `.gs` を編集→ Apps Script エディタへコピペ
- テストは `Tests.gs::runAllTests()` を Apps Script エディタから実行
- 本番DocAI叩く前に `processOnePdfManually(driveFileId)` で1件テスト
```

- [ ] **Step 2: .gitignore 作成**

```
# Service account key (do NOT commit)
*.json
!appsscript.json

# IDE
.vscode/
.idea/
*.swp
```

- [ ] **Step 3: appsscript.json 作成**

```json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/script.send_mail",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}
```

- [ ] **Step 4: コミット**

```bash
git add allure-rescue-gas/README.md allure-rescue-gas/.gitignore allure-rescue-gas/appsscript.json
git commit -m "feat(allure-rescue-gas): project scaffolding (README, gitignore, manifest)"
```

---

## Stage 2: 設定とテスト基盤

### Task 2.1: Config.gs

**Files:**
- Create: `allure-rescue-gas/src/Config.gs`

- [ ] **Step 1: Config.gs 作成**

```javascript
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
```

- [ ] **Step 2: コミット**

```bash
git add allure-rescue-gas/src/Config.gs
git commit -m "feat(allure-rescue-gas): Config constants and SA key loader"
```

---

### Task 2.2: Tests.gs（assertion基盤）

**Files:**
- Create: `allure-rescue-gas/src/Tests.gs`

- [ ] **Step 1: Tests.gs 作成（assertions のみ、テスト関数は後続タスクで追加）**

```javascript
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
```

- [ ] **Step 2: コミット**

```bash
git add allure-rescue-gas/src/Tests.gs
git commit -m "feat(allure-rescue-gas): test framework (assertions + runAllTests)"
```

---

## Stage 3: ファイル名パーサ（純関数、TDD）

### Task 3.1: FilenameParser.gs

**Files:**
- Create: `allure-rescue-gas/src/FilenameParser.gs`
- Modify: `allure-rescue-gas/src/Tests.gs`（テスト追加）

- [ ] **Step 1: Tests.gs にテストを追加（追記）**

末尾に以下を追加：

```javascript
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
```

- [ ] **Step 2: Apps Scriptエディタで `runAllTests` 実行 → 6件 FAIL になることを確認**

期待: `parseFilename is not defined` で全FAIL

- [ ] **Step 3: FilenameParser.gs 実装**

```javascript
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
```

- [ ] **Step 4: Apps Scriptで `runAllTests` 実行 → 6件全PASS確認**

Expected: 全PASS

- [ ] **Step 5: コミット**

```bash
git add allure-rescue-gas/src/FilenameParser.gs allure-rescue-gas/src/Tests.gs
git commit -m "feat(allure-rescue-gas): FilenameParser with 6 unit tests"
```

---

## Stage 4: 分類器（純関数、TDD）

### Task 4.1: Classifiers.gs（部門・科目・按分）

**Files:**
- Create: `allure-rescue-gas/src/Classifiers.gs`
- Modify: `allure-rescue-gas/src/Tests.gs`（テスト追加）

- [ ] **Step 1: Tests.gs にテスト追加（末尾追記）**

```javascript
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
```

- [ ] **Step 2: テスト実行 → 6件FAIL確認**

- [ ] **Step 3: Classifiers.gs 実装**

```javascript
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
```

- [ ] **Step 4: テスト実行 → 6件全PASS確認**

- [ ] **Step 5: コミット**

```bash
git add allure-rescue-gas/src/Classifiers.gs allure-rescue-gas/src/Tests.gs
git commit -m "feat(allure-rescue-gas): Classifiers (dept, account, allocation) with 6 unit tests"
```

---

## Stage 5: シート初期化（Bootstrap）

### Task 5.1: Bootstrap.gs（シート構造＋マスタseed）

**Files:**
- Create: `allure-rescue-gas/src/Bootstrap.gs`

- [ ] **Step 1: Bootstrap.gs 作成**

```javascript
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
```

- [ ] **Step 2: コミット**

```bash
git add allure-rescue-gas/src/Bootstrap.gs
git commit -m "feat(allure-rescue-gas): Bootstrap.gs initializes 6 tabs with seeds"
```

注: 本タスクのコードは実シートで `bootstrapSheets()` を1回実行することで検証する（実行は別タスクで実施せず、デプロイ時に矢萩さんが手動実行）。

---

## Stage 6: Document AI クライアント

### Task 6.1: DocAi.gs（JWT auth + REST叩く）

**Files:**
- Create: `allure-rescue-gas/src/DocAi.gs`

- [ ] **Step 1: DocAi.gs 作成**

```javascript
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
```

- [ ] **Step 2: コミット**

```bash
git add allure-rescue-gas/src/DocAi.gs
git commit -m "feat(allure-rescue-gas): DocAi REST client with service account JWT auth"
```

注: 実機検証は別タスク（Stage 9 の smoke test）で行う。本タスクではコード完成のみ。

---

## Stage 7: Ledger（行追加と重複検知）

### Task 7.1: Ledger.gs

**Files:**
- Create: `allure-rescue-gas/src/Ledger.gs`
- Modify: `allure-rescue-gas/src/Tests.gs`

- [ ] **Step 1: Tests.gs にテスト追加（末尾）**

```javascript
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
```

- [ ] **Step 2: テスト実行 → 4件FAIL確認**

- [ ] **Step 3: Ledger.gs 実装**

```javascript
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
```

- [ ] **Step 4: テスト実行 → 4件全PASS確認**

- [ ] **Step 5: コミット**

```bash
git add allure-rescue-gas/src/Ledger.gs allure-rescue-gas/src/Tests.gs
git commit -m "feat(allure-rescue-gas): Ledger append + duplicate detection (4 tests)"
```

---

## Stage 8: ログとパイプライン

### Task 8.1: Logger.gs

**Files:**
- Create: `allure-rescue-gas/src/Logger.gs`

- [ ] **Step 1: Logger.gs 作成**

```javascript
/**
 * _OCRログ への追記。各PDF処理1件 = 1行。
 */
function logOcrEvent(driveId, filename, result, confidence, rowNum, errorMsg) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.TABS.OCR_LOG);
  sheet.appendRow([
    new Date(),
    driveId || '',
    filename || '',
    result,                           // 'success' | 'duplicate' | 'needs_review' | 'failure'
    confidence !== undefined ? confidence : '',
    rowNum || '',
    errorMsg || ''
  ]);
}
```

- [ ] **Step 2: コミット**

```bash
git add allure-rescue-gas/src/Logger.gs
git commit -m "feat(allure-rescue-gas): Logger writes OCR events to _OCRログ"
```

---

### Task 8.2: Notify.gs

**Files:**
- Create: `allure-rescue-gas/src/Notify.gs`

- [ ] **Step 1: Notify.gs 作成**

```javascript
/**
 * Gmail通知。日次サマリ／CSV出力完了／緊急アラート用。
 */

function notifyDailySummary(report) {
  const subject = `[Allure経理] 日次OCRサマリ ${Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MM/dd HH:mm')}`;
  const body = [
    'Allure経理 OCRパイプライン 日次レポート',
    '',
    `処理対象PDF数:      ${report.totalPdfs}`,
    `行追加（成功）:     ${report.added}`,
    `要確認:             ${report.needsReview}`,
    `重複スキップ:       ${report.duplicates}`,
    `失敗:               ${report.failures}`,
    '',
    `シート: https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/edit`,
    '',
    '要確認行はH列セルが黄色になっています。コメントの指示通り対応してください。'
  ].join('\n');
  GmailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, body);
}

function notifyCsvExport(csvUrl, rowCount) {
  const subject = `[Allure経理] TKC CSV出力完了 ${rowCount}行`;
  const body = [
    `TKC FX2 取込用CSVを出力しました。`,
    '',
    `行数: ${rowCount}`,
    `ダウンロード: ${csvUrl}`,
    '',
    'TKC FX2 にアップロードし、取込完了後にシート「Allure経費」H列を一括TRUEにしてください。'
  ].join('\n');
  GmailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, body);
}

function notifyError(context, errorMsg) {
  const subject = `[Allure経理] ⚠ エラー発生: ${context}`;
  const body = `エラーコンテキスト: ${context}\n\nメッセージ:\n${errorMsg}`;
  GmailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, body);
}
```

- [ ] **Step 2: コミット**

```bash
git add allure-rescue-gas/src/Notify.gs
git commit -m "feat(allure-rescue-gas): Notify daily summary, CSV export, error alerts"
```

---

### Task 8.3: ReceiptPipeline.gs

**Files:**
- Create: `allure-rescue-gas/src/ReceiptPipeline.gs`

- [ ] **Step 1: ReceiptPipeline.gs 作成**

```javascript
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
```

- [ ] **Step 2: コミット**

```bash
git add allure-rescue-gas/src/ReceiptPipeline.gs
git commit -m "feat(allure-rescue-gas): processDailyReceipts orchestrator + per-PDF logic"
```

---

## Stage 9: TKC CSV エクスポータ

### Task 9.1: TkcExporter.gs

**Files:**
- Create: `allure-rescue-gas/src/TkcExporter.gs`

- [ ] **Step 1: TkcExporter.gs 作成**

```javascript
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
```

- [ ] **Step 2: コミット**

```bash
git add allure-rescue-gas/src/TkcExporter.gs
git commit -m "feat(allure-rescue-gas): TKC CSV exporter (placeholder schema)"
```

---

## Stage 10: トリガとメニュー

### Task 10.1: Triggers.gs

**Files:**
- Create: `allure-rescue-gas/src/Triggers.gs`

- [ ] **Step 1: Triggers.gs 作成**

```javascript
/**
 * onOpen でカスタムメニュー登録、setupTimeTrigger で日次cron登録。
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('経理自動化')
    .addItem('🧾 領収書OCRを今すぐ実行', 'processDailyReceipts')
    .addItem('📤 TKC CSV出力', 'exportTkcCsv')
    .addSeparator()
    .addItem('▶ テスト実行（runAllTests）', 'runAllTests')
    .addItem('🛠 初回セットアップ（bootstrapSheets）', 'bootstrapSheets')
    .addItem('⏰ 時間トリガ設定（setupTimeTrigger）', 'setupTimeTrigger')
    .addToUi();
}

/** 毎日 9時 と 21時 に processDailyReceipts を実行するトリガを登録。 */
function setupTimeTrigger() {
  // 既存トリガをクリーンアップ
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processDailyReceipts')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('processDailyReceipts')
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();
  ScriptApp.newTrigger('processDailyReceipts')
    .timeBased()
    .atHour(21)
    .everyDays(1)
    .inTimezone('Asia/Tokyo')
    .create();
  SpreadsheetApp.getUi().alert('時間トリガ登録完了：毎日 9:00 と 21:00 に処理が走ります。');
}
```

- [ ] **Step 2: コミット**

```bash
git add allure-rescue-gas/src/Triggers.gs
git commit -m "feat(allure-rescue-gas): onOpen menu + setupTimeTrigger"
```

---

## Stage 11: 運用マニュアル＋シャドー運用ガイド

### Task 11.1: operation-manual.md

**Files:**
- Create: `allure-rescue-gas/docs/operation-manual.md`

- [ ] **Step 1: operation-manual.md 作成**

```markdown
# Allure経理救援 GAS 運用マニュアル

## 初回セットアップ（1回だけ）

### 1. Apps Script プロジェクト作成
1. 「Allure経費」スプシ（`1BNI4MP40iNqVOEX9ecxkXgIhjpxrKbw6ECSYBEiJtNg`）を開く
2. メニュー: 拡張機能 → Apps Script
3. プロジェクト名を「Allure経理救援」に変更

### 2. ファイル貼付
ローカル `allure-rescue-gas/src/` の各 `.gs` ファイルを Apps Script エディタに**同名**で作成・貼付：
- `Config.gs` → 新しいスクリプト → 名前変更
- `Bootstrap.gs` → 同上
- `DocAi.gs` / `FilenameParser.gs` / `Classifiers.gs` / `Ledger.gs` / `Logger.gs`
- `Notify.gs` / `ReceiptPipeline.gs` / `TkcExporter.gs` / `Triggers.gs` / `Tests.gs`

`appsscript.json` は左メニュー「プロジェクト設定」→「appsscript.json マニフェスト ファイルをエディタで表示する」を有効化してから貼付。

### 3. サービスアカウント鍵を Script Properties に登録
1. 左メニュー「プロジェクト設定」→ スクリプト プロパティ → 「スクリプト プロパティを追加」
2. プロパティ名: `SA_JSON`
3. 値: `C:\Users\orika\Downloads\receipt-ocr-493416-99159478bf10.json` の全文をコピーして貼付
4. 「スクリプト プロパティを保存」

### 4. シート初期化
1. Apps Scriptエディタの関数選択で `bootstrapSheets` を選択 → 実行
2. 初回は権限承認ダイアログが出る → 許可
3. スプシに戻り、新タブ6種（`_部門マスタ` `_使用者マスタ` `_科目マスタ` `_按分マスタ` `_TKC出力` `_OCRログ`）が作成されたことを確認

### 5. 時間トリガ登録
1. スプシのメニュー「経理自動化」→ 「⏰ 時間トリガ設定」をクリック
2. 「時間トリガ登録完了」のダイアログが出ればOK

### 6. テスト実行
1. メニュー「経理自動化」→ 「▶ テスト実行」
2. View → Logs（または「実行ログ」）で全PASS確認

## 日次運用

### 朝のルーチン（5分）
1. Gmail で「[Allure経理] 日次OCRサマリ」を確認
2. 「要確認: N件」が0でなければ、スプシで「Allure経費」を開く
3. H列が**黄色**の行をフィルタ
4. 各行で：
   - セルコメントを読む（指示が書いてある）
   - 指示に従って修正（マスタに追加 / 内容修正）
   - 修正後、H列セルの背景色を白に戻す（書式 → 塗りつぶしの色 → なし）

### マスタ更新パターン
- **使用者抽出失敗**：F列に手動で正しい使用者を入れる → `_使用者マスタ` にファイル名キーを追加して次回から自動化
- **科目推定失敗**：D列に手動で勘定科目 → `_科目マスタ` に支払先パターン追加
- **按分要**：v1では手作業で行を分割（按分先ごとに行追加、リンク同じ）

## 月次運用（翌月の月初）

### TKC CSV出力（翌月6〜8日）
1. シートで「Allure経費」のH列が空（=未取込）かつ 黄色でない 行が出力対象
2. メニュー「経理自動化」→ 「📤 TKC CSV出力」
3. ダイアログに「CSV出力完了：N行」が出る
4. Gmail で「[Allure経理] TKC CSV出力完了」を確認
5. リンクからCSVをダウンロード
6. TKC FX2 にログイン → CSV取込 → アップロード
7. TKC取込成功後、スプシに戻り、出力対象だった行のH列を一括 TRUE に変更

### 月次締め（翌月8〜10日）
1. TKC FX2 で月次試算表を生成
2. 顧問税理士・福光事務所に送付
3. 修正指示があればシート遡及修正→再CSV出力→再取込

## トラブルシューティング

### Q1. OCR が「失敗」と出る
- `_OCRログ` の最新行を見て エラー列を確認
- PDF が壊れている／パスワード保護されている → スタッフに再アップロード依頼
- DocAI が unauthorized 系エラー → `SA_JSON` プロパティが正しいか確認

### Q2. 同じ領収書が2回入った
- 重複検知は日付×金額×支払先一致で判定。OCR読取で支払先表記が違うと別物と認識される可能性
- 手動で1行削除＋ `_OCRログ` で原因確認

### Q3. CSV出力で「対象行なし」と出る
- 全行がH列=TRUE（取込済）または要確認（黄色）になっている可能性
- フィルタで未取込行があるか確認

### Q4. TKC取込でエラー
- TKC側のメッセージを矢萩さんが見て、シートの該当列を修正→再エクスポート
- 取込済みの行は誤って再出力しないよう、H列の管理を慎重に
```

- [ ] **Step 2: コミット**

```bash
git add allure-rescue-gas/docs/operation-manual.md
git commit -m "docs(allure-rescue-gas): operation manual for matsuhagi-san"
```

---

### Task 11.2: シャドー運用ガイド（5月実データでの並走テスト）

**Files:**
- Modify: `allure-rescue-gas/docs/operation-manual.md`

- [ ] **Step 1: operation-manual.md の末尾に追記**

```markdown

## シャドー運用（Week 3, 5月実データでの並走テスト）

本番切替前に1ヶ月分のシャドー運用で誤差を確認する。

### 手順
1. スプシに `_Shadow_5月` タブを手動作成（既存「Allure経費」とは別タブ）
2. `_Shadow_5月` のヘッダを「Allure経費」と同じ A:I で作成
3. **設定変更**：Apps Script で `Config.gs` の `CONFIG.TABS.LEDGER` を `'_Shadow_5月'` に書き換え（一時）
4. 5月の領収書PDFを Drive に投入（既に投入済みなら `lastProcessedTimestamp` プロパティを 2026-04-30 に手動セット）
5. メニュー「🧾 領収書OCRを今すぐ実行」を手動実行
6. `_Shadow_5月` に行が追加されることを確認
7. 矢萩さんが従来通り手入力したシート（仮称 `Allure経費_5月_人手`）と並べて差分集計：
   - 件数差
   - 金額差（絶対値合計）
   - 勘定科目誤分類率
   - 部門誤推定率
8. **合格基準**：差分5%以下／致命的誤り（金額大幅誤読、誤勘定）ゼロ
9. 合格なら `Config.gs` の `CONFIG.TABS.LEDGER` を `'Allure経費'` に戻して本番切替

### 差分集計用スプシ関数
別タブ `_Shadow_差分` を作り、以下を入れる：
```
A1: =COUNTA(_Shadow_5月!A3:A) - COUNTA(Allure経費_5月_人手!A3:A)    // 件数差
B1: =SUM(_Shadow_5月!E3:E) - SUM(Allure経費_5月_人手!E3:E)          // 金額差
```
（詳細な勘定科目別の混同行列は Phase 1完了後の改善で）
```

- [ ] **Step 2: コミット**

```bash
git add allure-rescue-gas/docs/operation-manual.md
git commit -m "docs(allure-rescue-gas): shadow run guide for May parallel test"
```

---

## Plan 1 完了基準

- ☑ Stage 0: Phase 0質問文書（Task 0.1）→ 矢萩さんが税理士・社長に送付できる状態
- ☑ Stage 1: ローカルプロジェクト雛形（Task 1.1）
- ☑ Stage 2: Config.gs + Tests.gs（Task 2.1-2.2）
- ☑ Stage 3: FilenameParser.gs + 6 unit tests PASS（Task 3.1）
- ☑ Stage 4: Classifiers.gs + 6 unit tests PASS（Task 4.1）
- ☑ Stage 5: Bootstrap.gs（Task 5.1）
- ☑ Stage 6: DocAi.gs（Task 6.1）
- ☑ Stage 7: Ledger.gs + 4 unit tests PASS（Task 7.1）
- ☑ Stage 8: Logger.gs + Notify.gs + ReceiptPipeline.gs（Task 8.1-8.3）
- ☑ Stage 9: TkcExporter.gs（Task 9.1）
- ☑ Stage 10: Triggers.gs（Task 10.1）
- ☑ Stage 11: 運用マニュアル＋シャドー運用ガイド（Task 11.1-11.2）

## Plan 1 完了後のアクション（Apps Scriptへのデプロイは別タスク）

1. 矢萩さんが Phase 0 質問テンプレを送付（順次回答が入ってきたら `_部門マスタ` `_科目マスタ` の TBD を埋める）
2. 矢萩さんが Apps Script に手動コピー反映（operation-manual.md の手順）
3. `bootstrapSheets()` 実行 → 6タブ作成確認
4. `runAllTests()` 実行 → 全PASS確認
5. `processOnePdfManually(fileId)` で1枚スモークテスト → DocAI 疎通確認
6. シャドー運用開始（5月分PDFで並走）
7. 差分5%以下なら本番切替

## Plan 2 / Plan 3 への引き継ぎ予定

### Plan 2 で実装
- C2 大型支払：通帳・カード明細CSVをDriveに置いて自動仕訳分類
- C3 仕入請求書OCR：6社パターンマッチ、TKCへ請求書ルート（マニュアル STEP 4 自動化）
- TKC FX2 CSV仕様確定後の `TkcExporter.gs` 列順fix

### Plan 3 で実装
- 給与シート改善（`allure-payroll/` Plan 1と統合検討）
- 海旬への横展開（FXまいスター対応 = `TkcExporter` の出力スキーマ抽象化）
- きくや美粧堂 Fivent按分の自動化
- duft店舗の正式運用

## Risk Register

| ID | リスク | 影響 | 軽減策 |
|---|---|---|---|
| R1 | TKC FX2 CSV取込仕様がPhase 0で確定しない | 高 | `TkcExporter.gs` の列順fixを1関数差し替えで対応できる構造、矢萩さんがTKC側で手仕訳に切替も可能 |
| R2 | DocAI processor `260618b8e03af14b` のレシピ精度がAllureデータで出ない | 中 | バックテストで早期検知、必要ならGoogle Vision API へのフォールバック検討 |
| R3 | サービスアカウントから DocAI 呼出時の権限エラー | 中 | TBD-07 で Week 1 中に疎通テスト |
| R4 | GAS 実行時間制限（6分）でDriveの全PDFを処理しきれない | 低 | バッチ分割、`lastProcessedTimestamp` を細かく進める |
| R5 | 矢萩さんがApps Script操作に不慣れで初回セットアップが進まない | 中 | operation-manual.md を Step-by-step で詳細化、Claude が画面共有で並走 |
| R6 | 5月分シャドー運用で差分5%超 | 中 | マスタ追加で精度改善、必要なら6月分も並走継続 |
