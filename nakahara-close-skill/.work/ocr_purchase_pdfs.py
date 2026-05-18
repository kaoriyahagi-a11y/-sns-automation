"""中原水産 仕入PDF OCR + 金額・取引先・締日抽出。

入力: .work/purchase_pdf_index_20{YYMM}.json (DL済みファイル一覧)
処理:
  - pdfplumber でテキスト層を抽出
  - 失敗 (画像系PDF / JPG) は _unextracted フラグ付きで出力
  - 金額: 「合計」「税込」「ご請求金額」「総合計」「請求金額」周辺の最大数値
  - 取引先: ファイル名 + PDFヘッダから推定
  - 締日: ファイル名から「{M}月15日〆」「{M}月末〆」抽出

使い方:
  python ocr_purchase_pdfs.py                # default --month 2603
  python ocr_purchase_pdfs.py --month 2604

出力: .work/purchase_pdf_extracted_20{YYMM}.json
"""
import argparse
import json
import os
import re
import sys
import unicodedata

import pdfplumber

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK_DIR = os.path.join(PROJECT_ROOT, '.work').replace('\\', '/')

# --month YYMM で main() 冒頭に再構築される（default 2603）
INDEX_PATH = f'{WORK_DIR}/purchase_pdf_index_202603.json'
OUT_PATH = f'{WORK_DIR}/purchase_pdf_extracted_202603.json'

# 抽出対象月（apply_month_paths で更新）。extract_counterparty / extract_closing_day で参照
TARGET_YEAR = 2026
TARGET_MONTH = 3


def apply_month_paths(yymm):
    """--month YYMM (例: '2603' / '2604') を受けてグローバル定数を再構築。"""
    global INDEX_PATH, OUT_PATH, TARGET_YEAR, TARGET_MONTH
    if not re.fullmatch(r'\d{4}', yymm):
        raise ValueError(f'--month は YYMM の4桁数字 (例: 2603, 2604): {yymm!r}')
    yy = int(yymm[:2])
    mm = int(yymm[2:])
    if not 1 <= mm <= 12:
        raise ValueError(f'--month の月部分が不正: {yymm!r}')
    INDEX_PATH = f'{WORK_DIR}/purchase_pdf_index_20{yymm}.json'
    OUT_PATH = f'{WORK_DIR}/purchase_pdf_extracted_20{yymm}.json'
    TARGET_YEAR = 2000 + yy
    TARGET_MONTH = mm

# 金額キーワード（優先度順）
AMOUNT_KEYWORDS = [
    'ご請求金額', '請求金額', '請求合計', '今回ご請求金額', '今回請求金額',
    '総合計', '総合計金額', '合計金額（税込', '合計金額(税込',
    '合計（税込', '合計(税込', '税込合計', '税込金額',
    '合計金額', '合計', 'お支払金額', 'お支払い金額', 'Total', 'TOTAL',
]

# 日本円の現実的フォーマット:
#   - カンマ区切り (¥任意): 1,234 / 12,345 / 1,234,567,890
#   - カンマ無し (¥必須, 4-9桁): ¥1234〜¥999999999
# pdfplumber の compact 化で隣接金額が「¥950¥9503」のように連結誤読されるのを防ぐため、
# カンマ無しは ¥プレフィックス必須 + 後続数字なし (negative lookahead) で限定。
AMOUNT_PATTERN_COMMA = re.compile(
    r'[¥￥]?\s*(\d{1,3}(?:,\d{3}){1,4})\s*円?'
)
AMOUNT_PATTERN_PLAIN = re.compile(
    r'[¥￥]\s*(\d{4,9})\s*円?(?!\d)'
)
# レガシー互換 (古いコードがimportする場合用)
AMOUNT_PATTERN = AMOUNT_PATTERN_COMMA
AMOUNT_MAX = 500_000_000  # ¥5億: 1請求書の現実的上限


def nfkc(s):
    if not s:
        return ''
    return unicodedata.normalize('NFKC', s)


