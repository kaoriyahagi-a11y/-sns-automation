"""試作v34 シート + マッピング辞書 → 仕訳案_YY.M月 タブ生成。

使い方:
  NAKAHARA_AUTH_DIR=C:/Users/orika/.auth/lb \
    python .work/build_journal_proposals.py --month 2604

出力: 入出金管理表 SS の `仕訳案_YY.M月` タブ (18列)
"""
import argparse
import json
import os
import sys

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
    '立替': {
        'debit_account': '旅費交通費', 'debit_tax': '課税仕入 10%',
        'credit_account': '短期借入金', 'credit_tax': '対象外',
    },
}


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


def build_proposal_row(v34_row, mapping, month):
    """試作v34 1行 → 仕訳案 1行 (dict)

    Args:
      v34_row: dict with keys {partner, date, section, amount, subtotal_8, subtotal_10, pdf_link}
      mapping: dict[partner_name -> mapping_entry]
      month: str (1-12)
    """
    partner = v34_row.get('partner') or ''
    section = v34_row.get('section') or ''
    amount = int(v34_row.get('amount') or 0)
    sub8 = int(v34_row.get('subtotal_8') or 0)
    sub10 = int(v34_row.get('subtotal_10') or 0)

    if partner in mapping:
        m = mapping[partner]
        confidence = m.get('confidence', '低')
        if confidence in ('高', '中'):
            judgment = 'OK'
        else:
            judgment = '要確認'
    else:
        tx_type = _infer_type_from_section(section)
        m = {**DEFAULT_BY_TYPE.get(tx_type, DEFAULT_BY_TYPE['固定費']),
             'type': tx_type,
             'summary_template': '{partner} {month}月分'}
        judgment = '未登録'

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

    # マスタシートのロック行を上書き
    try:
        resp = sheets.spreadsheets().values().get(
            spreadsheetId=ss_id, range=f"'{MAPPING_MASTER_TAB}'!A2:J"
        ).execute()
        for row in resp.get('values', []):
            row = (list(row) + [''] * 10)[:10]
            if (row[9] or '').strip() in {'✓', '✔', 'TRUE', 'true', '1'}:
                partner = row[0].strip()
                if not partner:
                    continue
                mapping[partner] = {
                    'type': row[1] or '固定費',
                    'debit_account': row[2] or '',
                    'debit_tax': row[3] or '',
                    'credit_account': row[4] or '',
                    'credit_tax': row[5] or '',
                    'summary_template': row[6] or '{partner} {month}月分',
                    'confidence': '高',  # ロック行は常に高扱い
                    'occurrences': 999,
                }
    except Exception as e:
        print(f'[WARN] マスタシート読込スキップ: {e}', file=sys.stderr)

    return mapping


def _read_shisaku_v34(sheets, ss_id, yymm):
    """試作v34 シートから仕訳生成入力行を読込。

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

    # ヘッダ行検出 (Row 3 or 4 想定)
    header_idx = None
    for i in range(min(6, len(rows))):
        joined = ' '.join(str(c) for c in rows[i])
        if '取引先' in joined or 'クライアント' in joined or '仕入先' in joined:
            header_idx = i
            break
    if header_idx is None:
        header_idx = 3  # フォールバック

    headers = rows[header_idx]
    out = []
    current_section = '不明'
    for r in rows[header_idx + 1:]:
        if not r or not any(str(c).strip() for c in r):
            continue
        # セクション見出し行を検出 (1セル目だけで内容ある等)
        joined = ' '.join(str(c).strip() for c in r if str(c).strip())
        if any(kw in joined for kw in ['15〆', '末〆', '仕入', '売上', 'その他']):
            if len([c for c in r if str(c).strip()]) <= 2:
                current_section = joined
                continue

        row_dict = {h: (r[i] if i < len(r) else '') for i, h in enumerate(headers)}
        partner = (
            row_dict.get('取引先')
            or row_dict.get('クライアント')
            or row_dict.get('仕入先')
            or ''
        )
        if not partner or not str(partner).strip():
            continue
        amount = row_dict.get('最終金額(税込)') or row_dict.get('金額(税込)') or row_dict.get('金額') or 0
        try:
            amount = int(amount) if amount else 0
        except (ValueError, TypeError):
            amount = 0
        if amount <= 0:
            continue

        sub8 = row_dict.get('8%対象(税込)') or 0
        sub10 = row_dict.get('10%対象(税込)') or 0
        try:
            sub8 = int(sub8) if sub8 else 0
            sub10 = int(sub10) if sub10 else 0
        except (ValueError, TypeError):
            sub8 = 0
            sub10 = 0

        out.append({
            'partner': str(partner).strip(),
            'date': row_dict.get('振込日') or row_dict.get('入金予定日') or '',
            'section': current_section,
            'amount': amount,
            'subtotal_8': sub8,
            'subtotal_10': sub10,
            'pdf_link': row_dict.get('リンク') or '',
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

    # A列 プルダウン (確定/保留/却下)
    sheets.spreadsheets().batchUpdate(spreadsheetId=ss_id, body={
        'requests': [
            {
                'setDataValidation': {
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
                }
            },
            # O列 条件付き書式 (OK=緑/要確認=黄/未登録=赤) → 3 requests
            *[
                {
                    'addConditionalFormatRule': {
                        'rule': {
                            'ranges': [{'sheetId': gid, 'startRowIndex': 1,
                                        'startColumnIndex': 14, 'endColumnIndex': 15}],
                            'booleanRule': {
                                'condition': {
                                    'type': 'TEXT_EQ',
                                    'values': [{'userEnteredValue': val}],
                                },
                                'format': {'backgroundColor': color},
                            }
                        },
                        'index': i,
                    }
                }
                for i, (val, color) in enumerate([
                    ('OK', {'red': 0.85, 'green': 0.95, 'blue': 0.85}),
                    ('要確認', {'red': 1.0, 'green': 0.95, 'blue': 0.7}),
                    ('未登録', {'red': 1.0, 'green': 0.85, 'blue': 0.85}),
                ])
            ],
        ]
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

    # 仕訳案行生成
    proposal_rows = [build_proposal_row(r, mapping, month) for r in v34_rows]

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
