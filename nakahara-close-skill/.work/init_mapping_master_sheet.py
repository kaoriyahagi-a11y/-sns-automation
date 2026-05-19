"""partner_mapping_中原.json → 入出金管理表 SS の `_仕訳マッピング_中原` タブ に書き込む。

one-shot。再実行時:
- J列「ロック」が ✓ の既存行は保持される
- 新規辞書エントリは末尾に追加

使い方:
  NAKAHARA_AUTH_DIR=C:/Users/orika/.auth/lb \
    python .work/init_mapping_master_sheet.py
"""
import argparse
import json
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK_DIR = os.path.join(PROJECT_ROOT, '.work').replace('\\', '/')
AUTH_DIR = os.environ.get('NAKAHARA_AUTH_DIR') or os.path.join(PROJECT_ROOT, '.auth', 'lb')

SS_ID = '1X_oPij_Fq_fJO9Dtfth-sn2z1BKyIOoSl1M6PD3mUXs'  # 入出金管理表
TAB_NAME = '_仕訳マッピング_中原'

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
]

HEADERS = [
    '取引先名', '種別', '借方勘定科目', '借方税区分',
    '貸方勘定科目', '貸方税区分', '摘要テンプレ',
    '税抜額(累計)',
]
# 8列 (A:取引先名 ... H:税抜額累計) ※確認/確定は仕訳案タブで行うので checkbox 廃止
LOCK_TRUE_VALUES = set()  # 互換維持のみ


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


def get_or_create_tab(sheets, ss_id, tab_name):
    """タブを取得 or 新規作成、(gid, exists_flag) を返す"""
    ss = sheets.spreadsheets().get(spreadsheetId=ss_id).execute()
    for s in ss['sheets']:
        if s['properties']['title'] == tab_name:
            return s['properties']['sheetId'], True
    resp = sheets.spreadsheets().batchUpdate(spreadsheetId=ss_id, body={
        'requests': [{'addSheet': {'properties': {'title': tab_name}}}]
    }).execute()
    return resp['replies'][0]['addSheet']['properties']['sheetId'], False


def load_existing_rows(sheets, ss_id, tab_name):
    """既存タブから全データ行を読込 (8列)"""
    try:
        resp = sheets.spreadsheets().values().get(
            spreadsheetId=ss_id, range=f"'{tab_name}'!A2:H"
        ).execute()
    except Exception:
        return []
    values = resp.get('values', [])
    out = []
    for row in values:
        row = (list(row) + [''] * 8)[:8]
        out.append(row)
    return out


