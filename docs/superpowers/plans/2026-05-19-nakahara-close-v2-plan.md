# 中原クローズv2 実装計画書

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/nakahara-close` skill に仕訳ワークフロー (試作v34→仕訳案タブ→人間確定→MF取込CSV) を追加し、矢萩さんの仕訳手打ち作業を確認・確定のみに圧縮する

**Architecture:** 既存 Python スキルの `.work/` 配下に4つの新規スクリプトを追加。試作v34 を中間表現として強化 (M-Q 列で税率内訳保持)。マッピング辞書は過去 MF仕訳CSV から自動学習 + 上書きマスタシートでカバー。確定済仕訳のみ MF標準19列 CSV (Shift_JIS) として Drive/SS両方に出力。

**Tech Stack:** Python 3, pdfplumber, gspread, google-api-python-client, pandas (新規追加)

**Spec参照:** `docs/superpowers/specs/2026-05-19-nakahara-close-v2-design.md`

---

## 前提条件 (Phase 0、矢萩さんの手作業)

実装着手前に以下を完了:

- [ ] `.auth/lb/tokens.json` 生成 (`python C:\Users\orika\.claude\skills\nakahara-close\.work\auth_init.py`)
- [ ] Drive `経理データ_中原水産/MF仕訳エクスポート/` 作成
- [ ] Drive `経理データ_中原水産/MF取込CSV/` 作成
- [ ] 過去 MF仕訳CSV (`仕訳帳_20260519_0635.csv`) を `MF仕訳エクスポート/` にアップロード
- [ ] pandas インストール: `python -m pip install pandas`

これらは `/nakahara-close` skill の動作に依存しない外部リソース。実装は前提条件完了を待たずに着手可能 (Phase 着手時に必要)。

---

## File Structure

```
C:\Users\orika\.claude\skills\nakahara-close\.work\
├── auth_init.py                          (既存)
├── dl_purchase_pdfs.py                   (既存)
├── dl_sales_pdfs.py                      (既存)
├── ocr_purchase_pdfs.py                  ★改修 (税率別合計抽出)
├── scan_nakahara_sales_v2.py             (既存)
├── build_nakahara_purchase_diff.py       (既存)
├── build_purchase_invoice_flags.py       (既存)
├── build_nakahara_shisaku_v34_202603.py  ★改修 (M-Q列追加)
├── build_partner_mapping.py              ★新規 (Phase A)
├── init_mapping_master_sheet.py          ★新規 (Phase A、one-shot)
├── build_journal_proposals.py            ★新規 (Phase C)
├── export_mf_csv.py                      ★新規 (Phase D)
├── test_build_partner_mapping.py         ★新規 (Phase A test)
├── test_journal_proposals.py             ★新規 (Phase C test)
├── test_mf_csv_export.py                 ★新規 (Phase D test)
└── test_data/
    ├── sample_journal_small.csv          ★新規 (テスト用フィクスチャ)
    └── sample_purchase_pdf.pdf           ★新規 (税率混在PDFサンプル)
```

`SKILL.md` も Phase 6/7 セクション追記。

**作業ディレクトリ**: `C:\Users\orika\.claude\skills\nakahara-close\` (skill folder)
**コミットの場所**: `C:\Users\orika\sns-automation\` (本 repo) で実装ログ・spec/plan を管理。skill 内の `.work/` は別管理 (skill repo or sync 経由でデプロイ)。

---

## Phase A: マッピング辞書学習

**目的**: 過去 MF仕訳CSV から取引先→標準仕訳の辞書を自動生成し、上書きマスタシートに初期データを書き込む。

### Task A1: テスト用フィクスチャ作成

**Files:**
- Create: `.work/test_data/sample_journal_small.csv`

- [ ] **Step 1**: 過去 CSV から代表サンプル20取引をピックアップ

`C:\Users\orika\Downloads\仕訳帳_20260519_0635.csv` から以下のパターンを含む20取引 (= 40行前後) を抽出:
  - 期首振替 (取引No=1) 2行 — 除外テスト用
  - 仕入 単一税率 8% (例: 有限会社ヤマイシ小林) 5取引
  - 仕入 単一税率 10% (例: 株式会社東発) 3取引
  - 売上 8% (例: 豊洲市場株式会社) 5取引
  - 売上 10% 取引先名に税率併記 (例: 築地魚市場株式会社 / 10％) 3取引
  - 立替経費 (例: 短期借入金 柳田宗則) 2取引

Shift_JIS で保存。

- [ ] **Step 2**: コミット
```bash
git add .work/test_data/sample_journal_small.csv
git commit -m "test: add fixture CSV for mapping dictionary tests"
```

### Task A2: build_partner_mapping のテスト作成

**Files:**
- Create: `.work/test_build_partner_mapping.py`

- [ ] **Step 1**: テストを書く (失敗状態)

```python
"""build_partner_mapping のテスト"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from build_partner_mapping import (
    load_journal_csv,
    group_by_transaction,
    extract_partner_patterns,
    assign_confidence,
)

FIXTURE = os.path.join(os.path.dirname(__file__), 'test_data', 'sample_journal_small.csv')


class TestLoadCsv(unittest.TestCase):
    def test_shift_jis_decoding(self):
        rows = load_journal_csv(FIXTURE)
        self.assertGreater(len(rows), 30)
        # 中原慣習: 補助科目に日本語が入る
        kanji_rows = [r for r in rows if '株式会社' in r.get('借方補助科目', '') or '株式会社' in r.get('貸方補助科目', '')]
        self.assertGreater(len(kanji_rows), 0)


class TestGroupByTransaction(unittest.TestCase):
    def test_grouping(self):
        rows = load_journal_csv(FIXTURE)
        groups = group_by_transaction(rows)
        self.assertIn(1, groups)  # 期首振替

    def test_exclude_opening_balance(self):
        rows = load_journal_csv(FIXTURE)
        groups = group_by_transaction(rows, exclude_opening=True)
        self.assertNotIn(1, groups)


class TestExtractPatterns(unittest.TestCase):
    def test_basic_pattern_yamaishi(self):
        rows = load_journal_csv(FIXTURE)
        groups = group_by_transaction(rows, exclude_opening=True)
        patterns = extract_partner_patterns(groups)
        self.assertIn('有限会社ヤマイシ小林', patterns)
        p = patterns['有限会社ヤマイシ小林']
        self.assertEqual(p['debit_account'], '仕入高【8％】')
        self.assertEqual(p['debit_tax'], '課税仕入 (軽)8%')
        self.assertEqual(p['credit_account'], '買掛金')
        self.assertEqual(p['credit_tax'], '対象外')

    def test_special_partner_with_tax_suffix(self):
        """築地魚市場株式会社 / 10％ のような税率併記を正規化せず保持"""
        rows = load_journal_csv(FIXTURE)
        groups = group_by_transaction(rows, exclude_opening=True)
        patterns = extract_partner_patterns(groups)
        self.assertIn('築地魚市場株式会社 / 10％', patterns)


class TestConfidence(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(assign_confidence(15), '高')
        self.assertEqual(assign_confidence(5), '中')
        self.assertEqual(assign_confidence(2), '低')
        self.assertEqual(assign_confidence(0), '未登録')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2**: テストが失敗することを確認
```bash
cd C:/Users/orika/.claude/skills/nakahara-close
python .work/test_build_partner_mapping.py
```
Expected: ModuleNotFoundError (build_partner_mapping がまだ無い)

### Task A3: build_partner_mapping 実装

**Files:**
- Create: `.work/build_partner_mapping.py`

- [ ] **Step 1**: スクリプトを書く

```python
"""中原水産 過去MF仕訳CSV → 取引先別標準仕訳マッピング辞書 を学習。