# ノイズ除去: 適格請求書発行事業者登録番号（T+13桁）/ 電話番号 / 郵便番号 / 口座番号 / 各種ID
# S1: 電話番号ハイフン無し対応 + 各種コード番号追加
NOISE_PATTERNS = [
    re.compile(r'T\d{13}'),                                          # 登録番号
    re.compile(r'登録番号[:：]?\s*T?\d{10,14}'),                     # ラベル付き登録番号
    # 電話番号: ハイフン有り + ハイフン無し (TEL/FAX/電話 ラベル付き)
    re.compile(r'(?:TEL|Tel|tel|FAX|Fax|fax|電話)\s*[:：/]?\s*\d{9,12}'),
    re.compile(r'\d{2,4}-\d{2,4}-\d{3,4}'),                          # 電話番号(ハイフン有)
    re.compile(r'〒\s*\d{3}-?\d{4}'),                                # 郵便番号
    re.compile(r'普通\s*\d{6,8}'),                                   # 普通口座番号
    re.compile(r'当座\s*\d{6,8}'),                                   # 当座口座番号
    re.compile(r'請求番号[:：]?\s*\d{6,12}'),                        # 請求番号
    re.compile(r'取引先コード[:：]?\s*\d{2,8}'),                     # 取引先コード
    re.compile(r'伝票[NoＮｏ№]+[:：]?\s*\d{4,12}'),                  # 伝票番号
]


# A2: ファイル名による文書種別判定
def classify_doc_type(filename):
    """ファイル名から文書種別を分類。
    Returns:
      - 'shiharaihokoku': 中原社内文書（支払報告書）→ 突合対象外
      - 'seisan': 売上計上（精算書/精算報告書 = 入金側）
      - 'invoice': 仕入計上（既定）
    """
    name = nfkc(filename) if filename else ''
    if '支払報告書' in name or '支払報告' in name:
        return 'shiharaihokoku'
    if '精算書' in name or '精算報告書' in name:
        return 'seisan'
    return 'invoice'


# 文書種別ごとの金額キーワード優先順位
DOC_TYPE_KEYWORDS = {
    'invoice': [
        'ご請求金額', '請求金額', '請求合計', '今回ご請求金額', '今回請求金額',
        '総合計', '総合計金額', '合計金額（税込', '合計金額(税込',
        '合計（税込', '合計(税込', '税込合計', '税込金額',
        '合計金額', '合計', 'お支払金額', 'お支払い金額',
    ],
    'seisan': [
        '税込金額', '税込合計', '本報酬額', 'ご請求金額', '請求金額',
        '今回ご請求額', '今回ご入金額', '振込金額',
    ],
    # shiharaihokoku は除外なのでキーワード不要
}


def strip_noise(text):
    if not text:
        return ''
    for p in NOISE_PATTERNS:
        text = p.sub(' ', text)
    return text


def parse_amount_token(tok):
    if not tok:
        return None
    s = tok.replace(',', '').replace('¥', '').replace('￥', '').replace('円', '').strip()
    try:
        v = int(s)
        if v < 1000:  # 1000円未満は誤検知扱い
            return None
        if v > AMOUNT_MAX:  # 現実的上限超過は誤検知
            return None
        return v
    except ValueError:
        return None


# === 税率別合計抽出 (8%対象/10%対象) for 中原クローズ v2 仕訳ワークフロー ===
# 主要パターン: 「8%対象 ¥X」「10%対象 ¥Y」「軽減税率対象 ¥X」「標準税率対象 ¥Y」
# 拾わないもの: 「消費税(8%) X」(税額)、ラベル無しの単独金額
TAX_SUBTOTAL_8_PATTERNS = [
    re.compile(r'8\s*[%％]\s*対象(?:金額)?\s*[¥￥]?\s*([\d,]+)'),
    re.compile(r'軽減税率(?:対象)?(?:金額)?\s*[¥￥]?\s*([\d,]+)'),
]

TAX_SUBTOTAL_10_PATTERNS = [
    re.compile(r'10\s*[%％]\s*対象(?:金額)?\s*[¥￥]?\s*([\d,]+)'),
    re.compile(r'標準税率(?:対象)?(?:金額)?\s*[¥￥]?\s*([\d,]+)'),
]


def extract_tax_subtotals(text):
    """PDFテキストから 8%対象/10%対象 の税込合計を抽出。

    Returns:
      (subtotal_8, subtotal_10): どちらも int (取れなければ 0)。
    """
    if not text:
        return (0, 0)
    base = strip_noise(nfkc(text))
    compact = re.sub(r'[\s　]+', '', base)

    def _find_first(patterns, src):
        for pat in patterns:
            m = pat.search(src)
            if m:
                v = parse_amount_token(m.group(1))
                if v:
                    return v
        return 0

    sub8 = _find_first(TAX_SUBTOTAL_8_PATTERNS, base)
    sub10 = _find_first(TAX_SUBTOTAL_10_PATTERNS, base)
    # compact フォールバック (空白で分断されたパターン対策)
    if sub8 == 0:
        sub8 = _find_first(TAX_SUBTOTAL_8_PATTERNS, compact)
    if sub10 == 0:
        sub10 = _find_first(TAX_SUBTOTAL_10_PATTERNS, compact)
    return (sub8, sub10)


