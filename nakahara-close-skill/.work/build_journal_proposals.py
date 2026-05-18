"""試作v34 シート + マッピング辞書 → 仕訳案_YY.M月 タブ生成。

使い方:
  NAKAHARA_AUTH_DIR=C:/Users/orika/.auth/lb \
    python .work/build_journal_proposals.py --month 2604

出力: 入出金管理表 SS の `仕訳案_YY.M月` タブ (18列)
"""
import argparse
import json
import os
import re
import sys
import unicodedata

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK_DIR = os.path.join(PROJECT_ROOT, '.work').replace('\\', '/')
AUTH_DIR = os.environ.get('NAKAHARA_AUTH_DIR') or os.path.join(PROJECT_ROOT, '.auth', 'lb')

SS_ID = '1X_oPij_Fq_fJO9Dtfth-sn2z1BKyIOoSl1M6PD3mUXs'
MAPPING_MASTER_TAB = '_仕訳マッピング_中原'

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
]

PROPOSAL_HEADERS = [
    '確定状態', '取引日', '取引種別', '取引先',
    '借方勘定科目', '借方補助科目', '借方税区分', '借方金額',
    '貸方勘定科目', '貸方補助科目', '貸方税区分', '貸方金額',
    '摘要', 'ソースPDFリンク', 'マッピング判定', 'レビューメモ',
    '8%対象(内訳)', '10%対象(内訳)',
]

DEFAULT_BY_TYPE = {
    # 中原水産は鮮魚卸しなので 仕入/売上 は基本 8% 軽減税率がデフォルト
    '仕入': {
        'debit_account': '仕入高【8％】', 'debit_tax': '課税仕入 (軽)8%',
        'credit_account': '買掛金', 'credit_tax': '対象外',
    },
    '売上': {
        'debit_account': '売掛金', 'debit_tax': '対象外',
        'credit_account': '売上高【8％】', 'credit_tax': '課税売上 (軽)8%',
    },
    # 固定費・業務委託・立替は 10% (標準税率)
    '固定費': {
        'debit_account': '支払手数料', 'debit_tax': '課税仕入 10%',
        'credit_account': '普通預金', 'credit_tax': '対象外',
    },
    '立替': {
        'debit_account': '旅費交通費', 'debit_tax': '課税仕入 10%',
        'credit_account': '短期借入金', 'credit_tax': '対象外',
    },
}


_COMPANY_PREFIX_RE = re.compile(
    r'(株式会社|有限会社|合同会社|合資会社|合名会社|㈱|㈲|\(株\)|\(有\)|\(合\))'
)
_TAX_SUFFIX_RE = re.compile(r'\s*/\s*\d+[%％].*$')


def _normalize_partner(name):
    """取引先名を比較用に正規化。

    - NFKC正規化 (全角→半角)
    - 株式会社/有限会社等プレフィックス・サフィックス除去
    - 「/ 10％」のような税率併記サフィックス除去
    - 全空白除去
    - lowercase
    """
    if not name:
        return ''
    s = unicodedata.normalize('NFKC', str(name))
    s = _TAX_SUFFIX_RE.sub('', s)
    s = _COMPANY_PREFIX_RE.sub('', s)
    s = re.sub(r'[\s　]+', '', s)
    return s.lower()


def _build_normalized_index(mapping):
    """マッピング辞書から {normalized_partner: [(original_name, entry), ...]} を構築。

    同一 normalize に複数取引先がぶつかる (税率違い等) ケースを保持。
    """
    index = {}
    for name, entry in mapping.items():
        key = _normalize_partner(name)
        if not key:
            continue
        index.setdefault(key, []).append((name, entry))
    return index


def _lookup_mapping(partner, mapping, normalized_index):
    """取引先名から mapping エントリを探す。

    1. 完全一致 → 優先
    2. normalize 一致 (単一マッチ) → 採用
    3. normalize 複数マッチ → 信頼度高いものを採用 + 要確認フラグ
    4. なし → None
    """
    if partner in mapping:
        return mapping[partner], 'exact'
    norm = _normalize_partner(partner)
    if not norm:
        return None, 'unmapped'
    candidates = normalized_index.get(norm, [])
    if not candidates:
        return None, 'unmapped'
    if len(candidates) == 1:
        return candidates[0][1], 'normalized'
    # 複数 → 信頼度+出現回数で並び替えてトップを採用
    candidates_sorted = sorted(
        candidates,
        key=lambda x: (
            {'高': 0, '中': 1, '低': 2, '未登録': 3}.get(x[1].get('confidence', '低'), 3),
            -x[1].get('occurrences', 0),
        ),
    )
    return candidates_sorted[0][1], 'ambiguous'