使い方:
  python .work/build_partner_mapping.py \
    --input-dir .work/test_data \
    --output .work/partner_mapping_中原.json

  本番:
  python .work/build_partner_mapping.py \
    --drive-folder <MF仕訳エクスポートフォルダID> \
    --output .work/partner_mapping_中原.json
"""
import argparse
import csv
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK_DIR = os.path.join(PROJECT_ROOT, '.work')


def load_journal_csv(path):
    """MF仕訳帳CSV (Shift_JIS) を読込、各行を dict で返す"""
    with open(path, 'r', encoding='cp932', newline='') as f:
        reader = csv.DictReader(f)
        return list(reader)


def group_by_transaction(rows, exclude_opening=False, exclude_closing=False):
    """取引No 単位でグルーピング"""
    groups = defaultdict(list)
    for row in rows:
        try:
            tx_no = int(row.get('取引No', '0'))
        except (ValueError, TypeError):
            continue
        if exclude_opening and tx_no == 1:
            continue
        if exclude_closing and row.get('取引日', '').endswith('/12/31'):
            continue
        groups[tx_no].append(row)
    return dict(groups)


def _get_partner(transaction_rows):
    """取引から取引先名を抽出 (補助科目優先、補助科目に無ければ取引先列)"""
    for row in transaction_rows:
        for col in ['借方補助科目', '貸方補助科目', '借方取引先', '貸方取引先']:
            val = row.get(col, '').strip()
            if val:
                return val
    return None


def _extract_journal_pattern(transaction_rows):
    """取引行から (借方勘定科目, 借方税区分, 貸方勘定科目, 貸方税区分) を抽出"""
    debit_account = debit_tax = credit_account = credit_tax = None
    for row in transaction_rows:
        if row.get('借方勘定科目') and not debit_account:
            debit_account = row['借方勘定科目']
            debit_tax = row.get('借方税区分', '')
        if row.get('貸方勘定科目') and not credit_account:
            credit_account = row['貸方勘定科目']
            credit_tax = row.get('貸方税区分', '')
    return (debit_account, debit_tax, credit_account, credit_tax)


def _guess_type(debit_account, credit_account):
    """勘定科目から取引種別を推測"""
    debit_account = debit_account or ''
    credit_account = credit_account or ''
    if '売上高' in credit_account or '売掛金' in debit_account:
        return '売上'
    if '仕入高' in debit_account or '買掛金' in credit_account:
        return '仕入'
    if '立替' in debit_account or '立替' in credit_account or '短期借入金' in credit_account:
        return '立替'
    if '振替' in debit_account or '振替' in credit_account:
        return '振替'
    return '固定費'


def extract_partner_patterns(transaction_groups):
    """取引先ごとに最頻パターンを抽出"""
    # partner -> Counter[pattern] で集計
    partner_patterns = defaultdict(Counter)
    for tx_no, rows in transaction_groups.items():
        partner = _get_partner(rows)
        if not partner:
            continue
        pattern = _extract_journal_pattern(rows)
        if not all(pattern[i] is not None for i in [0, 2]):
            continue  # 借方/貸方が空ならスキップ
        partner_patterns[partner][pattern] += 1
    # 最頻パターンを採用
    result = {}
    for partner, counter in partner_patterns.items():
        if not counter:
            continue
        top_pattern, top_count = counter.most_common(1)[0]
        debit_account, debit_tax, credit_account, credit_tax = top_pattern
        tx_type = _guess_type(debit_account, credit_account)
        result[partner] = {
            'type': tx_type,
            'debit_account': debit_account,
            'debit_tax': debit_tax,
            'credit_account': credit_account,
            'credit_tax': credit_tax,
            'summary_template': '{partner} {month}月分',
            'confidence': assign_confidence(top_count),
            'occurrences': top_count,
        }
    return result


def assign_confidence(count):
    if count >= 10:
        return '高'
    elif count >= 3:
        return '中'
    elif count >= 1:
        return '低'
    return '未登録'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-dir', help='ローカルCSVが置かれたディレクトリ')
    parser.add_argument('--drive-folder', help='Drive フォルダID (本番)')
    parser.add_argument('--output', required=True, help='出力JSONパス')
    args = parser.parse_args()

    if args.input_dir:
        csv_paths = [
            os.path.join(args.input_dir, f)
            for f in os.listdir(args.input_dir)
            if f.endswith('.csv')
        ]
    elif args.drive_folder:
        csv_paths = _download_drive_csvs(args.drive_folder)
    else:
        sys.exit('ERROR: --input-dir or --drive-folder required')

    all_rows = []
    for path in csv_paths:
        all_rows.extend(load_journal_csv(path))

    groups = group_by_transaction(all_rows, exclude_opening=True, exclude_closing=True)
    patterns = extract_partner_patterns(groups)

    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(patterns, f, ensure_ascii=False, indent=2)

    print(f'[OK] 取引先 {len(patterns)} 件を {args.output} に出力')


def _download_drive_csvs(folder_id):
    """Drive フォルダ配下の CSV を一時ディレクトリにDLしてパスを返す"""
    # NAKAHARA_AUTH_DIR + Drive API
    # 実装は dl_purchase_pdfs.py のパターン踏襲
    raise NotImplementedError('Phase A4 で実装')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2**: テストを再実行して全件 PASS を確認
```bash
python .work/test_build_partner_mapping.py
```
Expected: `Ran 6 tests in X.XXXs OK`

- [ ] **Step 3**: コミット
```bash
git add .work/build_partner_mapping.py .work/test_build_partner_mapping.py .work/test_data/
git commit -m "feat(nakahara): add partner mapping dictionary learning (Phase A)"
```

### Task A4: 実 CSV で辞書生成

**Files:**
- Modify: `.work/build_partner_mapping.py` (Drive ダウンロード機能 `_download_drive_csvs` 実装)

- [ ] **Step 1**: Drive ダウンロード機能を `dl_purchase_pdfs.py` の `get_creds` + `list_folder` パターンで実装
- [ ] **Step 2**: 矢萩さんに過去CSVを Drive にアップロード済か確認 (Phase 0 完了確認)
- [ ] **Step 3**: 実行
```bash
NAKAHARA_AUTH_DIR=C:/Users/orika/.auth/lb python .work/build_partner_mapping.py \
  --drive-folder <MF仕訳エクスポートフォルダID> \
  --output .work/partner_mapping_中原.json
```
Expected: `[OK] 取引先 60 件前後を .work/partner_mapping_中原.json に出力`

- [ ] **Step 4**: 出力JSONを目視確認
```bash
python -m json.tool .work/partner_mapping_中原.json | head -50
```
Expected: 既知の取引先 (オーシャンジャパン、築地魚市場、ヤマイシ小林) が正しいパターンで含まれる

- [ ] **Step 5**: コミット (JSON は .gitignore で除外、コミット対象は Drive DL 機能のみ)

### Task A5: マッピング辞書 → マスタシート初期化 (one-shot)

**Files:**
- Create: `.work/init_mapping_master_sheet.py`

- [ ] **Step 1**: スクリプト実装

```python
"""partner_mapping_中原.json を 入出金管理表 SS の _仕訳マッピング_中原 タブに書き込む。

