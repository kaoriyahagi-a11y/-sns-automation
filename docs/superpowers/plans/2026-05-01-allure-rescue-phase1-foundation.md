# Allure経理救援 Phase 1 (Foundation + C1) Implementation Plan

> ⚠️ **SUPERSEDED**: 本プランは 2026-05-19 に廃案。Python + Anthropic API ベースのアーキが `feedback_no_claude_dependency.md` と整合しないため。後継spec: [`2026-05-19-allure-rescue-gas-rewrite-design.md`](../specs/2026-05-19-allure-rescue-gas-rewrite-design.md)。新Planは別ファイルで作成予定。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 領収書PDF→「美容室：入出金経費管理」シート自動行追加パイプラインを動かす（C1のみ、TKC=FALSE運用、過去275行に対するバックテストで95%精度を達成する）。

**Architecture:** Python製の独立モジュール `allure-rescue/` を新規作成。既存 `receipt-ocr/` の Document AI + Drive + gspread スタックを流用しつつ、Allure固有のレイヤー（ファイル名→使用者抽出／部門マッピング／按分判定／LLM科目補完）を追加。出力は既存「美容室：入出金経費管理」シートに4列追加（部門／税区分／要確認／OCR信頼度）して書き込む。マスタは同シートに4タブ追加（_部門マスタ／_使用者マスタ／_科目マスタ／_按分マスタ）。

**Tech Stack:**
- Python 3.11+
- Google Document AI（既存processor `260618b8e03af14b` 流用）
- Google Drive API（既存サービスアカウント `receipt-bot@receipt-ocr-493416.iam.gserviceaccount.com`）
- gspread（Google Sheets API）
- anthropic（LLM科目補完用、Sonnet 4.6推奨）
- pytest（テスト）
- 既存リソース: `C:\Users\orika\sns-automation\receipt-ocr\` のコード参照
- ターゲットシート: `1BNI4MP40iNqVOEX9ecxkXgIhjpxrKbw6ECSYBEiJtNg`（美容室：入出金経費管理）
- ターゲットDriveルート: `1horqj0rzTvDLpLNVE91F8qoGncVhA9Fp`（美容室Allure）

**Scope (Plan 1):** Stage 0（Phase 0確認） + Stage 1（Foundation） + Stage 2（C1 領収書OCR）。
**Scope (Plan 2/3、別途作成):** C2 大型支払LLM補完／C3 仕入請求書OCR／C4 TKC FX2 CSVエクスポータ／E2E。

---

## ファイル構造（Plan 1で作成）

```
allure-rescue/
├── README.md
├── .env.example
├── .gitignore
├── pyproject.toml
├── pytest.ini
├── src/
│   ├── __init__.py
│   ├── config.py                    # 設定読み込み
│   ├── filename_parser.py           # 使用者抽出（ファイル名から）
│   ├── department.py                # 部門マッピング
│   ├── account_classifier.py        # 勘定科目推定（ルール＋LLM）
│   ├── allocation.py                # 按分判定
│   ├── ocr_client.py                # Document AI ラッパー
│   ├── sheet_client.py              # gspread ラッパー
│   ├── masters.py                   # マスタ4種の読み書き
│   ├── llm_client.py                # Anthropic API ラッパー
│   ├── ledger.py                    # 「入出金経費管理」シート操作
│   ├── c1_receipt_ocr.py            # C1 オーケストレータ
│   └── notify.py                    # Gmail通知
├── tests/
│   ├── __init__.py
│   ├── conftest.py                  # pytest fixtures
│   ├── unit/
│   │   ├── test_filename_parser.py
│   │   ├── test_department.py
│   │   ├── test_account_classifier.py
│   │   ├── test_allocation.py
│   │   └── test_ledger.py
│   ├── integration/
│   │   ├── test_c1_dryrun.py
│   │   └── test_backtest.py
│   └── fixtures/
│       └── receipts/                # 過去領収書PDFのサンプル数枚
└── scripts/
    ├── seed_masters.py              # マスタ4種の初期化
    ├── backtest.py                  # 過去275行に対する精度測定
    └── run_daily.py                 # 日次cron entrypoint
```

各ファイルの責務:
- `filename_parser.py`: 「領収書（戸田）25.10上③.pdf」→ `{使用者: "戸田", 期間: "25.10上", index: 3}` を返す純関数
- `department.py`: 使用者→部門コードのマッピング（`_使用者マスタ` を読む）
- `account_classifier.py`: 支払先→勘定科目を判定。まずルール（`_科目マスタ` の部分一致）、信頼度低ければLLM呼び出し
- `allocation.py`: サンレンタオル等の按分対象判定。過去行から配分パターン学習（`_按分マスタ` を参照）
- `ocr_client.py`: Document AI 呼出をラップ。既存 `receipt-ocr/main.py` の `process_doc/extract_entities` を関数化
- `sheet_client.py`: gspreadのラッパー。リトライ・レート制限ハンドリング
- `masters.py`: 4マスタタブ（_部門/_使用者/_科目/_按分）の読み書き
- `ledger.py`: 「入出金経費管理」シートの行追加・既存行検索（重複検知）
- `c1_receipt_ocr.py`: 上記を統合する1関数。`def run(dry_run: bool = False) -> Report` 形式
- `notify.py`: Gmail送信（実装は薄く、既存pl-automationのGAS通知と整合）

---

## Stage 0: Phase 0 Prerequisites（人手）

**注**: この段階は矢萩さん本人が動く。コードタスクではない。Stage 1着手前に確認結果を `docs/allure-rescue/phase0-answers.md` に書き留める。

### Task 0.1: 顧問税理士・福光事務所への確認

- [ ] **Step 1: 確認事項を整理して送付**

`docs/allure-rescue/phase0-answers.md` を新規作成し、以下の質問を投げて回答を埋める:

1. TKC FX2クラウドの汎用CSV取込機能は契約に含まれているか？
2. 含まれている場合、CSVフォーマット仕様書（列順・コード体系・サンプルファイル）を入手可能か？
3. 7店舗（Allure / FONS / IVY / ICY / NI / duft / Fivent）の部門コード一覧
4. 勘定科目コード一覧（特に：消耗品費／旅費交通費／会議費／通信費／荷造運賃／租税公課／カード支払／未払金／現金／仕入費）
5. 税区分コード一覧（課仕10% / 課仕8%軽 / 不課税 / 非課税）

- [ ] **Step 2: 戸田社長への確認**

`docs/allure-rescue/phase0-answers.md` に追記:
1. きくや美粧堂のFivent按分ルール（金額按分？固定割合？）
2. クレディセゾン明細の勘定科目分類方針

- [ ] **Step 3: コミット**

```bash
cd C:\Users\orika\sns-automation
git add docs/allure-rescue/phase0-answers.md
git commit -m "Phase 0: 顧問税理士・戸田社長への確認結果記録"
```

---

## Stage 1: Foundation

### Task 1.1: プロジェクト雛形作成

**Files:**
- Create: `allure-rescue/README.md`
- Create: `allure-rescue/.gitignore`
- Create: `allure-rescue/.env.example`
- Create: `allure-rescue/pyproject.toml`
- Create: `allure-rescue/pytest.ini`
- Create: `allure-rescue/src/__init__.py`
- Create: `allure-rescue/tests/__init__.py`

- [ ] **Step 1: ディレクトリ作成**

```bash
cd C:\Users\orika\sns-automation
mkdir -p allure-rescue/src allure-rescue/tests/unit allure-rescue/tests/integration allure-rescue/tests/fixtures/receipts allure-rescue/scripts
```

- [ ] **Step 2: README.md 作成**

`allure-rescue/README.md`:

```markdown
# Allure経理救援 Phase 1

会計担当者引継ぎ消失に伴うAllireグループ（株式会社Allure、7店舗）の仕訳起票自動化。

## スコープ（Phase 1, Plan 1）
- C1: 領収書PDF → 「美容室：入出金経費管理」シート自動行追加

## 関連ドキュメント
- 設計書: `../docs/superpowers/specs/2026-05-01-allure-rescue-design.md`
- 業務マップ: `../docs/allure-rescue/ops-map.md`
- 既存receipt-ocr（流用元）: `../receipt-ocr/`

## セットアップ
1. `.env.example` をコピーして `.env` を作成、値を埋める
2. `pip install -e .[dev]`
3. テスト: `pytest`
4. バックテスト: `python scripts/backtest.py`

## 運用（Phase 1, Plan 1）
- 日次OCR: `python scripts/run_daily.py`
- マスタ初期化: `python scripts/seed_masters.py`
```

- [ ] **Step 3: .gitignore 作成**

`allure-rescue/.gitignore`:

```
__pycache__/
*.pyc
.pytest_cache/
.env
*.json
!package.json
.venv/
.coverage
htmlcov/
dist/
*.egg-info/
```

- [ ] **Step 4: .env.example 作成**

`allure-rescue/.env.example`:

```
# Google
GOOGLE_KEY_FILE=C:\Users\orika\Downloads\receipt-ocr-493416-99159478bf10.json
DOCAI_PROJECT_ID=receipt-ocr-493416
DOCAI_LOCATION=us
DOCAI_PROCESSOR_ID=260618b8e03af14b

# Drive
DRIVE_ROOT_FOLDER_ID=1horqj0rzTvDLpLNVE91F8qoGncVhA9Fp

# Sheet
LEDGER_SHEET_ID=1BNI4MP40iNqVOEX9ecxkXgIhjpxrKbw6ECSYBEiJtNg