def extract_text_pdfplumber(path):
    try:
        with pdfplumber.open(path) as pdf:
            texts = []
            for page in pdf.pages:
                t = page.extract_text() or ''
                texts.append(t)
            return '\n'.join(texts)
    except Exception as e:
        return None


def _scan_for_amount(text_segment, prefer_comma=True):
    """テキスト断片(±80字)内の最初の妥当金額を抽出。

    優先順:
      1. comma パターン (1,234 etc) — ¥任意
      2. plain パターン (4-9桁) — ¥必須
    """
    if not text_segment:
        return None
    if prefer_comma:
        am = AMOUNT_PATTERN_COMMA.search(text_segment)
        if am:
            v = parse_amount_token(am.group(1))
            if v:
                return v
    am = AMOUNT_PATTERN_PLAIN.search(text_segment)
    if am:
        v = parse_amount_token(am.group(1))
        if v:
            return v
    return None


def find_amount_near_keywords(text, doc_type='invoice'):
    """キーワード周辺の金額抽出。

    S3戦略 (base優先 + tail-first + comma優先):
      1. ノイズ除去 → base, さらに空白除去版 compact を作成
      2. base 上で keyword match → tail先 → head 順
      3. base に keyword 無い場合のみ compact をフォールバック
         (「税 込 金 額」が compact化で「税込金額」となるケース対策)
      4. comma パターン優先 → plain (¥必須) フォールバック
    """
    if not text:
        return None, []
    base = strip_noise(nfkc(text))
    compact = re.sub(r'[\s　]+', '', base)

    keywords = DOC_TYPE_KEYWORDS.get(doc_type, AMOUNT_KEYWORDS)

    # === base スキャン ===
    # Pass 1: base tail
    for kw in keywords:
        for m in re.finditer(re.escape(kw), base):
            tail = base[m.end():m.end() + 80]
            v = _scan_for_amount(tail)
            if v:
                return v, [f'{kw}@base_tail']

    # Pass 2: base head
    for kw in keywords:
        for m in re.finditer(re.escape(kw), base):
            head = base[max(0, m.start() - 80):m.start()]
            v = _scan_for_amount(head)
            if v:
                return v, [f'{kw}@base_head']

    # === compact フォールバック ===
    # base にキーワードがあるが値が取れなかった場合は compact を見ても危険
    # (連結誤読リスク) ので、base で完全に keyword が無い場合のみフォールバック
    for kw in keywords:
        if kw in base:
            continue
        for m in re.finditer(re.escape(kw), compact):
            tail = compact[m.end():m.end() + 80]
            # compact では comma 優先のみ (plain は連結誤読リスク高)
            am = AMOUNT_PATTERN_COMMA.search(tail)
            if am:
                v = parse_amount_token(am.group(1))
                if v:
                    return v, [f'{kw}@compact_tail']
            head = compact[max(0, m.start() - 80):m.start()]
            am = AMOUNT_PATTERN_COMMA.search(head)
            if am:
                v = parse_amount_token(am.group(1))
                if v:
                    return v, [f'{kw}@compact_head']

    return None, []