def _infer_type_from_section(section):
    if section is None:
        return '固定費'
    s = str(section)
    if '仕入' in s:
        return '仕入'
    if '売上' in s:
        return '売上'
    if 'その他' in s:
        return '固定費'
    return '固定費'


def _infer_subtotals_from_tax(amount, debit_tax, credit_tax):
    """税区分から 8%/10% 別の税込金額を推定 (混在 OCR 取れなかった場合のフォールバック)

    - debit_tax / credit_tax に '8%' or '軽' を含む → 全額 8%
    - debit_tax / credit_tax に '10%' を含む → 全額 10%
    - どちらでもなければ → どちらも 0 (対象外/非課税)
    """
    tax_str = f'{debit_tax or ""} {credit_tax or ""}'
    if '8%' in tax_str or '(軽)' in tax_str:
        return amount, 0
    if '10%' in tax_str:
        return 0, amount
    return 0, 0


def build_proposal_row(v34_row, mapping, month, normalized_index=None):
    """試作v34 1行 → 仕訳案 1行 (dict)

    Args:
      v34_row: dict with keys {partner, date, section, amount, subtotal_8, subtotal_10, pdf_link}
      mapping: dict[partner_name -> mapping_entry]
      month: str (1-12)
      normalized_index: 取引先名正規化キー → [(原名, エントリ)...]
    """
    partner = v34_row.get('partner') or ''
    section = v34_row.get('section') or ''
    amount = int(v34_row.get('amount') or 0)
    sub8 = int(v34_row.get('subtotal_8') or 0)
    sub10 = int(v34_row.get('subtotal_10') or 0)

    if normalized_index is None:
        normalized_index = _build_normalized_index(mapping)

    m, match_kind = _lookup_mapping(partner, mapping, normalized_index)
    if m is None:
        tx_type = _infer_type_from_section(section)
        m = {**DEFAULT_BY_TYPE.get(tx_type, DEFAULT_BY_TYPE['固定費']),
             'type': tx_type,
             'summary_template': '{partner} {month}月分'}
        judgment = '未登録'
    else:
        confidence = m.get('confidence', '低')
        if match_kind == 'ambiguous':
            judgment = '要確認'  # 複数候補ヒット → 人間レビュー必須
        elif confidence in ('高', '中'):
            judgment = 'OK'
        else:
            judgment = '要確認'

    # 税率分解: 試作v34 から sub8/sub10 が取れていればそれを使う、
    # 取れていなければ税区分から全額をどちらかに振る
    if sub8 == 0 and sub10 == 0 and amount > 0:
        sub8, sub10 = _infer_subtotals_from_tax(amount, m['debit_tax'], m['credit_tax'])

    summary_template = m.get('summary_template') or '{partner} {month}月分'
    summary = summary_template.format(partner=partner, month=month)

    return {
        '確定状態': '',
        '取引日': v34_row.get('date') or '',
        '取引種別': m['type'],
        '取引先': partner,
        '借方勘定科目': m['debit_account'],
        '借方補助科目': partner,
        '借方税区分': m['debit_tax'],
        '借方金額': amount,
        '貸方勘定科目': m['credit_account'],
        '貸方補助科目': partner,
        '貸方税区分': m['credit_tax'],
        '貸方金額': amount,
        '摘要': summary,
        'ソースPDFリンク': v34_row.get('pdf_link') or '',
        'マッピング判定': judgment,
        'レビューメモ': '',
        '8%対象(内訳)': sub8,
        '10%対象(内訳)': sub10,
    }


def get_creds():
    from google.oauth2.credentials import Credentials
    tokens_path = os.path.join(AUTH_DIR, 'tokens.json')
    creds_path = os.path.join(AUTH_DIR, 'credentials.json')
    with open(tokens_path, 'r', encoding='utf-8') as f:
        tokens = json.load(f)
    with open(creds_path, 'r', encoding='utf-8') as f:
        ci = json.load(f)
    ci = ci.get('installed') or ci.get('web') or ci
    return Credentials(
        token=tokens.get('token') or tokens.get('access_token'),
        refresh_token=tokens.get('refresh_token'),
        token_uri=tokens.get('token_uri', 'https://oauth2.googleapis.com/token'),
        client_id=ci['client_id'],
        client_secret=ci['client_secret'],
        scopes=SCOPES,
    )