one-shot 用。再実行すると上書きするが、J列「ロック」=✓ の行は保持する。
"""
import argparse
import json
import os
import sys

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTH_DIR = os.environ.get('NAKAHARA_AUTH_DIR') or os.path.join(PROJECT_ROOT, '.auth', 'lb')

SS_ID = '1X_oPij_Fq_fJO9Dtfth-sn2z1BKyIOoSl1M6PD3mUXs'  # 入出金管理表
TAB_NAME = '_仕訳マッピング_中原'

SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']

HEADERS = [
    '取引先名', '種別', '借方勘定科目', '借方税区分',
    '貸方勘定科目', '貸方税区分', '摘要テンプレ',
    '信頼度', '出現回数', 'ロック',
]


def get_creds():
    with open(os.path.join(AUTH_DIR, 'tokens.json'), 'r', encoding='utf-8') as f:
        tokens = json.load(f)
    with open(os.path.join(AUTH_DIR, 'credentials.json'), 'r', encoding='utf-8') as f:
        ci = json.load(f).get('web') or json.load(f).get('installed')
    return Credentials(
        token=tokens.get('token'),
        refresh_token=tokens.get('refresh_token'),
        token_uri=tokens.get('token_uri', 'https://oauth2.googleapis.com/token'),
        client_id=ci['client_id'],
        client_secret=ci['client_secret'],
        scopes=SCOPES,
    )


def get_or_create_tab(sheets, ss_id, tab_name):
    """タブを取得 or 新規作成、gid を返す"""
    ss = sheets.spreadsheets().get(spreadsheetId=ss_id).execute()
    for s in ss['sheets']:
        if s['properties']['title'] == tab_name:
            return s['properties']['sheetId']
    # 無ければ作る
    resp = sheets.spreadsheets().batchUpdate(spreadsheetId=ss_id, body={
        'requests': [{'addSheet': {'properties': {'title': tab_name}}}]
    }).execute()
    return resp['replies'][0]['addSheet']['properties']['sheetId']


def load_existing_locked_rows(sheets, ss_id, tab_name):
    """ロック列✓の既存行を保持"""
    try:
        resp = sheets.spreadsheets().values().get(
            spreadsheetId=ss_id, range=f"'{tab_name}'!A2:J"
        ).execute()
    except Exception:
        return []
    values = resp.get('values', [])
    locked = []
    for row in values:
        row = (row + [''] * 10)[:10]  # 10列にpad
        if row[9].strip() in ('✓', 'TRUE', 'true', '1'):
            locked.append(row)
    return locked


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--json', default=os.path.join(PROJECT_ROOT, '.work', 'partner_mapping_中原.json'))
    args = parser.parse_args()

    with open(args.json, 'r', encoding='utf-8') as f:
        patterns = json.load(f)

    creds = get_creds()
    sheets = build('sheets', 'v4', credentials=creds)

    gid = get_or_create_tab(sheets, SS_ID, TAB_NAME)
    locked = load_existing_locked_rows(sheets, SS_ID, TAB_NAME)
    locked_partners = {row[0] for row in locked}

    # 出力データ構築 (ロック行優先、それ以外は辞書から)
    new_rows = []
    for partner, p in sorted(patterns.items(), key=lambda x: -x[1]['occurrences']):
        if partner in locked_partners:
            continue
        new_rows.append([
            partner, p['type'], p['debit_account'], p['debit_tax'],
            p['credit_account'], p['credit_tax'], p['summary_template'],
            p['confidence'], p['occurrences'], '',
        ])

    out = [HEADERS] + locked + new_rows

    # clear + write
    sheets.spreadsheets().values().clear(
        spreadsheetId=SS_ID, range=f"'{TAB_NAME}'!A:J"
    ).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=SS_ID, range=f"'{TAB_NAME}'!A1",
        valueInputOption='USER_ENTERED', body={'values': out}
    ).execute()

    print(f'[OK] _仕訳マッピング_中原 タブに {len(out)-1} 行を書き込み (ロック保持: {len(locked)} 行)')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2**: 実行
```bash
NAKAHARA_AUTH_DIR=C:/Users/orika/.auth/lb python .work/init_mapping_master_sheet.py
```
Expected: `[OK] _仕訳マッピング_中原 タブに 60行前後を書き込み`

- [ ] **Step 3**: 入出金管理表 SS で `_仕訳マッピング_中原` タブを目視確認
- [ ] **Step 4**: 矢萩さんに「上位20社の標準仕訳をロックしてください」と依頼 (J列に✓を手入力)
- [ ] **Step 5**: コミット
```bash
git add .work/init_mapping_master_sheet.py
git commit -m "feat(nakahara): add mapping master sheet initializer (Phase A5)"
```

### Task A6: Phase A 完了レビュー

- [ ] 矢萩さんに以下を確認依頼:
  - `_仕訳マッピング_中原` タブの内容が妥当か
  - 上位取引先のロック (J列✓) 入力
  - 不要パターンの削除
- [ ] レビュー結果を `current-priorities.md` に記録

---

## Phase B: 試作v34 シート改修 (税率列追加)

**目的**: 試作v34 シートに M-Q 列 (8%対象/10%対象/税額/検算) を追加し、仕訳案生成の入力として完備させる。

### Task B1: OCR 税率別合計抽出のテスト & 実装

**Files:**
- Modify: `.work/ocr_purchase_pdfs.py`

- [ ] **Step 1**: 既存 `purchase_pdf_extracted_202604.json` をサンプル取得 (本番実行済データ)
- [ ] **Step 2**: 1〜3社のサンプル PDF を pdfplumber で text 抽出、税率表記パターンを目視確認
  - 想定パターン: `8%対象 ¥12,345 / 10%対象 ¥6,789`、`軽減税率対象 ...`、`消費税(8%) ... / 消費税(10%) ...`
- [ ] **Step 3**: ocr_purchase_pdfs.py に正規表現抽出関数を追加

```python
import re

TAX_8_PATTERNS = [
    r'8%対象\s*[¥￥]?\s*([\d,]+)',
    r'軽減税率対象\s*[¥￥]?\s*([\d,]+)',
    r'消費税\(?8%\)?.*?[¥￥]?\s*([\d,]+)',  # 税額表記なので別途扱い注意
]

TAX_10_PATTERNS = [
    r'10%対象\s*[¥￥]?\s*([\d,]+)',
    r'標準税率対象\s*[¥￥]?\s*([\d,]+)',
]


def extract_subtotals(pdf_text):
    """PDF テキストから 8%対象/10%対象の税込合計を抽出"""
    def find_first(patterns):
        for pat in patterns:
            m = re.search(pat, pdf_text)
            if m:
                return int(m.group(1).replace(',', ''))
        return 0
    return {
        'subtotal_8': find_first(TAX_8_PATTERNS),
        'subtotal_10': find_first(TAX_10_PATTERNS),
    }
```

- [ ] **Step 4**: JSON スキーマに `subtotal_8`, `subtotal_10` を追加
- [ ] **Step 5**: 2604 で再実行、JSON 検証
- [ ] **Step 6**: コミット
```bash
git commit -m "feat(nakahara): extract tax-rate subtotals from purchase PDFs (Phase B1)"
```

### Task B2: 試作v34 への M-Q 列追加

**Files:**
- Modify: `.work/build_nakahara_shisaku_v34_202603.py`

- [ ] **Step 1**: ヘッダ行 (Row 3) に M-Q 列を追加
```python
EXTRA_COLUMNS = ['8%対象(税込)', '10%対象(税込)', '8%税額', '10%税額', '検算']
```

- [ ] **Step 2**: 各データ行の M-Q 列を埋める

仕入セクション: 
- M = `purchase_pdf_extracted_*.json` から `subtotal_8` を引く (PDFファイル名で突合)
- N = 同 `subtotal_10`
- O,P = 数式
- Q = `=IF(M{n}+N{n}=L{n},"OK","NG:"&(L{n}-M{n}-N{n}))`

売上セクション (15〆/末〆):
- マッピング辞書から取引先別の標準税率を引く
- 取引先別税率 8% なら M=L, N=0
- 取引先別税率 10% なら M=0, N=L

その他フォルダ:
- まず PDF OCR (subtotal_8/10) を試す
- 取れなければマッピング辞書フォールバック

- [ ] **Step 3**: 2603 で再実行 (既存リグレッション基準月)
```bash
NAKAHARA_AUTH_DIR=C:/Users/orika/.auth/lb python .work/build_nakahara_shisaku_v34_202603.py --month 2603
```
Expected: 試作v34 シートに M-Q 列が追加され、Q列「OK」率 ≥ 80% (仕入セクション)

- [ ] **Step 4**: 2604 で再実行、目視確認
- [ ] **Step 5**: コミット
```bash
git commit -m "feat(nakahara): add tax-rate columns (M-Q) to shisaku v34 sheet (Phase B2)"
```

### Task B3: Phase B 完了レビュー

- [ ] 矢萩さんに 2603/2604 試作v34 を確認依頼
- [ ] Q列 NG 行を補正 (J列+M+N の手入力ペア)

---

## Phase C: 仕訳案タブ生成

**目的**: 試作v34 + マッピング辞書 から仕訳案タブを生成し、矢萩さんが確定/保留/却下できる UI を提供。

### Task C1: build_journal_proposals のテスト作成

**Files:**
- Create: `.work/test_journal_proposals.py`

- [ ] **Step 1**: テスト書く

```python
import unittest
from build_journal_proposals import (
    build_proposal_row,
    expand_compound_journal,
)


class TestBuildProposal(unittest.TestCase):
    def test_single_rate_purchase(self):
        v34_row = {
            'partner': '有限会社ヤマイシ小林',
            'date': '2026/04/15',
            'section': '仕入',
            'amount': 80000,
            'subtotal_8': 80000,
            'subtotal_10': 0,
            'pdf_link': 'https://drive.google.com/...',
        }
        mapping = {
            '有限会社ヤマイシ小林': {
                'type': '仕入',
                'debit_account': '仕入高【8％】',
                'debit_tax': '課税仕入 (軽)8%',
                'credit_account': '買掛金',
                'credit_tax': '対象外',
                'summary_template': '{partner} {month}月分',
                'confidence': '高',
            }
        }
        row = build_proposal_row(v34_row, mapping, month='4')
        self.assertEqual(row['取引先'], '有限会社ヤマイシ小林')
        self.assertEqual(row['借方勘定科目'], '仕入高【8％】')
        self.assertEqual(row['借方金額'], 80000)
        self.assertEqual(row['貸方勘定科目'], '買掛金')
        self.assertEqual(row['マッピング判定'], 'OK')
        self.assertEqual(row['8%対象(内訳)'], 80000)
        self.assertEqual(row['10%対象(内訳)'], 0)

    def test_unmapped_partner(self):
        v34_row = {
            'partner': '謎の新規取引先', 'date': '2026/04/15',
            'section': '仕入', 'amount': 50000,
            'subtotal_8': 0, 'subtotal_10': 50000,
        }
        row = build_proposal_row(v34_row, {}, month='4')
        self.assertEqual(row['マッピング判定'], '未登録')
        # 種別推測で仕入→デフォルト10%
        self.assertEqual(row['借方勘定科目'], '仕入高【10％】')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2**: テスト実行 → 失敗確認

### Task C2: build_journal_proposals 実装

**Files:**
- Create: `.work/build_journal_proposals.py`

- [ ] **Step 1**: 実装 (主要関数のみ抜粋、フルコードは Task 実行時に書く)

```python
"""試作v34 + マッピング辞書 → 仕訳案タブ生成"""
import argparse, json, os, sys
# ... auth/sheets setup (他スクリプトと同じパターン) ...

PROPOSAL_HEADERS = [
    '確定状態', '取引日', '取引種別', '取引先',
    '借方勘定科目', '借方補助科目', '借方税区分', '借方金額',
    '貸方勘定科目', '貸方補助科目', '貸方税区分', '貸方金額',
    '摘要', 'ソースPDFリンク', 'マッピング判定', 'レビューメモ',
    '8%対象(内訳)', '10%対象(内訳)',
]

DEFAULT_BY_TYPE = {
    '仕入': {
        'debit_account': '仕入高【10％】', 'debit_tax': '課税仕入 10%',
        'credit_account': '買掛金', 'credit_tax': '対象外',
    },
    '売上': {
        'debit_account': '売掛金', 'debit_tax': '対象外',
        'credit_account': '売上高【10％】', 'credit_tax': '課税売上 10%',
    },
    '固定費': {
        'debit_account': '支払手数料', 'debit_tax': '課税仕入 10%',
        'credit_account': '普通預金', 'credit_tax': '対象外',
    },
}


def load_mapping_with_master_override(sheets, ss_id, json_path):
    """マスタシートのロック行 → JSON辞書 の優先順で統合"""
    # ロック行 (J=✓) を sheets から取得
    # JSON 辞書とマージ (ロック優先)
    ...


def build_proposal_row(v34_row, mapping, month):
    partner = v34_row['partner']
    section = v34_row['section']  # 仕入/売上15〆/末〆/その他

    if partner in mapping:
        m = mapping[partner]
        judgment = 'OK' if m.get('confidence') in ('高', '中') else '要確認'
    else:
        # 未登録 → 種別推測
        tx_type = _infer_type_from_section(section)
        m = DEFAULT_BY_TYPE.get(tx_type, DEFAULT_BY_TYPE['固定費'])
        m = {**m, 'type': tx_type, 'summary_template': '{partner} {month}月分'}
        judgment = '未登録'

    summary = m['summary_template'].format(partner=partner, month=month)

    return {
        '確定状態': '',
        '取引日': v34_row['date'],
        '取引種別': m['type'],
        '取引先': partner,
        '借方勘定科目': m['debit_account'],
        '借方補助科目': partner,
        '借方税区分': m['debit_tax'],
        '借方金額': v34_row['amount'],
        '貸方勘定科目': m['credit_account'],
        '貸方補助科目': partner,
        '貸方税区分': m['credit_tax'],
        '貸方金額': v34_row['amount'],
        '摘要': summary,
        'ソースPDFリンク': v34_row.get('pdf_link', ''),
        'マッピング判定': judgment,
        'レビューメモ': '',
        '8%対象(内訳)': v34_row.get('subtotal_8', 0),
        '10%対象(内訳)': v34_row.get('subtotal_10', 0),
    }


def _infer_type_from_section(section):
    if '仕入' in section: return '仕入'
    if '売上' in section: return '売上'
    if 'その他' in section: return '固定費'
    return '固定費'


def write_proposal_tab(sheets, ss_id, month_label, rows, preserve_existing_states=True):
    """仕訳案タブを上書き、ただし既存A列(確定状態)とP列(レビューメモ)は保持"""
    tab_name = f'仕訳案_{month_label}'
    # ... タブ作成 or 取得 ...
    # ... 既存A列+P列を行キー (取引日+取引先+借方金額) でマップ ...
    # ... 新規行に既存値を再注入 ...
    # ... clear + write ...
    # ... プルダウン (A列) + 条件付き書式 (O列) ...


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--month', required=True, help='YYMM (例: 2604)')
    args = parser.parse_args()
    yymm = args.month
    month = str(int(yymm[2:]))  # '2604' -> '4'

    # 試作v34 読込
    v34_rows = _read_shisaku_v34(yymm)
    # マッピング辞書読込 (マスタシート優先)
    mapping = load_mapping_with_master_override(...)
    # 仕訳案行生成
    proposal_rows = [build_proposal_row(r, mapping, month) for r in v34_rows]
    # 書き込み
    write_proposal_tab(..., f'YY.{month}月', proposal_rows)
    print(f'[OK] 仕訳案_YY.{month}月 タブに {len(proposal_rows)} 行を書き込み')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2**: テスト全件 PASS 確認
- [ ] **Step 3**: 2604 で実行
```bash
NAKAHARA_AUTH_DIR=C:/Users/orika/.auth/lb python .work/build_journal_proposals.py --month 2604
```
- [ ] **Step 4**: SS で `仕訳案_26.4月` タブを目視確認
- [ ] **Step 5**: コミット

### Task C3: 視覚補助 (プルダウン + 条件付き書式)

**Files:**
- Modify: `.work/build_journal_proposals.py` (write_proposal_tab 内)

- [ ] **Step 1**: A列 (確定状態) に Data Validation でプルダウン設定
```python
data_validation_request = {
    'setDataValidation': {
        'range': {'sheetId': gid, 'startRowIndex': 1, 'startColumnIndex': 0, 'endColumnIndex': 1},
        'rule': {
            'condition': {'type': 'ONE_OF_LIST', 'values': [
                {'userEnteredValue': '確定'},
                {'userEnteredValue': '保留'},
                {'userEnteredValue': '却下'},
            ]},
            'showCustomUi': True,
        }
    }
}
```

- [ ] **Step 2**: O列の条件付き書式 (OK=緑、要確認=黄、未登録=赤)
- [ ] **Step 3**: Q+R 列両方>0 (税率混在) の行を薄青ハイライト
- [ ] **Step 4**: 2604 で再実行、見た目確認
- [ ] **Step 5**: コミット

### Task C4: SKILL.md 更新 (Phase 6 追加)

**Files:**
- Modify: `C:\Users\orika\.claude\skills\nakahara-close\SKILL.md`

- [ ] **Step 1**: Phase 6 セクション追加
```markdown
### Phase 6 — 仕訳案タブ生成

NAKAHARA_AUTH_DIR=$AUTH python .work/build_journal_proposals.py --month $YYMM

出力: 入出金管理表 SS の `仕訳案_YY.M月` タブ (18列、確定/保留/却下プルダウン付き)
```
- [ ] **Step 2**: `/nakahara-close --month YYMM` の標準フローに Phase 6 を組み込む
- [ ] **Step 3**: コミット

### Task C5: Phase C 完了レビュー

- [ ] 矢萩さんに `仕訳案_26.4月` タブのレビュー依頼
  - O列「OK」率 ≥ 70% か
  - 自動推奨が違う行を E-K で修正
  - A列で 確定/保留/却下 を全件入力
- [ ] レビュー結果を `current-priorities.md` 記録

---

## Phase D: MF取込CSV出力

**目的**: 確定済仕訳を MF標準19列 CSV (Shift_JIS) として Drive 保存 + SS タブ生成。

### Task D1: export_mf_csv のテスト作成

**Files:**
- Create: `.work/test_mf_csv_export.py`

- [ ] **Step 1**: テストケース
```python
def test_single_rate_to_one_row():
    proposal = {
        '取引日': '2026/04/15', '取引先': '有限会社ヤマイシ小林',
        '借方勘定科目': '仕入高【8％】', '借方補助科目': '有限会社ヤマイシ小林',
        '借方税区分': '課税仕入 (軽)8%', '借方金額': 80000,
        '貸方勘定科目': '買掛金', '貸方補助科目': '有限会社ヤマイシ小林',
        '貸方税区分': '対象外', '貸方金額': 80000,
        '摘要': '有限会社ヤマイシ小林 4月分',
        '8%対象(内訳)': 80000, '10%対象(内訳)': 0,
    }
    rows = expand_to_mf_rows(proposal, tx_no=1)
    self.assertEqual(len(rows), 1)
    self.assertEqual(rows[0]['借方勘定科目'], '仕入高【8％】')
    self.assertEqual(rows[0]['借方金額(円)'], 80000)
    self.assertEqual(rows[0]['貸方勘定科目'], '買掛金')

def test_mixed_rates_to_three_rows():
    proposal = {
        '取引日': '2026/04/15', '取引先': '混在さん',
        '借方勘定科目': '仕入高【8％】',  # 主税率
        '借方金額': 80000, '貸方勘定科目': '買掛金', '貸方金額': 80000,
        '8%対象(内訳)': 50000, '10%対象(内訳)': 30000,
        # ... 他必須
    }
    rows = expand_to_mf_rows(proposal, tx_no=2)
    self.assertEqual(len(rows), 3)
    # 行1: 借方=仕入高【8％】50,000
    # 行2: 借方=仕入高【10％】30,000
    # 行3: 貸方=買掛金 80,000
    self.assertEqual(rows[0]['借方金額(円)'], 50000)
    self.assertEqual(rows[1]['借方金額(円)'], 30000)
    self.assertEqual(rows[2]['貸方金額(円)'], 80000)
    self.assertTrue(all(r['取引No'] == 2 for r in rows))

def test_shift_jis_encoding():
    """生成CSVが Shift_JIS で読み戻せる"""
    # 一時ファイルに書き出し、cp932 で読み戻して同一性確認
    ...
```

- [ ] **Step 2**: 失敗確認

### Task D2: export_mf_csv 実装

**Files:**
- Create: `.work/export_mf_csv.py`

- [ ] **Step 1**: 実装

```python
"""仕訳案タブの確定済行 → MF標準19列CSV → Drive保存 + SSタブ生成"""
import argparse, csv, io, json, os, sys
from datetime import datetime
# ... auth/sheets/drive setup ...

MF_HEADERS = [
    '取引No', '取引日',
    '借方勘定科目', '借方補助科目', '借方部門', '借方取引先', '借方税区分', '借方インボイス', '借方金額(円)',
    '貸方勘定科目', '貸方補助科目', '貸方部門', '貸方取引先', '貸方税区分', '貸方インボイス', '貸方金額(円)',
    '摘要', 'タグ', 'メモ',
]

DRIVE_PARENT_NAME = '経理データ_中原水産/MF取込CSV'  # 実フォルダIDは settings に格納
SS_ID = '1X_oPij_Fq_fJO9Dtfth-sn2z1BKyIOoSl1M6PD3mUXs'


def expand_to_mf_rows(proposal, tx_no):
    """1仕訳案 → MF CSV 1〜3行"""
    sub8 = int(proposal.get('8%対象(内訳)', 0) or 0)
    sub10 = int(proposal.get('10%対象(内訳)', 0) or 0)
    total = int(proposal['借方金額'])

    if sub8 > 0 and sub10 > 0:
        # 混在 → 3行
        return [
            _make_debit_row(tx_no, proposal, '仕入高【8％】', '課税仕入 (軽)8%', sub8),
            _make_debit_row(tx_no, proposal, '仕入高【10％】', '課税仕入 10%', sub10),
            _make_credit_row(tx_no, proposal, total),
        ]
    else:
        # 単一 → 1行
        return [_make_single_row(tx_no, proposal)]


def _make_single_row(tx_no, p):
    return {
        '取引No': tx_no, '取引日': p['取引日'],
        '借方勘定科目': p['借方勘定科目'], '借方補助科目': p['借方補助科目'],
        '借方部門': '', '借方取引先': '', '借方税区分': p['借方税区分'],
        '借方インボイス': '', '借方金額(円)': p['借方金額'],
        '貸方勘定科目': p['貸方勘定科目'], '貸方補助科目': p['貸方補助科目'],
        '貸方部門': '', '貸方取引先': '', '貸方税区分': p['貸方税区分'],
        '貸方インボイス': '', '貸方金額(円)': p['貸方金額'],
        '摘要': p['摘要'], 'タグ': '', 'メモ': '',
    }


def _make_debit_row(tx_no, p, account, tax, amount):
    return {
        '取引No': tx_no, '取引日': p['取引日'],
        '借方勘定科目': account, '借方補助科目': p['借方補助科目'],
        '借方部門': '', '借方取引先': '', '借方税区分': tax,
        '借方インボイス': '', '借方金額(円)': amount,
        '貸方勘定科目': '', '貸方補助科目': '', '貸方部門': '', '貸方取引先': '',
        '貸方税区分': '', '貸方インボイス': '', '貸方金額(円)': '',
        '摘要': p['摘要'], 'タグ': '', 'メモ': '',
    }


def _make_credit_row(tx_no, p, amount):
    return {
        '取引No': tx_no, '取引日': p['取引日'],
        '借方勘定科目': '', '借方補助科目': '', '借方部門': '', '借方取引先': '',
        '借方税区分': '', '借方インボイス': '', '借方金額(円)': '',
        '貸方勘定科目': p['貸方勘定科目'], '貸方補助科目': p['貸方補助科目'],
        '貸方部門': '', '貸方取引先': '', '貸方税区分': p['貸方税区分'],
        '貸方インボイス': '', '貸方金額(円)': amount,
        '摘要': p['摘要'], 'タグ': '', 'メモ': '',
    }


def write_csv_shift_jis(rows, output_path):
    with open(output_path, 'w', encoding='cp932', newline='', errors='replace') as f:
        writer = csv.DictWriter(f, fieldnames=MF_HEADERS, quoting=csv.QUOTE_ALL,
                                lineterminator='\r\n')
        writer.writeheader()
        writer.writerows(rows)


def upload_to_drive(drive, local_path, parent_folder_id, dest_name):
    # MediaFileUpload で Shift_JIS のままアップ
    ...


def write_mf_import_tab(sheets, ss_id, month_label, rows, drive_url):
    tab_name = f'MF取込_{month_label}'
    # ... タブ作成 → 19列+ダウンロードリンク行を書き込み ...


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--month', required=True)
    args = parser.parse_args()
    yymm = args.month

    # 仕訳案タブから A列「確定」の行のみ抽出
    confirmed = _read_confirmed_proposals(yymm)
    if not confirmed:
        print(f'[WARN] 確定済仕訳が0件です。CSV生成スキップ。')
        return

    # MF行展開
    mf_rows = []
    tx_no = 0
    for proposal in confirmed:
        tx_no += 1
        # バリデーション (借方=貸方一致、必須列埋め)
        if not _validate_proposal(proposal):
            print(f'[SKIP] 取引先 "{proposal["取引先"]}" の仕訳をスキップ (要修正)')
            continue
        mf_rows.extend(expand_to_mf_rows(proposal, tx_no))

    # ローカル一時ファイル → Drive
    ts = datetime.now().strftime('%Y%m%d-%H%M')
    month_label = f'YY.{int(yymm[2:])}月'
    fname = f'MF取込_中原_{month_label}_{ts}.csv'
    local_path = os.path.join(WORK_DIR, fname)
    write_csv_shift_jis(mf_rows, local_path)

    drive_url = upload_to_drive(...)
    write_mf_import_tab(...)

    print(f'[OK] {len(confirmed)} 仕訳 → {len(mf_rows)} 行のCSV を出力')
    print(f'     Drive: {drive_url}')
    print(f'     SS タブ: MF取込_{month_label}')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2**: テスト全件 PASS 確認
- [ ] **Step 3**: 2604 (確定欄を仮で全件「確定」にしてから) で実行
- [ ] **Step 4**: Drive と SS タブ目視確認
- [ ] **Step 5**: コミット

### Task D3: SKILL.md 更新 (Phase 7 + --export-mf フラグ)

**Files:**
- Modify: `C:\Users\orika\.claude\skills\nakahara-close\SKILL.md`

- [ ] **Step 1**: Phase 7 セクション追加
- [ ] **Step 2**: コマンド例 (`/nakahara-close --month YYMM --export-mf`) を追記
- [ ] **Step 3**: コミット

### Task D4: MF クラウドへのテストインポート

- [ ] 矢萩さんに依頼: 2604 CSV を MFクラウドの「仕訳インポート」テスト機能で取込
- [ ] エラーが出た場合はログ確認 → スクリプト改修
- [ ] 成功したら本番インポート可

---

## 検証 (Verification)

### リグレッション基準月 2603
- [ ] 試作v34 のM-Q列 検算OK率 ≥ 90%
- [ ] 仕訳案 O列OK率 ≥ 70%
- [ ] 既存売上¥166,731,546 / T4ポコロコ検算 差異¥+35,157 がそのまま再現

### 実運用初回 2604
- [ ] `/nakahara-close --month 2604` で Phase 1-6 が一気通貫
- [ ] 仕訳案タブで全件レビュー → 確定/保留/却下入力
- [ ] `--export-mf` で MF CSV出力 → MFクラウド取込成功

### 自動テスト
- [ ] `python .work/test_build_partner_mapping.py` 全件 PASS
- [ ] `python .work/test_journal_proposals.py` 全件 PASS
- [ ] `python .work/test_mf_csv_export.py` 全件 PASS

---

## 完了後の更新

- [ ] memory: `project_nakahara_accounting.md` を更新 (v2 仕訳ワークフロー追加済)
- [ ] memory: `feedback_*` 系で運用知見を新規メモリ化 (税率混在頻度、未登録取引先補完パターンなど)
- [ ] `SETUP_yahagi.md` を更新 (Phase 6/7 と --export-mf フラグの使い方)