def extract_counterparty(filename, text):
    """ファイル名 + PDFヘッダから取引先名を推定"""
    # ファイル名先頭から✅プレフィックス・日付を剥がす
    name = re.sub(r'^[✅✓☑]+\s*', '', filename)
    name = re.sub(r'\.(pdf|jpg|jpeg|png)$', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*\(\d+\)\s*', ' ', name)
    # 「{Y}年{M}月分　XXX」「{Y}年{M}月末〆　XXX」「{Y}年{M}月15日〆　XXX」
    m = re.search(rf'{TARGET_YEAR}年\d+月(?:分|末〆|\d+日?〆|\d+日|分)?[\s　]*(.+)', name)
    if m:
        candidate = m.group(1).strip()
        # 末尾の「.」「請求書」を剥がす
        candidate = re.sub(r'(請求書|請求|精算書)$', '', candidate).strip()
        candidate = re.sub(r'^[\s　]+', '', candidate)
        if candidate:
            return candidate
    # 「XXX - YYYY」形式 (T4 等)
    m = re.match(r'^([^-－—]+?)\s*[-－—]', name)
    if m:
        return m.group(1).strip()
    return name.strip()


def extract_closing_day(filename):
    """ファイル名から締日抽出"""
    name = nfkc(filename)
    mm = TARGET_MONTH
    if re.search(rf'{mm}月末〆|{mm}月末締|{mm}/末', name):
        return '末'
    m = re.search(rf'{mm}月(\d+)日?〆', name)
    if m:
        return m.group(1)
    m = re.search(rf'{mm}/(\d+)〆', name)
    if m:
        return m.group(1)
    if f'{mm}月分' in name or f'{mm}月' in name:
        return '末'  # デフォルト
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--month', default='2603', help='YYMM (例: 2603, 2604)')
    args = ap.parse_args()
    apply_month_paths(args.month)

    with open(INDEX_PATH, 'r', encoding='utf-8') as f:
        idx = json.load(f)

    files = [f for f in idx['files'] if not f.get('is_subfolder')]
    print(f'Total files: {len(files)}', file=sys.stderr)

    results = []
    extracted_count = 0
    failed_count = 0

    for i, f in enumerate(files):
        path = f.get('local_path')
        name = f['name']
        if not path or not os.path.exists(path):
            results.append({**f, 'extract_status': 'no_local_file'})
            failed_count += 1
            continue
        is_pdf = name.lower().endswith('.pdf')
        is_jpg = any(name.lower().endswith(e) for e in ('.jpg', '.jpeg', '.png'))

        entry = {**f}
        entry['counterparty_inferred'] = extract_counterparty(name, '')
        entry['closing_day_inferred'] = extract_closing_day(name)
        # A2: 文書種別判定
        doc_type = classify_doc_type(name)
        entry['doc_type'] = doc_type

        # S2: 支払報告書は中原社内文書として除外
        if doc_type == 'shiharaihokoku':
            entry['extract_status'] = 'excluded_shiharaihokoku'
            entry['amount'] = None
            entry['keywords_matched'] = []
            failed_count += 1
            results.append(entry)
            continue

        if is_pdf:
            text = extract_text_pdfplumber(path)
            if text and text.strip():
                amount, kws = find_amount_near_keywords(text, doc_type=doc_type)
                entry['extract_status'] = 'ok' if amount else 'no_amount'
                entry['amount'] = amount
                entry['keywords_matched'] = kws
                entry['text_length'] = len(text)
                first_line = text.split('\n', 1)[0].strip()[:80] if text else ''
                entry['pdf_first_line'] = first_line
                # v2 仕訳ワークフロー: 税率別合計
                sub8, sub10 = extract_tax_subtotals(text)
                entry['subtotal_8'] = sub8
                entry['subtotal_10'] = sub10
                if amount:
                    extracted_count += 1
                else:
                    failed_count += 1
            else:
                entry['extract_status'] = 'no_text_layer'
                entry['amount'] = None
                entry['subtotal_8'] = 0
                entry['subtotal_10'] = 0
                failed_count += 1
        elif is_jpg:
            entry['extract_status'] = 'image_no_ocr'
            entry['amount'] = None
            entry['subtotal_8'] = 0
            entry['subtotal_10'] = 0
            failed_count += 1
        else:
            entry['extract_status'] = 'unsupported_format'
            entry['amount'] = None
            entry['subtotal_8'] = 0
            entry['subtotal_10'] = 0
            failed_count += 1

        results.append(entry)
        if (i + 1) % 10 == 0:
            print(f'  Progress: {i+1}/{len(files)}', file=sys.stderr)

    summary = {
        'total_files': len(results),
        'extracted_amount': extracted_count,
        'failed': failed_count,
        'success_rate': f'{extracted_count / len(results) * 100:.1f}%' if results else '0%',
        'amount_total': sum(r.get('amount') or 0 for r in results),
        # v2 仕訳ワークフロー: 税率別合計の集計
        'subtotal_8_total': sum(r.get('subtotal_8') or 0 for r in results),
        'subtotal_10_total': sum(r.get('subtotal_10') or 0 for r in results),
        'subtotal_8_coverage': sum(1 for r in results if r.get('subtotal_8')),
        'subtotal_10_coverage': sum(1 for r in results if r.get('subtotal_10')),
    }

    out = {'summary': summary, 'files': results}
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f'\n=== サマリー ===', file=sys.stderr)
    print(json.dumps(summary, ensure_ascii=False, indent=2), file=sys.stderr)
    print(f'\n出力: {OUT_PATH}', file=sys.stderr)


if __name__ == '__main__':
    main()