def load_mapping_with_master_override(sheets, ss_id, json_path):
    """JSON 辞書 + マスタシートのロック行を統合 (ロック優先)"""
    if os.path.isfile(json_path):
        with open(json_path, 'r', encoding='utf-8') as f:
            mapping = json.load(f)
    else:
        mapping = {}

    # マスタシートの「請求書OK」行を上書き (9列構成、I列=index 8)
    try:
        resp = sheets.spreadsheets().values().get(
            spreadsheetId=ss_id, range=f"'{MAPPING_MASTER_TAB}'!A2:I"
        ).execute()
        for row in resp.get('values', []):
            row = (list(row) + [''] * 9)[:9]
            if (row[8] or '').strip() in {'✓', '✔', 'TRUE', 'true', '1'}:
                partner = (row[0] or '').strip()
                if not partner:
                    continue
                mapping[partner] = {
                    'type': row[1] or '固定費',
                    'debit_account': row[2] or '',
                    'debit_tax': row[3] or '',
                    'credit_account': row[4] or '',
                    'credit_tax': row[5] or '',
                    'summary_template': row[6] or '{partner} {month}月分',
                    'confidence': '高',  # 請求書OK 行は常に高扱い
                    'occurrences': 999,
                }
    except Exception as e:
        print(f'[WARN] マスタシート読込スキップ: {e}', file=sys.stderr)

    return mapping


def _coerce_int(value):
    if value is None or value == '':
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    s = str(value).strip().replace(',', '').replace('¥', '').replace('￥', '').replace('円', '')
    if s in ('', '-', '−'):
        return 0
    try:
        return int(float(s))
    except (ValueError, TypeError):
        return 0


def _read_shisaku_v34(sheets, ss_id, yymm):
    """試作v34 シートから仕訳生成入力行を読込 (multi-section 対応)

    試作v34 は以下のような構造:
      - Row 1-3: コメント/メタ
      - Row 5-10: サマリ
      - Row 12: セクション見出し 【売上 15〆請求書】
      - Row 13: 列ヘッダ [Row(一覧), 締日, 取引先, ...]
      - Row 14+: データ行
      - 次のセクション見出し → 次のヘッダ → ...

    Returns: list[dict] (key: partner, date, section, amount, subtotal_8, subtotal_10, pdf_link)
    """
    month = int(yymm[2:])
    tab_name = f'2026年{month}月分_試作v34'
    try:
        resp = sheets.spreadsheets().values().get(
            spreadsheetId=ss_id, range=f"'{tab_name}'!A1:Z",
            valueRenderOption='UNFORMATTED_VALUE',
        ).execute()
    except Exception as e:
        sys.exit(f'ERROR: 試作v34 タブ読込失敗: {tab_name} / {e}')

    rows = resp.get('values', [])
    if len(rows) < 5:
        sys.exit(f'ERROR: 試作v34 タブが空です: {tab_name}')

    out = []
    current_section = '不明'
    current_headers = None
    header_partner_keywords = ('取引先', 'クライアント', '仕入先', 'PDF名')
    header_structural_keywords = ('リンク', 'PDF', '金額', '締日', '振込日', '入金予定日', 'OCR')

    for r in rows:
        if not r or not any(str(c).strip() for c in r):
            continue
        non_empty = [c for c in r if str(c).strip()]
        first_cell = str(r[0]).strip() if r else ''
        joined = ' '.join(str(c) for c in r)

        # セクション見出し行
        if first_cell.startswith('【') and '】' in first_cell:
            current_section = first_cell
            current_headers = None
            continue

        # 列ヘッダ行検出 (# 始まりでも構造的キーワード含めば検出する → その他フォルダ対応)
        if any(kw in joined for kw in header_partner_keywords):
            if any(ind in joined for ind in header_structural_keywords):
                current_headers = list(r)
                continue

        # 単独 # コメント行スキップ
        if first_cell.startswith('#') and len(non_empty) <= 1:
            continue

        # サマリ行スキップ
        if 'サマリ' in joined and len(non_empty) <= 3:
            continue

        if not current_headers:
            continue

        # データ行
        row_dict = {h: (r[i] if i < len(r) else '') for i, h in enumerate(current_headers)}
        partner = (
            row_dict.get('取引先')
            or row_dict.get('クライアント')
            or row_dict.get('仕入先')
            or row_dict.get('PDF名')
            or ''
        )
        partner = str(partner).strip()
        # 「✅」プレフィックス除去 (Drive 同期マーカー)
        partner = partner.lstrip('✅✓☑ ').strip()
        if not partner or partner in ('-', '−'):
            continue

        # 金額: 候補列を順に試す (その他フォルダ用に 'OCR金額' / '請求書金額(税込)' 追加)
        amount = 0
        for ac in (
            '最終金額(税込)', '売上金額(税込)', '仕入金額(税込)',
            '請求書金額(税込)', '請求書金額(税抜)',
            '金額(税込)', '金額', '請求金額', '実額(税込)', 'OCR金額',
        ):
            v = row_dict.get(ac)
            if v is not None and str(v).strip() not in ('', '-', '−'):
                amount = _coerce_int(v)
                if amount:
                    break
        if amount <= 0:
            continue

        # 税率内訳 (B2で追加される)
        sub8 = 0
        sub10 = 0
        for k, v in row_dict.items():
            ks = str(k)
            if '8%対象' in ks or '8％対象' in ks:
                sub8 = _coerce_int(v)
            elif '10%対象' in ks or '10％対象' in ks:
                sub10 = _coerce_int(v)

        # 日付
        date = (
            row_dict.get('振込日')
            or row_dict.get('入金予定日')
            or row_dict.get('締日')
            or ''
        )

        # PDFリンク
        pdf_link = (
            row_dict.get('請求書PDFリンク')
            or row_dict.get('PDFリンク')
            or row_dict.get('リンク')
            or row_dict.get('SSリンク')
            or ''
        )

        out.append({
            'partner': partner,
            'date': str(date),
            'section': current_section,
            'amount': amount,
            'subtotal_8': sub8,
            'subtotal_10': sub10,
            'pdf_link': str(pdf_link),
        })
    return out