# Anthropic（LLM補完用）
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6

# Notify
GMAIL_NOTIFY_TO=orika.co.ltd@gmail.com
```

- [ ] **Step 5: pyproject.toml 作成**

`allure-rescue/pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "allure-rescue"
version = "0.1.0"
description = "Allure経理救援 Phase 1: 仕訳起票自動化"
requires-python = ">=3.11"
dependencies = [
    "google-cloud-documentai>=2.20",
    "google-api-python-client>=2.100",
    "google-auth>=2.23",
    "gspread>=5.10",
    "anthropic>=0.40",
    "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4",
    "pytest-cov>=4.1",
    "pytest-mock>=3.12",
]

[tool.setuptools.packages.find]
where = ["src"]
```

- [ ] **Step 6: pytest.ini 作成**

`allure-rescue/pytest.ini`:

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --tb=short --strict-markers
markers =
    integration: marks tests as integration tests (deselect with '-m "not integration"')
```

- [ ] **Step 7: 空の __init__.py を作成**

```bash
touch allure-rescue/src/__init__.py
touch allure-rescue/tests/__init__.py
touch allure-rescue/tests/unit/__init__.py
touch allure-rescue/tests/integration/__init__.py
```

- [ ] **Step 8: 依存関係インストール確認**

```bash
cd allure-rescue
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -e .[dev]
pytest --collect-only
```

期待: 「collected 0 items」と表示される（テストはまだ無いため）

- [ ] **Step 9: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/
git commit -m "Allure rescue: project skeleton"
```

### Task 1.2: config.py 実装

**Files:**
- Create: `allure-rescue/src/config.py`
- Create: `allure-rescue/tests/unit/test_config.py`

- [ ] **Step 1: テスト作成**

`allure-rescue/tests/unit/test_config.py`:

```python
import os
import pytest
from src import config


def test_load_returns_settings_with_required_fields(monkeypatch):
    monkeypatch.setenv("GOOGLE_KEY_FILE", "/tmp/key.json")
    monkeypatch.setenv("DOCAI_PROJECT_ID", "p")
    monkeypatch.setenv("DOCAI_LOCATION", "us")
    monkeypatch.setenv("DOCAI_PROCESSOR_ID", "x")
    monkeypatch.setenv("DRIVE_ROOT_FOLDER_ID", "fid")
    monkeypatch.setenv("LEDGER_SHEET_ID", "sid")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    monkeypatch.setenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    monkeypatch.setenv("GMAIL_NOTIFY_TO", "a@b.com")

    s = config.load()
    assert s.google_key_file == "/tmp/key.json"
    assert s.docai_project_id == "p"
    assert s.docai_location == "us"
    assert s.docai_processor_id == "x"
    assert s.drive_root_folder_id == "fid"
    assert s.ledger_sheet_id == "sid"
    assert s.anthropic_api_key == "k"
    assert s.anthropic_model == "claude-sonnet-4-6"
    assert s.gmail_notify_to == "a@b.com"


def test_load_raises_when_required_missing(monkeypatch):
    monkeypatch.delenv("GOOGLE_KEY_FILE", raising=False)
    with pytest.raises(KeyError, match="GOOGLE_KEY_FILE"):
        config.load()
```

- [ ] **Step 2: テスト実行 → FAIL を確認**

```bash
cd allure-rescue
pytest tests/unit/test_config.py -v
```

期待: ImportError （`src.config` がまだ無い）

- [ ] **Step 3: 最小実装**

`allure-rescue/src/config.py`:

```python
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    google_key_file: str
    docai_project_id: str
    docai_location: str
    docai_processor_id: str
    drive_root_folder_id: str
    ledger_sheet_id: str
    anthropic_api_key: str
    anthropic_model: str
    gmail_notify_to: str


def load() -> Settings:
    return Settings(
        google_key_file=os.environ["GOOGLE_KEY_FILE"],
        docai_project_id=os.environ["DOCAI_PROJECT_ID"],
        docai_location=os.environ["DOCAI_LOCATION"],
        docai_processor_id=os.environ["DOCAI_PROCESSOR_ID"],
        drive_root_folder_id=os.environ["DRIVE_ROOT_FOLDER_ID"],
        ledger_sheet_id=os.environ["LEDGER_SHEET_ID"],
        anthropic_api_key=os.environ["ANTHROPIC_API_KEY"],
        anthropic_model=os.environ["ANTHROPIC_MODEL"],
        gmail_notify_to=os.environ["GMAIL_NOTIFY_TO"],
    )
```

- [ ] **Step 4: テスト実行 → PASS**

```bash
pytest tests/unit/test_config.py -v
```

期待: 2 passed

- [ ] **Step 5: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/src/config.py allure-rescue/tests/unit/test_config.py
git commit -m "Allure rescue: config loader with dataclass"
```

### Task 1.3: シート列追加（手作業）

**Files:**
- Modify (manual): Google Sheets `1BNI4MP40iNqVOEX9ecxkXgIhjpxrKbw6ECSYBEiJtNg`「美容室：入出金経費管理」

- [ ] **Step 1: シートに4列追加**

矢萩さん作業:
1. https://docs.google.com/spreadsheets/d/1BNI4MP40iNqVOEX9ecxkXgIhjpxrKbw6ECSYBEiJtNg/ を開く
2. 既存シートのJ列以降に以下4列を追加:
   - **J列: 部門**（プルダウン: `001:Allure / 002:FONS / 003:IVY / 004:ICY / 005:NI / 006:duft / 007:Fivent`）
   - **K列: 税区分**（プルダウン: `課仕10% / 課仕8%軽 / 不課税 / 非課税`）
   - **L列: 要確認**（チェックボックス、デフォルト FALSE）
   - **M列: OCR信頼度**（数値、0.00〜1.00）
3. 既存3セクション（領収書経費／空テンプレ／大型支払）すべてに同じ列を追加
4. 既存行は部門/税区分は空欄のまま（後で `scripts/seed_masters.py` で埋める or 手で埋める）

- [ ] **Step 2: スクリーンショット取得し記録**

`docs/allure-rescue/screenshots/sheet-after-column-add.png` として保存（任意、運用記録用）

- [ ] **Step 3: 完了報告（コミット不要、手作業）**

### Task 1.4: マスタタブ追加（手作業＋seedスクリプト）

**Files:**
- Create: `allure-rescue/scripts/seed_masters.py`
- Modify (manual): 同シートにタブ4つ追加

- [ ] **Step 1: シートに空タブ4つ追加**

矢萩さん作業:
1. シートに以下4タブを新規追加:
   - `_部門マスタ`
   - `_使用者マスタ`
   - `_科目マスタ`
   - `_按分マスタ`
2. それぞれの1行目はヘッダーのみ（中身は空でOK、次のステップでseed）

- [ ] **Step 2: seed_masters.py 作成**

`allure-rescue/scripts/seed_masters.py`:

```python
"""マスタ4タブの初期データを投入する。既存データがある場合は何もしない。"""
import os
from dotenv import load_dotenv
from google.oauth2 import service_account
import gspread

load_dotenv()

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]

DEPARTMENT_HEADER = ["部門コード", "部門名", "略称", "TKC部門", "備考"]
DEPARTMENT_SEED = [
    ["001", "Allure", "Allure", "", "本店"],
    ["002", "FONS", "FONS", "", ""],
    ["003", "IVY", "IVY", "", ""],
    ["004", "ICY", "ICY", "", ""],
    ["005", "NI", "NI", "", ""],
    ["006", "duft", "duft", "", "2026-04開始"],
    ["007", "Fivent", "Fivent", "", "soshiji連動、コード要確認"],
]

USER_HEADER = ["使用者ID", "氏名", "所属部門コード", "PDFファイル名キー", "備考"]
USER_SEED = [
    ["戸田", "戸田社長", "001", "戸田", "フリー売上加算先"],
    ["NI", "NI店共通", "005", "NI|ni|Ni", ""],
    ["IVY", "IVY店共通", "003", "IVY|Ivy|ivy", ""],
    ["ICY", "ICY店共通", "004", "ICY|Icy", ""],
    ["FONS", "FONS店共通", "002", "FONS|fons", ""],
    ["Allure", "Allure店共通", "001", "Allure|allure", ""],
    ["duft", "duft店共通", "006", "duft|Duft", ""],
]

ACCOUNT_HEADER = ["支払先パターン", "勘定科目", "税区分", "信頼度", "備考"]
ACCOUNT_SEED = [
    ["マツモトキヨシ", "消耗品費", "課仕10%", "高", ""],
    ["セブンイレブン", "旅費交通費", "課仕10%", "中", "プリペイド充当が多い"],
    ["FamilyMart", "旅費交通費", "課仕10%", "中", "プリペイド充当が多い"],
    ["JR東日本", "旅費交通費", "不課税", "高", ""],
    ["東急電鉄", "旅費交通費", "不課税", "高", ""],
    ["東京地下鉄", "旅費交通費", "不課税", "高", ""],
    ["パスモ", "旅費交通費", "不課税", "高", ""],
    ["ASKUL", "消耗品費", "課仕10%", "高", "グリーン商品消耗品費の場合あり"],
    ["サンレンタオル", "消耗品費", "課仕10%", "高", "按分要"],
    ["クレディセゾン", "カード支払", "", "要確認", "内訳依存"],
    ["セゾンAMEX", "カード支払", "", "要確認", "内訳依存"],
    ["リクルート", "広告宣伝費", "課仕10%", "中", ""],
    ["住民税", "租税公課", "不課税", "高", ""],
    ["消費税地方税", "租税公課", "不課税", "高", ""],
    ["アクティム", "仕入費", "課仕10%", "中", ""],
    ["SCENE", "仕入費", "課仕10%", "中", ""],
    ["Arrows aoyama", "仕入費", "課仕10%", "中", ""],
    ["ULTOWA office", "仕入費", "課仕10%", "高", ""],
    ["きくや美粧堂", "仕入費", "課仕10%", "高", "Fivent按分要、ルール未確認"],
]

ALLOC_HEADER = ["支払先", "按分パターン", "配分", "備考"]
ALLOC_SEED = [
    ["サンレンタオル", "4店按分", "Allure/FONS/IVY/ICY を金額別", "過去行から金額学習"],
    ["ASKUL", "使用者按分", "使用者列の店舗にそのまま", ""],
    ["きくや美粧堂", "Fivent+メイン按分", "TBD", "戸田社長確認待ち"],
]


def main():
    creds = service_account.Credentials.from_service_account_file(
        os.environ["GOOGLE_KEY_FILE"], scopes=SCOPES
    )
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(os.environ["LEDGER_SHEET_ID"])

    seeds = [
        ("_部門マスタ", DEPARTMENT_HEADER, DEPARTMENT_SEED),
        ("_使用者マスタ", USER_HEADER, USER_SEED),
        ("_科目マスタ", ACCOUNT_HEADER, ACCOUNT_SEED),
        ("_按分マスタ", ALLOC_HEADER, ALLOC_SEED),
    ]
    for tab_name, header, rows in seeds:
        try:
            ws = sh.worksheet(tab_name)
        except gspread.WorksheetNotFound:
            ws = sh.add_worksheet(title=tab_name, rows=200, cols=10)

        existing = ws.get_all_values()
        if existing and len(existing) > 1:
            print(f"  [{tab_name}] 既存データあり、スキップ")
            continue
        ws.update("A1", [header] + rows)
        print(f"  [{tab_name}] {len(rows)}行投入")
    print("完了")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: スクリプト実行**

```bash
cd allure-rescue
python scripts/seed_masters.py
```

期待出力:
```
  [_部門マスタ] 7行投入
  [_使用者マスタ] 7行投入
  [_科目マスタ] 19行投入
  [_按分マスタ] 3行投入