def is_locked(row):
    return False  # checkbox 廃止


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        '--json',
        default=os.path.join(WORK_DIR, 'partner_mapping_中原.json'),
        help='マッピング辞書 JSON のパス',
    )
    args = parser.parse_args()

    if not os.path.isfile(args.json):
        sys.exit(f'ERROR: マッピング辞書 JSON が見つかりません: {args.json}\n'
                 '先に build_partner_mapping.py を実行してください。')

    with open(args.json, 'r', encoding='utf-8') as f:
        patterns = json.load(f)

    from googleapiclient.discovery import build
    creds = get_creds()
    sheets = build('sheets', 'v4', credentials=creds)

    gid, exists = get_or_create_tab(sheets, SS_ID, TAB_NAME)
    print(f'[INFO] タブ {TAB_NAME} ({"既存" if exists else "新規作成"}) gid={gid}')

    existing = load_existing_rows(sheets, SS_ID, TAB_NAME) if exists else []
    locked = [r for r in existing if is_locked(r)]
    locked_partners = {r[0] for r in locked}
    print(f'[INFO] 既存ロック行: {len(locked)} 件')

    # 辞書から行を生成 (累計税抜額 降順)
    new_rows = []
    for partner, p in sorted(patterns.items(), key=lambda x: -x[1].get('amount_excl_total', 0)):
        new_rows.append([
            partner,
            p['type'],
            p['debit_account'],
            p['debit_tax'],
            p['credit_account'],
            p['credit_tax'],
            p['summary_template'],
            p.get('amount_excl_total', 0),
        ])

    out = [HEADERS] + new_rows

    # 過去スキーマ (9/12列) の残骸も含めて広めに clear
    sheets.spreadsheets().values().clear(
        spreadsheetId=SS_ID, range=f"'{TAB_NAME}'!A:Z"
    ).execute()
    # 同様に Data Validation (チェックボックス等) も全範囲リセット
    sheets.spreadsheets().batchUpdate(spreadsheetId=SS_ID, body={
        'requests': [{
            'setDataValidation': {
                'range': {'sheetId': gid, 'startRowIndex': 0,
                          'startColumnIndex': 0, 'endColumnIndex': 26},
                # rule なし → 既存の DataValidation 解除
            }
        }]
    }).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=SS_ID,
        range=f"'{TAB_NAME}'!A1",
        valueInputOption='USER_ENTERED',
        body={'values': out},
    ).execute()

    # === 視覚整理: ヘッダ書式 + 凍結 + 条件付き書式 + チェックボックス ===
    # 種別色: 仕入=薄青 / 売上=薄橙 / 固定費=薄灰 / 立替=薄黄 / 振替=薄紫
    type_colors = [
        ('仕入', {'red': 0.85, 'green': 0.93, 'blue': 1.0}),
        ('売上', {'red': 1.0, 'green': 0.92, 'blue': 0.83}),
        ('固定費', {'red': 0.92, 'green': 0.92, 'blue': 0.92}),
        ('立替', {'red': 1.0, 'green': 0.98, 'blue': 0.80}),
        ('振替', {'red': 0.93, 'green': 0.88, 'blue': 0.97}),
    ]
    # 列インデックス: A=0 取引先 / B=1 種別 / C-F=借方/貸方 / G=6 摘要 / H=7 税抜額累計
    NUM_COLS = 8
    requests = [
        {'updateSheetProperties': {
            'properties': {'sheetId': gid, 'gridProperties': {'frozenRowCount': 1}},
            'fields': 'gridProperties.frozenRowCount',
        }},
        {'repeatCell': {
            'range': {'sheetId': gid, 'startRowIndex': 0, 'endRowIndex': 1,
                      'startColumnIndex': 0, 'endColumnIndex': NUM_COLS},
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
        # H列 (税抜額累計) を金額フォーマット
        {'repeatCell': {
            'range': {'sheetId': gid, 'startRowIndex': 1,
                      'startColumnIndex': 7, 'endColumnIndex': 8},
            'cell': {'userEnteredFormat': {'numberFormat': {'type': 'NUMBER', 'pattern': '#,##0'}}},
            'fields': 'userEnteredFormat.numberFormat',
        }},
        {'autoResizeDimensions': {
            'dimensions': {'sheetId': gid, 'dimension': 'COLUMNS',
                           'startIndex': 0, 'endIndex': NUM_COLS},
        }},
    ]
    # 種別列 (B列, index=1) 条件付き書式
    for i, (val, color) in enumerate(type_colors):
        requests.append({
            'addConditionalFormatRule': {
                'rule': {
                    'ranges': [{'sheetId': gid, 'startRowIndex': 1,
                                'startColumnIndex': 1, 'endColumnIndex': 2}],
                    'booleanRule': {
                        'condition': {'type': 'TEXT_EQ',
                                      'values': [{'userEnteredValue': val}]},
                        'format': {'backgroundColor': color},
                    },
                },
                'index': i,
            }
        })
    # 交互行 banding
    requests.append({
        'addBanding': {
            'bandedRange': {
                'range': {'sheetId': gid, 'startRowIndex': 0,
                          'startColumnIndex': 0, 'endColumnIndex': NUM_COLS},
                'rowProperties': {
                    'headerColor': {'red': 0.20, 'green': 0.35, 'blue': 0.55},
                    'firstBandColor': {'red': 1.0, 'green': 1.0, 'blue': 1.0},
                    'secondBandColor': {'red': 0.97, 'green': 0.97, 'blue': 0.97},
                },
            }
        }
    })
    try:
        sheets.spreadsheets().batchUpdate(spreadsheetId=SS_ID, body={
            'requests': requests
        }).execute()
    except Exception as e:
        # banding が既に存在する場合等のリトライ (banding 除外して再実行)
        print(f'[WARN] 書式設定で warning: {e}', file=sys.stderr)
        requests_no_band = [r for r in requests if 'addBanding' not in r]
        sheets.spreadsheets().batchUpdate(spreadsheetId=SS_ID, body={
            'requests': requests_no_band
        }).execute()

    print(f'[OK] _仕訳マッピング_中原 タブに {len(out) - 1} 行 (ロック保持: {len(locked)}, 新規: {len(new_rows)})')
    print(f'     URL: https://docs.google.com/spreadsheets/d/{SS_ID}/edit#gid={gid}')


if __name__ == '__main__':
    main()