def write_proposal_tab(sheets, ss_id, month_label, rows):
    """仕訳案タブを上書き、ただし既存 A列(確定状態) と P列(レビューメモ) は保持"""
    tab_name = f'仕訳案_{month_label}'

    # 既存タブの A 列 + P 列を行キー (取引日|取引先|借方金額) でマップ
    existing_map = {}
    gid = None
    ss = sheets.spreadsheets().get(spreadsheetId=ss_id).execute()
    for s in ss['sheets']:
        if s['properties']['title'] == tab_name:
            gid = s['properties']['sheetId']
            break

    if gid is not None:
        try:
            resp = sheets.spreadsheets().values().get(
                spreadsheetId=ss_id, range=f"'{tab_name}'!A2:R"
            ).execute()
            for r in resp.get('values', []):
                r = (list(r) + [''] * 18)[:18]
                key = (str(r[1]).strip(), str(r[3]).strip(), str(r[7]).strip())
                existing_map[key] = {
                    '確定状態': r[0],
                    'レビューメモ': r[15],
                }
        except Exception:
            pass
    else:
        resp = sheets.spreadsheets().batchUpdate(spreadsheetId=ss_id, body={
            'requests': [{'addSheet': {'properties': {'title': tab_name}}}]
        }).execute()
        gid = resp['replies'][0]['addSheet']['properties']['sheetId']

    # 行データ構築 (既存A/P列を再注入)
    out_rows = [PROPOSAL_HEADERS]
    for row in rows:
        key = (str(row['取引日']).strip(), str(row['取引先']).strip(), str(row['借方金額']).strip())
        existing = existing_map.get(key)
        if existing:
            row['確定状態'] = existing['確定状態']
            row['レビューメモ'] = existing['レビューメモ']
        out_rows.append([row[h] for h in PROPOSAL_HEADERS])

    # clear + write
    sheets.spreadsheets().values().clear(
        spreadsheetId=ss_id, range=f"'{tab_name}'!A:R"
    ).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=ss_id, range=f"'{tab_name}'!A1",
        valueInputOption='USER_ENTERED',
        body={'values': out_rows},
    ).execute()

    # === 視覚整理 + プルダウン + 条件付き書式 ===
    requests = [
        # 1行目フリーズ
        {'updateSheetProperties': {
            'properties': {'sheetId': gid, 'gridProperties': {'frozenRowCount': 1}},
            'fields': 'gridProperties.frozenRowCount',
        }},
        # ヘッダ行を太字+紺色背景+白文字
        {'repeatCell': {
            'range': {'sheetId': gid, 'startRowIndex': 0, 'endRowIndex': 1,
                      'startColumnIndex': 0, 'endColumnIndex': 18},
            'cell': {'userEnteredFormat': {
                'backgroundColor': {'red': 0.20, 'green': 0.35, 'blue': 0.55},
                'textFormat': {
                    'foregroundColor': {'red': 1.0, 'green': 1.0, 'blue': 1.0},
                    'bold': True, 'fontSize': 11,
                },
                'horizontalAlignment': 'CENTER',
                'verticalAlignment': 'MIDDLE',
            }},
            'fields': 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        }},
        # H列 (借方金額) と L列 (貸方金額) を金額フォーマット
        {'repeatCell': {
            'range': {'sheetId': gid, 'startRowIndex': 1,
                      'startColumnIndex': 7, 'endColumnIndex': 8},
            'cell': {'userEnteredFormat': {'numberFormat': {'type': 'NUMBER', 'pattern': '#,##0'}}},
            'fields': 'userEnteredFormat.numberFormat',
        }},
        {'repeatCell': {
            'range': {'sheetId': gid, 'startRowIndex': 1,
                      'startColumnIndex': 11, 'endColumnIndex': 12},
            'cell': {'userEnteredFormat': {'numberFormat': {'type': 'NUMBER', 'pattern': '#,##0'}}},
            'fields': 'userEnteredFormat.numberFormat',
        }},
        # Q,R列 (税率内訳) も金額フォーマット
        {'repeatCell': {
            'range': {'sheetId': gid, 'startRowIndex': 1,
                      'startColumnIndex': 16, 'endColumnIndex': 18},
            'cell': {'userEnteredFormat': {'numberFormat': {'type': 'NUMBER', 'pattern': '#,##0'}}},
            'fields': 'userEnteredFormat.numberFormat',
        }},
        # A列 プルダウン (確定/保留/却下)
        {'setDataValidation': {
            'range': {'sheetId': gid, 'startRowIndex': 1,
                      'startColumnIndex': 0, 'endColumnIndex': 1},
            'rule': {
                'condition': {
                    'type': 'ONE_OF_LIST',
                    'values': [
                        {'userEnteredValue': '確定'},
                        {'userEnteredValue': '保留'},
                        {'userEnteredValue': '却下'},
                    ],
                },
                'showCustomUi': True,
            }
        }},
        # 列幅自動調整 (全体)
        {'autoResizeDimensions': {
            'dimensions': {'sheetId': gid, 'dimension': 'COLUMNS',
                           'startIndex': 0, 'endIndex': 18},
        }},
    ]
    # A列 (確定状態) 条件付き書式
    state_colors = [
        ('確定', {'red': 0.78, 'green': 0.93, 'blue': 0.78}),
        ('保留', {'red': 1.0, 'green': 0.95, 'blue': 0.70}),
        ('却下', {'red': 0.85, 'green': 0.85, 'blue': 0.85}),
    ]
    for i, (val, color) in enumerate(state_colors):
        requests.append({
            'addConditionalFormatRule': {
                'rule': {
                    'ranges': [{'sheetId': gid, 'startRowIndex': 1,
                                'startColumnIndex': 0, 'endColumnIndex': 1}],
                    'booleanRule': {
                        'condition': {'type': 'TEXT_EQ',
                                      'values': [{'userEnteredValue': val}]},
                        'format': {'backgroundColor': color,
                                   'textFormat': {'bold': True}},
                    },
                },
                'index': i,
            }
        })
    # C列 (取引種別) 条件付き書式
    type_colors = [
        ('仕入', {'red': 0.85, 'green': 0.93, 'blue': 1.0}),
        ('売上', {'red': 1.0, 'green': 0.92, 'blue': 0.83}),
        ('固定費', {'red': 0.92, 'green': 0.92, 'blue': 0.92}),
        ('立替', {'red': 1.0, 'green': 0.98, 'blue': 0.80}),
    ]
    base = len(state_colors)
    for i, (val, color) in enumerate(type_colors):
        requests.append({
            'addConditionalFormatRule': {
                'rule': {
                    'ranges': [{'sheetId': gid, 'startRowIndex': 1,
                                'startColumnIndex': 2, 'endColumnIndex': 3}],
                    'booleanRule': {
                        'condition': {'type': 'TEXT_EQ',
                                      'values': [{'userEnteredValue': val}]},
                        'format': {'backgroundColor': color},
                    },
                },
                'index': base + i,
            }
        })
    # O列 (マッピング判定) 条件付き書式
    judg_colors = [
        ('OK', {'red': 0.85, 'green': 0.95, 'blue': 0.85}),
        ('要確認', {'red': 1.0, 'green': 0.95, 'blue': 0.70}),
        ('未登録', {'red': 1.0, 'green': 0.85, 'blue': 0.85}),
    ]
    base += len(type_colors)
    for i, (val, color) in enumerate(judg_colors):
        requests.append({
            'addConditionalFormatRule': {
                'rule': {
                    'ranges': [{'sheetId': gid, 'startRowIndex': 1,
                                'startColumnIndex': 14, 'endColumnIndex': 15}],
                    'booleanRule': {
                        'condition': {'type': 'TEXT_EQ',
                                      'values': [{'userEnteredValue': val}]},
                        'format': {'backgroundColor': color,
                                   'textFormat': {'bold': True}},
                    },
                },
                'index': base + i,
            }
        })
    # 交互行 banding
    requests.append({
        'addBanding': {
            'bandedRange': {
                'range': {'sheetId': gid, 'startRowIndex': 0,
                          'startColumnIndex': 0, 'endColumnIndex': 18},
                'rowProperties': {
                    'headerColor': {'red': 0.20, 'green': 0.35, 'blue': 0.55},
                    'firstBandColor': {'red': 1.0, 'green': 1.0, 'blue': 1.0},
                    'secondBandColor': {'red': 0.97, 'green': 0.97, 'blue': 0.97},
                },
            }
        }
    })
    try:
        sheets.spreadsheets().batchUpdate(spreadsheetId=ss_id, body={
            'requests': requests
        }).execute()
    except Exception as e:
        # 既存 banding 等とコンフリクト時は banding を抜いて再試行
        print(f'[WARN] 書式設定 warning: {e}', file=sys.stderr)
        req2 = [r for r in requests if 'addBanding' not in r and 'addConditionalFormatRule' not in r]
        sheets.spreadsheets().batchUpdate(spreadsheetId=ss_id, body={
            'requests': req2
        }).execute()

    return tab_name, gid, len(out_rows) - 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--month', required=True, help='YYMM (例: 2604)')
    args = parser.parse_args()
    yymm = args.month
    month = str(int(yymm[2:]))
    month_label = f'YY.{month}月'

    from googleapiclient.discovery import build
    creds = get_creds()
    sheets = build('sheets', 'v4', credentials=creds)

    # マッピング辞書 + マスタシート上書き読込
    json_path = os.path.join(WORK_DIR, 'partner_mapping_中原.json')
    mapping = load_mapping_with_master_override(sheets, SS_ID, json_path)
    print(f'[INFO] マッピング辞書: {len(mapping)} 取引先')

    # 試作v34 から仕訳生成入力を読込
    v34_rows = _read_shisaku_v34(sheets, SS_ID, yymm)
    print(f'[INFO] 試作v34 行: {len(v34_rows)} 件')

    # 仕訳案行生成 (正規化 index で fuzzy lookup)
    normalized_index = _build_normalized_index(mapping)
    proposal_rows = [build_proposal_row(r, mapping, month, normalized_index) for r in v34_rows]

    # 書込
    tab_name, gid, count = write_proposal_tab(sheets, SS_ID, month_label, proposal_rows)

    # 判定サマリ
    from collections import Counter
    judgments = Counter(r['マッピング判定'] for r in proposal_rows)
    print(f'[OK] {tab_name} に {count} 行 (gid={gid})')
    print(f'     判定: OK={judgments.get("OK", 0)} / 要確認={judgments.get("要確認", 0)} / 未登録={judgments.get("未登録", 0)}')
    print(f'     URL: https://docs.google.com/spreadsheets/d/{SS_ID}/edit#gid={gid}')


if __name__ == '__main__':
    main()