完了
```

- [ ] **Step 4: シートで目視確認**

シート上で4タブが正しくseedされたか確認。空でない過去275行から漏れている支払先があれば `_科目マスタ` に追加。

- [ ] **Step 5: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/scripts/seed_masters.py
git commit -m "Allure rescue: seed master sheets script"
```

---

## Stage 2: C1 領収書OCR

### Task 2.1: filename_parser.py

**Files:**
- Create: `allure-rescue/src/filename_parser.py`
- Create: `allure-rescue/tests/unit/test_filename_parser.py`

- [ ] **Step 1: テスト作成**

`allure-rescue/tests/unit/test_filename_parser.py`:

```python
import pytest
from src.filename_parser import parse


@pytest.mark.parametrize("filename, expected", [
    ("領収書（戸田）25.10上③.pdf", {"user": "戸田", "period": "25.10上", "index": 3}),
    ("領収書（戸田）25.10上①.pdf", {"user": "戸田", "period": "25.10上", "index": 1}),
    ("領収書（戸田）25.10下②.pdf", {"user": "戸田", "period": "25.10下", "index": 2}),
    ("領収書(IVY)25.10上.pdf", {"user": "IVY", "period": "25.10上", "index": None}),
    ("領収書（NI）25.10下⑤.pdf", {"user": "NI", "period": "25.10下", "index": 5}),
    ("領収書（FONS）25.10上①.pdf", {"user": "FONS", "period": "25.10上", "index": 1}),
    ("領収書（ICY）25.10下①.pdf", {"user": "ICY", "period": "25.10下", "index": 1}),
    ("領収書（Allure)合算25.12上.pdf", {"user": "Allure", "period": "25.12上", "index": None}),
    ("領収書サンレンタオル25.12.pdf", {"user": None, "period": "25.12", "index": None}),
    ("Arrows aoyama 2025年11月発行分.pdf", {"user": None, "period": None, "index": None}),
    ("✅領収書（IVY）25.10下② .pdf", {"user": "IVY", "period": "25.10下", "index": 2}),
])
def test_parse_extracts_user_period_index(filename, expected):
    result = parse(filename)
    assert result == expected


def test_parse_returns_none_for_unparseable():
    result = parse("randomfile.pdf")
    assert result == {"user": None, "period": None, "index": None}
```

- [ ] **Step 2: テスト実行 → FAIL**

```bash
cd allure-rescue
pytest tests/unit/test_filename_parser.py -v
```

期待: ImportError

- [ ] **Step 3: 最小実装**

`allure-rescue/src/filename_parser.py`:

```python
"""PDFファイル名から使用者・期間・インデックスを抽出する。

例: 領収書（戸田）25.10上③.pdf → {user: 戸田, period: 25.10上, index: 3}
"""
import re
from typing import Optional


_USER_RE = re.compile(r"領収書[（(]([^）)]+)[）)]")
_PERIOD_RE = re.compile(r"(\d{2}\.\d{1,2}(?:上|下)?)")
_INDEX_MAP = {"①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5, "⑥": 6, "⑦": 7, "⑧": 8, "⑨": 9, "⑩": 10}


def parse(filename: str) -> dict:
    """ファイル名をパース。失敗フィールドはNoneを返す。"""
    user = _extract_user(filename)
    period = _extract_period(filename)
    index = _extract_index(filename)
    return {"user": user, "period": period, "index": index}


def _extract_user(filename: str) -> Optional[str]:
    m = _USER_RE.search(filename)
    return m.group(1).strip() if m else None


def _extract_period(filename: str) -> Optional[str]:
    m = _PERIOD_RE.search(filename)
    return m.group(1) if m else None


def _extract_index(filename: str) -> Optional[int]:
    for ch, n in _INDEX_MAP.items():
        if ch in filename:
            return n
    return None
```

- [ ] **Step 4: テスト実行 → PASS**

```bash
pytest tests/unit/test_filename_parser.py -v
```

期待: 12 passed

- [ ] **Step 5: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/src/filename_parser.py allure-rescue/tests/unit/test_filename_parser.py
git commit -m "Allure rescue: filename parser (user/period/index)"
```

### Task 2.2: department.py

**Files:**
- Create: `allure-rescue/src/department.py`
- Create: `allure-rescue/tests/unit/test_department.py`

- [ ] **Step 1: テスト作成**

`allure-rescue/tests/unit/test_department.py`:

```python
import pytest
from src.department import lookup, DepartmentMaster


@pytest.fixture
def master():
    rows = [
        {"使用者ID": "戸田", "氏名": "戸田社長", "所属部門コード": "001", "PDFファイル名キー": "戸田", "備考": ""},
        {"使用者ID": "NI", "氏名": "NI店共通", "所属部門コード": "005", "PDFファイル名キー": "NI|ni|Ni", "備考": ""},
        {"使用者ID": "IVY", "氏名": "IVY店共通", "所属部門コード": "003", "PDFファイル名キー": "IVY|Ivy|ivy", "備考": ""},
    ]
    return DepartmentMaster(rows)


def test_lookup_known_user(master):
    assert lookup("戸田", master) == "001"


def test_lookup_case_variant(master):
    assert lookup("ivy", master) == "003"


def test_lookup_unknown_returns_none(master):
    assert lookup("田中", master) is None


def test_lookup_none_user_returns_none(master):
    assert lookup(None, master) is None
```

- [ ] **Step 2: テスト実行 → FAIL**

```bash
pytest tests/unit/test_department.py -v
```

期待: ImportError

- [ ] **Step 3: 実装**

`allure-rescue/src/department.py`:

```python
"""使用者→部門コードのマッピング。`_使用者マスタ` を参照する。"""
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class DepartmentMaster:
    """`_使用者マスタ` シートの行データ。"""
    rows: List[dict]

    def keys_for_dept(self, user: str) -> Optional[str]:
        """ユーザー名（PDFファイル名キーのいずれか）にマッチする部門コードを返す。大小無視。"""
        if not user:
            return None
        u_lower = user.lower()
        for row in self.rows:
            keys = (row.get("PDFファイル名キー") or "").split("|")
            if any(k.strip().lower() == u_lower for k in keys if k.strip()):
                return row.get("所属部門コード")
        return None


def lookup(user: Optional[str], master: DepartmentMaster) -> Optional[str]:
    """使用者→部門コード。未登録ならNone（呼び出し側で要確認フラグ立て）。"""
    return master.keys_for_dept(user)
```

- [ ] **Step 4: テスト実行 → PASS**

```bash
pytest tests/unit/test_department.py -v
```

期待: 4 passed

- [ ] **Step 5: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/src/department.py allure-rescue/tests/unit/test_department.py
git commit -m "Allure rescue: department lookup from user master"
```

### Task 2.3: account_classifier.py（ルールベース）

**Files:**
- Create: `allure-rescue/src/account_classifier.py`
- Create: `allure-rescue/tests/unit/test_account_classifier.py`

- [ ] **Step 1: テスト作成**

`allure-rescue/tests/unit/test_account_classifier.py`:

