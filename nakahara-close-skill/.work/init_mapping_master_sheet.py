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
    '信頼度', '出現回数', 'ロック',
]
LOCK_TRUE_VALUES = {'✓', '✔', 'TRUE', 'true', '1', 'YES', 'yes'}


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
    """既存タブから全データ行を読込"""
    try:
        resp = sheets.spreadsheets().values().get(
            spreadsheetId=ss_id, range=f"'{tab_name}'!A2:J"
        ).execute()
    except Exception:
        return []
    values = resp.get('values', [])
    out = []
    for row in values:
        row = (list(row) + [''] * 10)[:10]
        out.append(row)
    return out


def is_locked(row):
    return (row[9] or '').strip() in LOCK_TRUE_VALUES


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

    # 辞書から (ロック行 partner は除く) 新規行を生成
    new_rows = []
    for partner, p in sorted(patterns.items(), key=lambda x: -x[1]['occurrences']):
        if partner in locked_partners:
            continue
        new_rows.append([
            partner,
            p['type'],
            p['debit_account'],
            p['debit_tax'],
            p['credit_account'],
            p['credit_tax'],
            p['summary_template'],
            p['confidence'],
            str(p['occurrences']),
            '',
        ])

    # ヘッダ + ロック + 新規 を結合
    out = [HEADERS] + locked + new_rows

    # 既存タブを clear → 書込
    sheets.spreadsheets().values().clear(
        spreadsheetId=SS_ID, range=f"'{TAB_NAME}'!A:J"
    ).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=SS_ID,
        range=f"'{TAB_NAME}'!A1",
        valueInputOption='USER_ENTERED',
        body={'values': out},
    ).execute()

    # J列にチェックボックス Data Validation を設定
    sheets.spreadsheets().batchUpdate(spreadsheetId=SS_ID, body={
        'requests': [{
            'setDataValidation': {
                'range': {
                    'sheetId': gid, 'startRowIndex': 1,
                    'startColumnIndex': 9, 'endColumnIndex': 10,
                },
                'rule': {
                    'condition': {'type': 'BOOLEAN'},
                    'showCustomUi': True,
                },
            }
        }]
    }).execute()

    print(f'[OK] _仕訳マッピング_中原 タブに {len(out) - 1} 行 (ロック保持: {len(locked)}, 新規: {len(new_rows)})')
    print(f'     URL: https://docs.google.com/spreadsheets/d/{SS_ID}/edit#gid={gid}')


if __name__ == '__main__':
    main()