```python
import pytest
from src.account_classifier import classify_by_rule, AccountMaster


@pytest.fixture
def master():
    rows = [
        {"支払先パターン": "マツモトキヨシ", "勘定科目": "消耗品費", "税区分": "課仕10%", "信頼度": "高"},
        {"支払先パターン": "JR東日本", "勘定科目": "旅費交通費", "税区分": "不課税", "信頼度": "高"},
        {"支払先パターン": "ASKUL", "勘定科目": "消耗品費", "税区分": "課仕10%", "信頼度": "高"},
        {"支払先パターン": "サンレンタオル", "勘定科目": "消耗品費", "税区分": "課仕10%", "信頼度": "高"},
    ]
    return AccountMaster(rows)


def test_classify_known_supplier(master):
    result = classify_by_rule("マツモトキヨシ", master)
    assert result.account == "消耗品費"
    assert result.tax == "課仕10%"
    assert result.confidence == 1.0
    assert result.source == "rule"


def test_classify_partial_match(master):
    result = classify_by_rule("マツモトキヨシ 渋谷店", master)
    assert result.account == "消耗品費"


def test_classify_unknown_returns_low_confidence(master):
    result = classify_by_rule("謎のショップ", master)
    assert result.account is None
    assert result.confidence == 0.0
    assert result.source == "rule_miss"
```

- [ ] **Step 2: テスト実行 → FAIL**

```bash
pytest tests/unit/test_account_classifier.py -v
```

期待: ImportError

- [ ] **Step 3: 実装**

`allure-rescue/src/account_classifier.py`:

```python
"""勘定科目分類。`_科目マスタ` でルールベース→未ヒットならLLMフォールバック。"""
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class ClassifyResult:
    account: Optional[str]
    tax: Optional[str]
    confidence: float  # 0.0〜1.0
    source: str  # "rule" | "rule_miss" | "llm"


@dataclass
class AccountMaster:
    """`_科目マスタ` シートの行データ。"""
    rows: List[dict]


def classify_by_rule(supplier: str, master: AccountMaster) -> ClassifyResult:
    """支払先文字列に対して `_科目マスタ` の部分一致を試す。最初のヒットを返す。"""
    if not supplier:
        return ClassifyResult(None, None, 0.0, "rule_miss")
    for row in master.rows:
        pattern = row.get("支払先パターン") or ""
        if pattern and pattern in supplier:
            return ClassifyResult(
                account=row.get("勘定科目"),
                tax=row.get("税区分"),
                confidence=1.0,
                source="rule",
            )
    return ClassifyResult(None, None, 0.0, "rule_miss")
```

- [ ] **Step 4: テスト実行 → PASS**

```bash
pytest tests/unit/test_account_classifier.py -v
```

期待: 3 passed

- [ ] **Step 5: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/src/account_classifier.py allure-rescue/tests/unit/test_account_classifier.py
git commit -m "Allure rescue: rule-based account classifier"
```

### Task 2.4: account_classifier.py（LLMフォールバック）

**Files:**
- Modify: `allure-rescue/src/account_classifier.py`
- Create: `allure-rescue/src/llm_client.py`
- Modify: `allure-rescue/tests/unit/test_account_classifier.py`

- [ ] **Step 1: llm_client.py 作成**

`allure-rescue/src/llm_client.py`:

```python
"""Anthropic API のラッパー。プロンプトキャッシュ対応。"""
import json
from typing import Protocol
from anthropic import Anthropic


class LLMClient(Protocol):
    def classify_account(self, supplier: str, candidates: list[str]) -> dict:
        ...


class AnthropicClassifier:
    def __init__(self, api_key: str, model: str = "claude-sonnet-4-6"):
        self.client = Anthropic(api_key=api_key)
        self.model = model

    def classify_account(self, supplier: str, candidates: list[str]) -> dict:
        """支払先名と候補リストから勘定科目を返す。
        Returns: {"account": str, "tax": str, "confidence": float, "reason": str}
        """
        prompt = self._build_prompt(supplier, candidates)
        resp = self.client.messages.create(
            model=self.model,
            max_tokens=300,
            system=[{
                "type": "text",
                "text": _SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text
        return self._parse(text)

    def _build_prompt(self, supplier: str, candidates: list[str]) -> str:
        cand_str = "\n".join(f"- {c}" for c in candidates)
        return (
            f"支払先: {supplier}\n\n"
            f"候補となる勘定科目:\n{cand_str}\n\n"
            "JSON形式で {{\"account\": \"...\", \"tax\": \"課仕10%/課仕8%軽/不課税/非課税のいずれか\", "
            "\"confidence\": 0.0〜1.0, \"reason\": \"...\"}} を返してください。"
        )

    def _parse(self, text: str) -> dict:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end < 0:
            return {"account": None, "tax": None, "confidence": 0.0, "reason": "parse_fail"}
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            return {"account": None, "tax": None, "confidence": 0.0, "reason": "json_fail"}


_SYSTEM_PROMPT = """あなたは美容室Allireグループの経理担当アシスタントです。
領収書の支払先名から、もっとも適切な勘定科目を選んでください。
迷う場合は confidence を低く（< 0.7）してください。"""
```

- [ ] **Step 2: テスト追加**

`allure-rescue/tests/unit/test_account_classifier.py` に追加:

```python
from src.account_classifier import classify_with_llm
from unittest.mock import MagicMock


def test_classify_with_llm_returns_high_confidence_when_llm_confident(master):
    llm = MagicMock()
    llm.classify_account.return_value = {
        "account": "通信費", "tax": "課仕10%", "confidence": 0.92, "reason": "電話"
    }
    result = classify_with_llm("NTTドコモ", master, llm, candidates=["通信費", "消耗品費"])
    assert result.account == "通信費"
    assert result.confidence == 0.92
    assert result.source == "llm"


def test_classify_with_llm_low_confidence_returned(master):
    llm = MagicMock()
    llm.classify_account.return_value = {
        "account": "雑費", "tax": "課仕10%", "confidence": 0.4, "reason": "不明"
    }
    result = classify_with_llm("謎ショップ", master, llm, candidates=["消耗品費"])
    assert result.confidence == 0.4
```

- [ ] **Step 3: テスト実行 → FAIL**

```bash
pytest tests/unit/test_account_classifier.py -v
```

期待: ImportError on `classify_with_llm`

- [ ] **Step 4: 実装追加**

`allure-rescue/src/account_classifier.py` に追加:

```python
from .llm_client import LLMClient


def classify_with_llm(
    supplier: str,
    master: AccountMaster,
    llm: LLMClient,
    candidates: Optional[list[str]] = None,
) -> ClassifyResult:
    """ルール未ヒット時のLLMフォールバック。"""
    if candidates is None:
        candidates = sorted({row.get("勘定科目") for row in master.rows if row.get("勘定科目")})
    res = llm.classify_account(supplier, candidates)
    return ClassifyResult(
        account=res.get("account"),
        tax=res.get("tax"),
        confidence=float(res.get("confidence", 0.0)),
        source="llm",
    )
```

- [ ] **Step 5: テスト実行 → PASS**

```bash
pytest tests/unit/test_account_classifier.py -v
```

期待: 5 passed

- [ ] **Step 6: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/src/account_classifier.py allure-rescue/src/llm_client.py allure-rescue/tests/unit/test_account_classifier.py
git commit -m "Allure rescue: LLM fallback classifier with Anthropic"
```

### Task 2.5: allocation.py

**Files:**
- Create: `allure-rescue/src/allocation.py`
- Create: `allure-rescue/tests/unit/test_allocation.py`

- [ ] **Step 1: テスト作成**

`allure-rescue/tests/unit/test_allocation.py`:

```python
import pytest
from src.allocation import detect, AllocationMaster, Allocation


@pytest.fixture
def master():
    rows = [
        {"支払先": "サンレンタオル", "按分パターン": "4店按分", "配分": "Allure/FONS/IVY/ICY を金額別"},
        {"支払先": "ASKUL", "按分パターン": "使用者按分", "配分": "使用者列の店舗にそのまま"},
    ]
    return AllocationMaster(rows)


def test_detect_known_allocation_target(master):
    result = detect("サンレンタオル", master)
    assert result is not None
    assert result.pattern == "4店按分"


def test_detect_unknown_returns_none(master):
    result = detect("マツモトキヨシ", master)
    assert result is None


def test_detect_partial_match(master):
    result = detect("サンレンタオル 株式会社", master)
    assert result is not None
    assert result.pattern == "4店按分"


def test_detect_none_supplier_returns_none(master):
    assert detect(None, master) is None
```

- [ ] **Step 2: テスト実行 → FAIL**

```bash
pytest tests/unit/test_allocation.py -v
```

期待: ImportError

- [ ] **Step 3: 実装**

`allure-rescue/src/allocation.py`:

```python
"""按分対象判定。`_按分マスタ` を参照。"""
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class Allocation:
    """按分ルール。pattern は人間が読むラベル。"""
    supplier: str
    pattern: str
    distribution: str


@dataclass
class AllocationMaster:
    rows: List[dict]


def detect(supplier: Optional[str], master: AllocationMaster) -> Optional[Allocation]:
    """支払先が按分対象なら Allocation を返す。対象外なら None。
    
    判定は部分一致（マスタの「支払先」が引数のsupplierに含まれていればヒット）。
    """
    if not supplier:
        return None
    for row in master.rows:
        target = row.get("支払先") or ""
        if target and target in supplier:
            return Allocation(
                supplier=target,
                pattern=row.get("按分パターン") or "",
                distribution=row.get("配分") or "",
            )
    return None
```

- [ ] **Step 4: テスト実行 → PASS**

```bash
pytest tests/unit/test_allocation.py -v
```

期待: 4 passed

- [ ] **Step 5: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/src/allocation.py allure-rescue/tests/unit/test_allocation.py
git commit -m "Allure rescue: allocation detection"
```

### Task 2.6: ocr_client.py（Document AI ラッパー）

**Files:**
- Create: `allure-rescue/src/ocr_client.py`
- Create: `allure-rescue/tests/unit/test_ocr_client.py`

- [ ] **Step 1: テスト作成**

`allure-rescue/tests/unit/test_ocr_client.py`:

```python
"""ocr_client は外部API呼び出し中心なのでパース部分のみテスト。"""
import pytest
from src.ocr_client import normalize_amount, normalize_date


@pytest.mark.parametrize("input_str, expected", [
    ("¥1,234", 1234),
    ("1234円", 1234),
    ("1,234.00", 1234),
    ("1234.5", 1234.5),
    ("", ""),
    (None, ""),
    ("abc", ""),
])
def test_normalize_amount(input_str, expected):
    assert normalize_amount(input_str) == expected


@pytest.mark.parametrize("input_str, expected", [
    ("2025/10/30", "2025/10/30"),
    ("2025-10-30", "2025/10/30"),
    ("25/10/30", "2025/10/30"),
    ("令和7年10月30日", "令和7年10月30日"),  # 和暦は素通し
    ("", ""),
])
def test_normalize_date(input_str, expected):
    assert normalize_date(input_str) == expected
```

- [ ] **Step 2: テスト実行 → FAIL**

```bash
pytest tests/unit/test_ocr_client.py -v
```

期待: ImportError

- [ ] **Step 3: 実装（既存receipt-ocr/main.pyから流用）**

`allure-rescue/src/ocr_client.py`:

```python
"""Document AI ラッパー。既存 receipt-ocr/main.py の OCR部分を関数化したもの。"""
import io
import re
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional
from google.oauth2 import service_account
from google.cloud import documentai
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload


SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/cloud-platform",
]

MIME_MAP = {
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
    "image/png": "image/png",
    "image/heic": "image/heic",
    "image/heif": "image/heif",
    "application/pdf": "application/pdf",
}


@dataclass
class OCRResult:
    """OCR抽出結果。"""
    receipt_date: str = ""
    supplier_name: str = ""
    total_amount: object = ""  # int | float | ""
    total_tax_amount: object = ""
    invoice_number: str = ""
    payment_type: str = ""
    line_items: str = ""
    confidence: float = 0.0  # 主要フィールドの平均信頼度


def get_credentials(key_file: str):
    return service_account.Credentials.from_service_account_file(key_file, scopes=SCOPES)


def build_drive_client(creds):
    return build("drive", "v3", credentials=creds)


def build_docai_client(creds, location: str):
    opts = {"api_endpoint": f"{location}-documentai.googleapis.com"}
    return documentai.DocumentProcessorServiceClient(credentials=creds, client_options=opts)


def download_file(drive, file_id: str) -> bytes:
    req = drive.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, req)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue()


def process_doc(docai_client, processor_name: str, content: bytes, mime_type: str):
    raw_doc = documentai.RawDocument(content=content, mime_type=mime_type)
    request = documentai.ProcessRequest(name=processor_name, raw_document=raw_doc)
    result = docai_client.process_document(request=request)
    return result.document


_INVOICE_RE = re.compile(r"T\s*[-‐－]?\s*(\d[\s\d]{12,14})")


def extract_invoice_number(text: str) -> str:
    if not text:
        return ""
    for m in _INVOICE_RE.finditer(text):
        digits = re.sub(r"\D", "", m.group(1))
        if len(digits) == 13:
            return f"T{digits}"
    return ""


def normalize_amount(s) -> object:
    """金額文字列→int/float/空文字。"""
    if not s:
        return ""
    s = str(s).replace(",", "").replace("，", "").replace("¥", "").replace("￥", "")
    s = s.replace("円", "").strip()
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return ""
    try:
        v = float(m.group())
        return int(v) if v.is_integer() else v
    except ValueError:
        return ""


def normalize_date(s: str) -> str:
    """日付文字列→YYYY/MM/DD。和暦・パース失敗は素通し。"""
    if not s:
        return ""
    s = re.sub(r"\s+", "", s.strip())
    m = re.search(r"(\d{2,4})\D(\d{1,2})\D(\d{1,2})", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:
            y += 2000
        try:
            return datetime(y, mo, d).strftime("%Y/%m/%d")
        except ValueError:
            pass
    return s


def extract_entities(document) -> OCRResult:
    """Document AI の document → OCRResult。"""
    fields = ("receipt_date", "supplier_name", "total_amount", "total_tax_amount", "payment_type")
    raw = {f: "" for f in fields}
    confidences = []
    items = []
    for ent in document.entities:
        t = ent.type_
        v = ent.mention_text or (ent.normalized_value.text if ent.normalized_value else "")
        if t in raw and not raw[t]:
            raw[t] = v
            if hasattr(ent, "confidence"):
                confidences.append(ent.confidence)
        if t == "line_item":
            desc = amt = ""
            for p in ent.properties:
                if p.type_ == "line_item/description":
                    desc = p.mention_text
                elif p.type_ == "line_item/amount":
                    amt = p.mention_text
            items.append(f"{desc}={amt}" if amt else desc)
    return OCRResult(
        receipt_date=normalize_date(raw["receipt_date"]),
        supplier_name=raw["supplier_name"].strip(),
        total_amount=normalize_amount(raw["total_amount"]),
        total_tax_amount=normalize_amount(raw["total_tax_amount"]),
        invoice_number=extract_invoice_number(document.text),
        payment_type=raw["payment_type"].strip(),
        line_items=" | ".join(items),
        confidence=sum(confidences) / len(confidences) if confidences else 0.0,
    )
```

- [ ] **Step 4: テスト実行 → PASS**

```bash
pytest tests/unit/test_ocr_client.py -v
```

期待: 12 passed

- [ ] **Step 5: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/src/ocr_client.py allure-rescue/tests/unit/test_ocr_client.py
git commit -m "Allure rescue: Document AI wrapper (OCR client)"
```

### Task 2.7: sheet_client.py + masters.py（gspread ラッパー）

**Files:**
- Create: `allure-rescue/src/sheet_client.py`
- Create: `allure-rescue/src/masters.py`
- Create: `allure-rescue/tests/unit/test_masters.py`

- [ ] **Step 1: sheet_client.py 実装（薄いラッパー、ノーテスト）**

`allure-rescue/src/sheet_client.py`:

```python
"""gspread の薄いラッパー。リトライ・キャッシュは将来追加。"""
import gspread
from google.oauth2 import service_account


SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]


def open_sheet(key_file: str, sheet_id: str):
    creds = service_account.Credentials.from_service_account_file(key_file, scopes=SCOPES)
    gc = gspread.authorize(creds)
    return gc.open_by_key(sheet_id)
```

- [ ] **Step 2: masters.py テスト作成**

`allure-rescue/tests/unit/test_masters.py`:

```python
from unittest.mock import MagicMock
from src.masters import load_all, MasterBundle


def test_load_all_reads_4_tabs():
    mock_sh = MagicMock()
    mock_sh.worksheet.side_effect = lambda name: _ws_for(name)

    bundle = load_all(mock_sh)
    assert isinstance(bundle, MasterBundle)
    assert len(bundle.department.rows) > 0
    assert len(bundle.user.rows) > 0
    assert len(bundle.account.rows) > 0
    assert len(bundle.allocation.rows) > 0


def _ws_for(name):
    ws = MagicMock()
    if name == "_部門マスタ":
        ws.get_all_records.return_value = [
            {"部門コード": "001", "部門名": "Allure", "略称": "Allure", "TKC部門": "", "備考": ""},
        ]
    elif name == "_使用者マスタ":
        ws.get_all_records.return_value = [
            {"使用者ID": "戸田", "氏名": "戸田社長", "所属部門コード": "001", "PDFファイル名キー": "戸田", "備考": ""},
        ]
    elif name == "_科目マスタ":
        ws.get_all_records.return_value = [
            {"支払先パターン": "マツモトキヨシ", "勘定科目": "消耗品費", "税区分": "課仕10%", "信頼度": "高", "備考": ""},
        ]
    elif name == "_按分マスタ":
        ws.get_all_records.return_value = [
            {"支払先": "サンレンタオル", "按分パターン": "4店按分", "配分": "Allure/FONS/IVY/ICY", "備考": ""},
        ]
    return ws
```

- [ ] **Step 3: masters.py 実装**

`allure-rescue/src/masters.py`:

```python
"""マスタ4種をまとめてロード/書き込みするモジュール。"""
from dataclasses import dataclass
from .department import DepartmentMaster
from .account_classifier import AccountMaster
from .allocation import AllocationMaster


@dataclass
class _DeptMaster:
    """`_部門マスタ` 用（参照のみ）。"""
    rows: list


@dataclass
class MasterBundle:
    department: _DeptMaster  # 部門マスタ
    user: DepartmentMaster   # 使用者マスタ（DepartmentMasterはuser→deptを持つので名前混乱注意）
    account: AccountMaster
    allocation: AllocationMaster


def load_all(sh) -> MasterBundle:
    """gspread.Spreadsheet から4マスタを一括読込。"""
    return MasterBundle(
        department=_DeptMaster(sh.worksheet("_部門マスタ").get_all_records()),
        user=DepartmentMaster(sh.worksheet("_使用者マスタ").get_all_records()),
        account=AccountMaster(sh.worksheet("_科目マスタ").get_all_records()),
        allocation=AllocationMaster(sh.worksheet("_按分マスタ").get_all_records()),
    )
```

- [ ] **Step 4: テスト実行 → PASS**

```bash
pytest tests/unit/test_masters.py -v
```

期待: 1 passed

- [ ] **Step 5: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/src/sheet_client.py allure-rescue/src/masters.py allure-rescue/tests/unit/test_masters.py
git commit -m "Allure rescue: sheet client and masters bundle loader"
```

### Task 2.8: ledger.py（「入出金経費管理」シート操作）

**Files:**
- Create: `allure-rescue/src/ledger.py`
- Create: `allure-rescue/tests/unit/test_ledger.py`

- [ ] **Step 1: テスト作成**

`allure-rescue/tests/unit/test_ledger.py`:

```python
from unittest.mock import MagicMock
from src.ledger import LedgerRow, build_row, find_duplicate, COLUMNS


def test_columns_match_design():
    expected = [
        "NO", "領収日", "支払先", "勘定科目", "合計金額", "使用者",
        "リンク", "TKC", "備考", "部門", "税区分", "要確認", "OCR信頼度",
    ]
    assert COLUMNS == expected


def test_build_row_full():
    row = LedgerRow(
        no=276,
        date="2025/10/30",
        supplier="マツモトキヨシ",
        account="消耗品費",
        amount=590,
        user="戸田",
        link="領収書（戸田）25.10下.pdf",
        tkc=False,
        memo="",
        department="001:Allure",
        tax="課仕10%",
        review_required=False,
        ocr_confidence=0.92,
    )
    flat = build_row(row)
    assert flat[0] == 276
    assert flat[3] == "消耗品費"
    assert flat[8] == ""  # memo
    assert flat[9] == "001:Allure"
    assert flat[12] == 0.92


def test_find_duplicate_matches_date_amount_supplier():
    existing_rows = [
        ["1", "2025/10/30", "マツモトキヨシ", "消耗品費", "590", "戸田", "x.pdf", "TRUE", "", "001", "課仕10%", "FALSE", "0.9"],
    ]
    candidate = LedgerRow(no=2, date="2025/10/30", supplier="マツモトキヨシ", account="", amount=590, user="戸田", link="y.pdf")
    assert find_duplicate(candidate, existing_rows) is not None


def test_find_duplicate_no_match_when_amount_differs():
    existing_rows = [
        ["1", "2025/10/30", "マツモトキヨシ", "消耗品費", "590", "戸田", "x.pdf", "TRUE", "", "001", "課仕10%", "FALSE", "0.9"],
    ]
    candidate = LedgerRow(no=2, date="2025/10/30", supplier="マツモトキヨシ", account="", amount=600, user="戸田", link="y.pdf")
    assert find_duplicate(candidate, existing_rows) is None
```

- [ ] **Step 2: テスト実行 → FAIL**

```bash
pytest tests/unit/test_ledger.py -v
```

期待: ImportError

- [ ] **Step 3: 実装**

`allure-rescue/src/ledger.py`:

```python
"""「美容室：入出金経費管理」シートの行操作。"""
from dataclasses import dataclass, field
from typing import List, Optional


COLUMNS = [
    "NO", "領収日", "支払先", "勘定科目", "合計金額", "使用者",
    "リンク", "TKC", "備考", "部門", "税区分", "要確認", "OCR信頼度",
]


@dataclass
class LedgerRow:
    no: int
    date: str
    supplier: str
    account: str
    amount: object  # int|float
    user: str
    link: str
    tkc: bool = False
    memo: str = ""
    department: str = ""
    tax: str = ""
    review_required: bool = False
    ocr_confidence: float = 0.0


def build_row(row: LedgerRow) -> list:
    """LedgerRow をシート1行（list）に展開。"""
    return [
        row.no,
        row.date,
        row.supplier,
        row.account,
        row.amount,
        row.user,
        row.link,
        "TRUE" if row.tkc else "FALSE",
        row.memo,
        row.department,
        row.tax,
        "TRUE" if row.review_required else "FALSE",
        row.ocr_confidence,
    ]


def find_duplicate(candidate: LedgerRow, existing: List[list]) -> Optional[int]:
    """既存行リストから (date, supplier, amount) が一致する行のindex（0始まり）を返す。"""
    cand_amt = str(candidate.amount).replace(",", "").strip()
    for i, row in enumerate(existing):
        if len(row) < 5:
            continue
        if row[1].strip() == candidate.date.strip() \
                and row[2].strip() == candidate.supplier.strip() \
                and str(row[4]).replace(",", "").strip() == cand_amt:
            return i
    return None
```

- [ ] **Step 4: テスト実行 → PASS**

```bash
pytest tests/unit/test_ledger.py -v
```

期待: 4 passed

- [ ] **Step 5: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/src/ledger.py allure-rescue/tests/unit/test_ledger.py
git commit -m "Allure rescue: ledger row builder and duplicate detector"
```

### Task 2.9: c1_receipt_ocr.py（オーケストレータ）

**Files:**
- Create: `allure-rescue/src/c1_receipt_ocr.py`
- Create: `allure-rescue/tests/unit/test_c1_receipt_ocr.py`

- [ ] **Step 1: テスト作成（モック中心）**

`allure-rescue/tests/unit/test_c1_receipt_ocr.py`:

```python
from unittest.mock import MagicMock
from src.c1_receipt_ocr import process_one, ProcessOutcome
from src.ocr_client import OCRResult
from src.department import DepartmentMaster
from src.account_classifier import AccountMaster
from src.allocation import AllocationMaster
from src.masters import MasterBundle, _DeptMaster


def _make_masters():
    return MasterBundle(
        department=_DeptMaster([
            {"部門コード": "001", "部門名": "Allure", "略称": "Allure"},
        ]),
        user=DepartmentMaster([
            {"使用者ID": "戸田", "氏名": "戸田社長", "所属部門コード": "001", "PDFファイル名キー": "戸田"},
        ]),
        account=AccountMaster([
            {"支払先パターン": "マツモトキヨシ", "勘定科目": "消耗品費", "税区分": "課仕10%", "信頼度": "高"},
        ]),
        allocation=AllocationMaster([]),
    )


def test_process_one_high_confidence_no_review():
    masters = _make_masters()
    ocr = OCRResult(
        receipt_date="2025/10/30", supplier_name="マツモトキヨシ", total_amount=590,
        confidence=0.95
    )
    llm = MagicMock()  # Should not be called
    outcome = process_one(
        filename="領収書（戸田）25.10下.pdf",
        ocr=ocr,
        masters=masters,
        llm=llm,
        next_no=276,
    )
    assert outcome.row.account == "消耗品費"
    assert outcome.row.department == "001"
    assert outcome.row.user == "戸田"
    assert outcome.row.review_required is False
    llm.classify_account.assert_not_called()


def test_process_one_unknown_supplier_calls_llm():
    masters = _make_masters()
    ocr = OCRResult(
        receipt_date="2025/10/30", supplier_name="謎ショップ", total_amount=1000,
        confidence=0.85
    )
    llm = MagicMock()
    llm.classify_account.return_value = {
        "account": "雑費", "tax": "課仕10%", "confidence": 0.5, "reason": "不明"
    }
    outcome = process_one(
        filename="領収書（戸田）25.10下.pdf",
        ocr=ocr,
        masters=masters,
        llm=llm,
        next_no=276,
    )
    assert outcome.row.account == "雑費"
    assert outcome.row.review_required is True  # LLM low confidence
    llm.classify_account.assert_called_once()


def test_process_one_unknown_user_marks_review():
    masters = _make_masters()
    ocr = OCRResult(
        receipt_date="2025/10/30", supplier_name="マツモトキヨシ", total_amount=590,
        confidence=0.95
    )
    outcome = process_one(
        filename="領収書（田中）25.10下.pdf",
        ocr=ocr,
        masters=masters,
        llm=MagicMock(),
        next_no=276,
    )
    assert outcome.row.user == "田中"
    assert outcome.row.department == ""
    assert outcome.row.review_required is True
```

- [ ] **Step 2: テスト実行 → FAIL**

```bash
pytest tests/unit/test_c1_receipt_ocr.py -v
```

期待: ImportError

- [ ] **Step 3: 実装**

`allure-rescue/src/c1_receipt_ocr.py`:

```python
"""C1 領収書OCRオーケストレータ。

単一PDFを受け取って LedgerRow を生成する純関数 process_one と、
Drive→OCR→Sheet書き込みまで一気通貫で行う run() を提供する。
"""
from dataclasses import dataclass
from typing import Optional
from .filename_parser import parse as parse_filename
from .department import lookup as lookup_department
from .account_classifier import classify_by_rule, classify_with_llm, ClassifyResult
from .allocation import detect as detect_allocation
from .ocr_client import OCRResult
from .ledger import LedgerRow
from .masters import MasterBundle


REVIEW_CONFIDENCE_THRESHOLD = 0.8


@dataclass
class ProcessOutcome:
    row: LedgerRow
    classify: ClassifyResult
    notes: list  # 追加メモ（按分要等）


def process_one(
    filename: str,
    ocr: OCRResult,
    masters: MasterBundle,
    llm,
    next_no: int,
) -> ProcessOutcome:
    """1枚のPDFのOCR結果から LedgerRow を構築。"""
    parsed = parse_filename(filename)
    user = parsed["user"] or ""
    dept = lookup_department(user, masters.user) or ""

    # 勘定科目: ルール → 未ヒットならLLM
    rule_result = classify_by_rule(ocr.supplier_name, masters.account)
    if rule_result.account is None:
        classify = classify_with_llm(ocr.supplier_name, masters.account, llm)
    else:
        classify = rule_result

    # 按分判定（注記のみ。実際の分割は呼び出し側）
    notes = []
    alloc = detect_allocation(ocr.supplier_name, masters.allocation)
    if alloc:
        notes.append(f"按分要: {alloc.pattern} ({alloc.distribution})")

    review = (
        ocr.confidence < REVIEW_CONFIDENCE_THRESHOLD
        or classify.confidence < REVIEW_CONFIDENCE_THRESHOLD
        or not dept
        or alloc is not None
    )

    row = LedgerRow(
        no=next_no,
        date=ocr.receipt_date,
        supplier=ocr.supplier_name,
        account=classify.account or "",
        amount=ocr.total_amount,
        user=user,
        link=filename,
        tkc=False,
        memo=" / ".join(notes),
        department=dept,
        tax=classify.tax or "",
        review_required=review,
        ocr_confidence=round(ocr.confidence, 2),
    )
    return ProcessOutcome(row=row, classify=classify, notes=notes)
```

- [ ] **Step 4: テスト実行 → PASS**

```bash
pytest tests/unit/test_c1_receipt_ocr.py -v
```

期待: 3 passed

- [ ] **Step 5: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/src/c1_receipt_ocr.py allure-rescue/tests/unit/test_c1_receipt_ocr.py
git commit -m "Allure rescue: C1 orchestrator (process_one)"
```

### Task 2.10: notify.py（Gmail通知）

**Files:**
- Create: `allure-rescue/src/notify.py`

注: 現状はログ出力のみで実装、メール送信は将来。

- [ ] **Step 1: 実装**

`allure-rescue/src/notify.py`:

```python
"""通知モジュール。Phase 1ではログ出力のみ。Gmail送信は将来追加。"""
import logging

logger = logging.getLogger("allure-rescue.notify")


def send_summary(to: str, subject: str, body: str) -> None:
    """通知送信。Phase 1ではコンソール出力のみ。"""
    logger.info("[NOTIFY %s] %s", to, subject)
    logger.info(body)
```

- [ ] **Step 2: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/src/notify.py
git commit -m "Allure rescue: notify stub (log-only)"
```

### Task 2.11: scripts/run_daily.py（日次エントリポイント）

**Files:**
- Create: `allure-rescue/scripts/run_daily.py`

- [ ] **Step 1: 実装**

`allure-rescue/scripts/run_daily.py`:

```python
"""日次OCR実行スクリプト。Cron / 手動実行両対応。

使い方:
    python scripts/run_daily.py [--dry-run]
"""
import argparse
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
load_dotenv()

from src import config
from src.ocr_client import (
    get_credentials, build_drive_client, build_docai_client,
    download_file, process_doc, extract_entities, MIME_MAP,
)
from src.sheet_client import open_sheet
from src.masters import load_all
from src.llm_client import AnthropicClassifier
from src.c1_receipt_ocr import process_one
from src.ledger import build_row, find_duplicate, COLUMNS
from src.notify import send_summary


def list_recent_pdfs(drive, folder_id: str, limit: int = 100) -> list:
    """指定フォルダ配下の領収書PDFを取得（再帰なし、Phase 1は1階層想定）。"""
    query = f"'{folder_id}' in parents and trashed = false and (mimeType contains 'image/' or mimeType = 'application/pdf')"
    res = drive.files().list(
        q=query, fields="files(id, name, mimeType)",
        pageSize=limit, supportsAllDrives=True, includeItemsFromAllDrives=True,
    ).execute()
    return res.get("files", [])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="シート書き込みなし")
    parser.add_argument("--folder-id", help="特定フォルダのみ処理（未指定なら DRIVE_ROOT_FOLDER_ID）")
    args = parser.parse_args()

    s = config.load()
    creds = get_credentials(s.google_key_file)
    drive = build_drive_client(creds)
    docai = build_docai_client(creds, s.docai_location)
    sh = open_sheet(s.google_key_file, s.ledger_sheet_id)
    masters = load_all(sh)
    llm = AnthropicClassifier(s.anthropic_api_key, s.anthropic_model)

    folder_id = args.folder_id or s.drive_root_folder_id
    files = list_recent_pdfs(drive, folder_id)
    print(f"対象: {len(files)} 件")

    ws = sh.worksheet("入出金経費管理")  # 実際のタブ名は要確認
    existing = ws.get_all_values()[1:]  # ヘッダ除外
    next_no = len(existing) + 1

    processor_name = (
        f"projects/{s.docai_project_id}/locations/{s.docai_location}"
        f"/processors/{s.docai_processor_id}"
    )

    new_rows = []
    review_count = 0
    skip_count = 0
    error_count = 0

    for i, f in enumerate(files, 1):
        mime = MIME_MAP.get(f["mimeType"])
        if not mime:
            print(f"[{i}/{len(files)}] スキップ ({f['mimeType']}): {f['name']}")
            continue
        try:
            content = download_file(drive, f["id"])
            doc = process_doc(docai, processor_name, content, mime)
            ocr = extract_entities(doc)

            outcome = process_one(
                filename=f["name"], ocr=ocr, masters=masters, llm=llm, next_no=next_no,
            )
            if find_duplicate(outcome.row, existing) is not None:
                print(f"[{i}/{len(files)}] 重複スキップ: {f['name']}")
                skip_count += 1
                continue

            row_list = build_row(outcome.row)
            new_rows.append(row_list)
            next_no += 1
            if outcome.row.review_required:
                review_count += 1
            print(f"[{i}/{len(files)}] OK: {f['name']} -> {outcome.row.supplier} {outcome.row.amount} {'⚠' if outcome.row.review_required else ''}")
        except Exception as e:
            error_count += 1
            print(f"[{i}/{len(files)}] ERROR: {f['name']}: {e}")

    if new_rows and not args.dry_run:
        ws.append_rows(new_rows, value_input_option="USER_ENTERED")
        print(f"\nシートに {len(new_rows)} 行追加")
    elif new_rows:
        print(f"\n[DRY-RUN] {len(new_rows)} 行を追加するところでした")

    summary = (
        f"OCR完了\n"
        f"- 新規: {len(new_rows)} 件\n"
        f"- 要確認: {review_count} 件\n"
        f"- 重複スキップ: {skip_count} 件\n"
        f"- エラー: {error_count} 件"
    )
    send_summary(s.gmail_notify_to, "Allure夜間OCRサマリ", summary)
    print("\n" + summary)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: ドライラン実行**

```bash
cd allure-rescue
python scripts/run_daily.py --dry-run --folder-id <テスト用フォルダID>
```

矢萩さん作業: テスト用フォルダ（領収書PDF 5枚程度を入れたサブフォルダ）を作って folder-id を指定。

期待: 5件処理→[DRY-RUN]メッセージ、シート書き込みなし

- [ ] **Step 3: 本番フォルダで dry-run**

```bash
python scripts/run_daily.py --dry-run
```

期待: DRIVE_ROOT_FOLDER_ID 配下の全PDFが処理される（重複検知で大半スキップ）

- [ ] **Step 4: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/scripts/run_daily.py
git commit -m "Allure rescue: daily OCR entrypoint script"
```

### Task 2.12: scripts/backtest.py（過去データ精度検証）

**Files:**
- Create: `allure-rescue/scripts/backtest.py`

- [ ] **Step 1: 実装**

`allure-rescue/scripts/backtest.py`:

```python
"""過去275行のラベル付き正解データに対するOCR→分類精度を測定する。

使い方:
    python scripts/backtest.py [--limit N]

出力:
    - コンソールに混同行列・誤分類リスト
    - allure-rescue/backtest_report_YYYYMMDD.md にレポート保存
"""
import argparse
import sys
from datetime import datetime
from pathlib import Path
from collections import defaultdict
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
load_dotenv()

from src import config
from src.ocr_client import (
    get_credentials, build_drive_client, build_docai_client,
    download_file, process_doc, extract_entities, MIME_MAP,
)
from src.sheet_client import open_sheet
from src.masters import load_all
from src.llm_client import AnthropicClassifier
from src.c1_receipt_ocr import process_one


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=275, help="検証する行数")
    args = parser.parse_args()

    s = config.load()
    creds = get_credentials(s.google_key_file)
    drive = build_drive_client(creds)
    docai = build_docai_client(creds, s.docai_location)
    sh = open_sheet(s.google_key_file, s.ledger_sheet_id)
    masters = load_all(sh)
    llm = AnthropicClassifier(s.anthropic_api_key, s.anthropic_model)

    ws = sh.worksheet("入出金経費管理")
    rows = ws.get_all_values()[1:args.limit + 1]
    print(f"検証対象: {len(rows)} 行")

    processor_name = (
        f"projects/{s.docai_project_id}/locations/{s.docai_location}"
        f"/processors/{s.docai_processor_id}"
    )

    correct_account = 0
    wrong_account = []
    correct_supplier = 0
    wrong_supplier = []
    correct_dept = 0
    confusion = defaultdict(lambda: defaultdict(int))  # 正解→予測の混同行列

    for i, row in enumerate(rows, 1):
        if len(row) < 7:
            continue
        truth_date, truth_supplier, truth_account, truth_amount, truth_user, truth_link = row[1:7]
        if not truth_link:
            continue
        # Drive上のPDFを名前で検索（簡易）
        query = f"name = '{truth_link}' and trashed = false"
        res = drive.files().list(q=query, fields="files(id,name,mimeType)", pageSize=1).execute()
        files = res.get("files", [])
        if not files:
            continue
        f = files[0]
        mime = MIME_MAP.get(f["mimeType"])
        if not mime:
            continue
        try:
            content = download_file(drive, f["id"])
            doc = process_doc(docai, processor_name, content, mime)
            ocr = extract_entities(doc)
            outcome = process_one(filename=f["name"], ocr=ocr, masters=masters, llm=llm, next_no=999)

            if outcome.row.account == truth_account:
                correct_account += 1
            else:
                wrong_account.append((truth_link, truth_supplier, truth_account, outcome.row.account))
                confusion[truth_account][outcome.row.account] += 1

            if outcome.row.supplier == truth_supplier:
                correct_supplier += 1
            else:
                wrong_supplier.append((truth_link, truth_supplier, outcome.row.supplier))

            truth_dept_prefix = ""  # 既存行に部門列が空のため部門精度は今回スキップ
            if outcome.row.user == truth_user:
                correct_dept += 1

            print(f"[{i}/{len(rows)}] {truth_link}: 科目 {'✓' if outcome.row.account == truth_account else '✗'}")
        except Exception as e:
            print(f"[{i}/{len(rows)}] ERROR: {truth_link}: {e}")

    total = len(rows)
    print(f"\n=== バックテスト結果 ({total}行) ===")
    print(f"勘定科目正解率: {correct_account}/{total} = {correct_account/total*100:.1f}%")
    print(f"支払先正解率: {correct_supplier}/{total} = {correct_supplier/total*100:.1f}%")
    print(f"使用者正解率: {correct_dept}/{total} = {correct_dept/total*100:.1f}%")

    print("\n--- 勘定科目誤分類トップ20 ---")
    for link, sup, truth, pred in wrong_account[:20]:
        print(f"  {sup}: 正解={truth} 予測={pred} ({link})")

    print("\n--- 混同行列（正解→予測カウント、上位） ---")
    for truth, preds in sorted(confusion.items(), key=lambda x: -sum(x[1].values()))[:10]:
        for pred, n in sorted(preds.items(), key=lambda x: -x[1])[:5]:
            print(f"  {truth} → {pred}: {n}")

    report_path = Path(__file__).parent.parent / f"backtest_report_{datetime.now().strftime('%Y%m%d')}.md"
    with report_path.open("w", encoding="utf-8") as fp:
        fp.write(f"# バックテスト結果 {datetime.now().isoformat()}\n\n")
        fp.write(f"- 勘定科目正解率: {correct_account/total*100:.1f}%\n")
        fp.write(f"- 支払先正解率: {correct_supplier/total*100:.1f}%\n")
        fp.write(f"- 使用者正解率: {correct_dept/total*100:.1f}%\n\n")
        fp.write("## 誤分類トップ20\n\n")
        for link, sup, truth, pred in wrong_account[:20]:
            fp.write(f"- {sup}: 正解={truth} 予測={pred} ({link})\n")
    print(f"\nレポート保存: {report_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 実行（小規模、limit=20）**

```bash
cd allure-rescue
python scripts/backtest.py --limit 20
```

期待: 20行に対する精度数値が出る。誤分類例を `_科目マスタ` に追加するヒントを得る

- [ ] **Step 3: 本番275行で実行**

```bash
python scripts/backtest.py
```

期待: 勘定科目正解率 95%以上、支払先正解率 90%以上

合格基準を満たさない場合: 誤分類トップ20を分析し、`_科目マスタ` に追記して seed_masters.py 再実行 → backtest 再実行

- [ ] **Step 4: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/scripts/backtest.py
git commit -m "Allure rescue: backtest script for past 275 rows"
```

### Task 2.13: 統合テスト（dry-run）

**Files:**
- Create: `allure-rescue/tests/integration/test_c1_dryrun.py`

- [ ] **Step 1: テスト作成**

`allure-rescue/tests/integration/test_c1_dryrun.py`:

```python
"""統合テスト: 実際のDrive/DocAI/Sheetを叩く。@pytest.mark.integration で分離。

実行: pytest -m integration tests/integration/test_c1_dryrun.py
"""
import pytest
import os
from src import config


pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def settings():
    if "GOOGLE_KEY_FILE" not in os.environ:
        pytest.skip(".env が設定されていない")
    return config.load()


def test_can_open_ledger_sheet(settings):
    from src.sheet_client import open_sheet
    sh = open_sheet(settings.google_key_file, settings.ledger_sheet_id)
    assert sh.title  # シート開けた


def test_can_load_masters(settings):
    from src.sheet_client import open_sheet
    from src.masters import load_all
    sh = open_sheet(settings.google_key_file, settings.ledger_sheet_id)
    masters = load_all(sh)
    assert len(masters.account.rows) > 0
    assert len(masters.user.rows) > 0


def test_can_call_documentai(settings):
    from src.ocr_client import get_credentials, build_docai_client
    creds = get_credentials(settings.google_key_file)
    client = build_docai_client(creds, settings.docai_location)
    # 単に作成できることだけ確認
    assert client is not None
```

- [ ] **Step 2: 統合テスト実行**

```bash
cd allure-rescue
pytest -m integration tests/integration/test_c1_dryrun.py -v
```

期待: 3 passed（環境変数があれば）/ skip（なければ）

- [ ] **Step 3: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/tests/integration/test_c1_dryrun.py
git commit -m "Allure rescue: integration smoke tests"
```

### Task 2.14: 並走運用開始

**Files:**
- Modify (manual): cron / GitHub Actions / Cloudflare Workers のいずれか
- Create: `allure-rescue/docs/parallel-run-log.md`

- [ ] **Step 1: 自動実行のセットアップ**

矢萩さん作業: 以下のいずれかで `python scripts/run_daily.py` を毎日朝9時・夜21時に実行する仕組みを作る:
- Windows タスクスケジューラ（最も簡単）
- GitHub Actions（既存パターンあり、`worker/` 参照）
- Cloudflare Workers Cron（既存パターンあり、最近停止）

最も簡単なのは Windows タスクスケジューラ。Phase 1 では暫定でこれ。

- [ ] **Step 2: 並走ログテンプレ作成**

`allure-rescue/docs/parallel-run-log.md`:

```markdown
# 並走運用ログ

Phase 1 Plan 1 完了直後から、5月実データで並走運用を始める。
矢萩さんは従来通り手入力（別タブ「人手版-2026-05」を作成）、
自動版は本シートに行追加するが TKC=TRUE への自動更新は止めておく。

## 検証項目（毎日記録）
- 自動版が追加した行数
- 自動版で要確認TRUEだった行数
- 矢萩さんが要確認をチェックした件数
- 自動版 vs 人手版で差分があった件数
- 致命的誤り（金額ズレ等）の件数

## ログ
| 日付 | 自動追加 | 要確認 | 確認済 | 差分 | 致命 | 備考 |
|---|---|---|---|---|---|---|
| 2026-05-XX |  |  |  |  |  |  |
```

- [ ] **Step 3: コミット**

```bash
cd C:\Users\orika\sns-automation
git add allure-rescue/docs/parallel-run-log.md
git commit -m "Allure rescue: parallel-run log template"
```

---

## Plan 1 完了基準

- [ ] バックテスト勘定科目正解率 95%以上
- [ ] dry-run で過去275行に対して重複検知が機能する
- [ ] 統合テストがパス
- [ ] 矢萩さんが Windowsタスクスケジューラで日次自動実行を設定できた
- [ ] 5月分実データで自動版が動き始めている（並走テスト開始）

## Plan 2 への接続

Plan 2（C2 大型支払 + C3 仕入請求書OCR）の事前準備:
- 大型支払の通帳貼付フォーマット確定（既存シート第3セクション参照）
- 仕入請求書6社のフォーマットサンプル収集
- LLMプロンプトの蓄積（科目分類精度を向上させるためのfew-shot例）

---

## Self-Review

- **Spec coverage:**
  - Spec Section 1（ゴール）→ Plan 1完了基準で5月実データ運用開始 ✓
  - Spec Section 2（C1）→ Task 2.1〜2.13 ✓
  - Spec Section 2（C2/C3/C4）→ Plan 2/3で対応（明示済）
  - Spec Section 3（データモデル）→ Task 1.3（4列追加）+ Task 1.4（マスタ4種）✓
  - Spec Section 4（フロー）→ Task 2.11（run_daily）+ Task 2.14（並走運用）✓
  - Spec Section 5（テスト）→ Task 2.12（backtest）+ Task 2.13（統合）✓

- **Placeholder scan:** TBDなし、すべての Task に code/command が入っている

- **Type consistency:** 
  - `LedgerRow.amount` は `object`（int|float|str）で統一
  - `ClassifyResult` は account_classifier.py で定義、c1_receipt_ocr.py から参照
  - `MasterBundle` は masters.py で定義、c1_receipt_ocr.py のテストで構築
  - `OCRResult` は ocr_client.py で定義、c1_receipt_ocr.py から参照
  - 重複なし

完了。
