"""仕訳案_YY.M月 タブの確定済 → MF標準19列CSV (Shift_JIS) を Drive 保存 + MF取込_YY.M月 タブ生成。

使い方:
  NAKAHARA_AUTH_DIR=C:/Users/orika/.auth/lb \
    python .work/export_mf_csv.py --month 2604 \
    --drive-folder <経理データ_中原水産/MF取込CSV フォルダID>
"""
import argparse
import csv
import io
import json
import os
import sys
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK_DIR = os.path.join(PROJECT_ROOT, '.work').replace('\\', '/')
AUTH_DIR = os.environ.get('NAKAHARA_AUTH_DIR') or os.path.join(PROJECT_ROOT, '.auth', 'lb')

SS_ID = '1X_oPij_Fq_fJO9Dtfth-sn2z1BKyIOoSl1M6PD3mUXs'
# Drive: 経理データ_中原水産/MF取込CSV (kaori.yahagi@ori-ka.com)
DEFAULT_DRIVE_FOLDER = '1LfWKspXP50JC9zeU1ZcJhvfhzu4UiBSn'
SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
]

MF_HEADERS = [
    '取引No', '取引日',
    '借方勘定科目', '借方補助科目', '借方部門', '借方取引先', '借方税区分', '借方インボイス', '借方金額(円)',
    '貸方勘定科目', '貸方補助科目', '貸方部門', '貸方取引先', '貸方税区分', '貸方インボイス', '貸方金額(円)',
    '摘要', 'タグ', 'メモ',
]


def _safe_int(value):
    try:
        return int(value)
    except (ValueError, TypeError):
        return 0


def _make_single_row(tx_no, proposal):
    """単一税率の取引 → 1行"""
    return {
        '取引No': tx_no, '取引日': proposal['取引日'],
        '借方勘定科目': proposal['借方勘定科目'], '借方補助科目': proposal['借方補助科目'],
        '借方部門': '', '借方取引先': '', '借方税区分': proposal['借方税区分'],
        '借方インボイス': '', '借方金額(円)': _safe_int(proposal['借方金額']),
        '貸方勘定科目': proposal['貸方勘定科目'], '貸方補助科目': proposal['貸方補助科目'],
        '貸方部門': '', '貸方取引先': '', '貸方税区分': proposal['貸方税区分'],
        '貸方インボイス': '', '貸方金額(円)': _safe_int(proposal['貸方金額']),
        '摘要': proposal.get('摘要') or '', 'タグ': '', 'メモ': '',
    }


def _make_debit_row(tx_no, proposal, account, tax, amount):
    """複合仕訳の借方行 (貸方は空)"""
    return {
        '取引No': tx_no, '取引日': proposal['取引日'],
        '借方勘定科目': account, '借方補助科目': proposal['借方補助科目'],
        '借方部門': '', '借方取引先': '', '借方税区分': tax,
        '借方インボイス': '', '借方金額(円)': _safe_int(amount),
        '貸方勘定科目': '', '貸方補助科目': '', '貸方部門': '', '貸方取引先': '',
        '貸方税区分': '', '貸方インボイス': '', '貸方金額(円)': '',
        '摘要': proposal.get('摘要') or '', 'タグ': '', 'メモ': '',
    }


def _make_credit_row(tx_no, proposal, amount):
    """複合仕訳の貸方行 (借方は空)"""
    return {
        '取引No': tx_no, '取引日': proposal['取引日'],
        '借方勘定科目': '', '借方補助科目': '', '借方部門': '', '借方取引先': '',
        '借方税区分': '', '借方インボイス': '', '借方金額(円)': '',
        '貸方勘定科目': proposal['貸方勘定科目'], '貸方補助科目': proposal['貸方補助科目'],
        '貸方部門': '', '貸方取引先': '', '貸方税区分': proposal['貸方税区分'],
        '貸方インボイス': '', '貸方金額(円)': _safe_int(amount),
        '摘要': proposal.get('摘要') or '', 'タグ': '', 'メモ': '',
    }


def expand_to_mf_rows(proposal, tx_no):
    """1仕訳案 → MF CSV 1〜3行"""
    sub8 = _safe_int(proposal.get('8%対象(内訳)') or 0)
    sub10 = _safe_int(proposal.get('10%対象(内訳)') or 0)
    total = _safe_int(proposal.get('借方金額') or 0)
    debit_type = proposal.get('取引種別', '')

    if sub8 > 0 and sub10 > 0:
        if debit_type == '仕入':
            return [
                _make_debit_row(tx_no, proposal, '仕入高【8％】', '課税仕入 (軽)8%', sub8),
                _make_debit_row(tx_no, proposal, '仕入高【10％】', '課税仕入 10%', sub10),
                _make_credit_row(tx_no, proposal, total),
            ]
        if debit_type == '売上':
            # 売上の場合、借方=売掛金 (合計) / 貸方=売上高 8%+10% に分解
            return [
                _make_debit_row(tx_no, proposal, proposal['借方勘定科目'], proposal['借方税区分'], total),
                {
                    '取引No': tx_no, '取引日': proposal['取引日'],
                    '借方勘定科目': '', '借方補助科目': '', '借方部門': '', '借方取引先': '',
                    '借方税区分': '', '借方インボイス': '', '借方金額(円)': '',
                    '貸方勘定科目': '売上高【8％】', '貸方補助科目': proposal['貸方補助科目'],
                    '貸方部門': '', '貸方取引先': '', '貸方税区分': '課税売上 (軽)8%',
                    '貸方インボイス': '', '貸方金額(円)': sub8,
                    '摘要': proposal.get('摘要') or '', 'タグ': '', 'メモ': '',
                },
                {
                    '取引No': tx_no, '取引日': proposal['取引日'],
                    '借方勘定科目': '', '借方補助科目': '', '借方部門': '', '借方取引先': '',
                    '借方税区分': '', '借方インボイス': '', '借方金額(円)': '',
                    '貸方勘定科目': '売上高【10％】', '貸方補助科目': proposal['貸方補助科目'],
                    '貸方部門': '', '貸方取引先': '', '貸方税区分': '課税売上 10%',
                    '貸方インボイス': '', '貸方金額(円)': sub10,
                    '摘要': proposal.get('摘要') or '', 'タグ': '', 'メモ': '',
                },
            ]
        # 仕入/売上以外で混在は稀。単一行扱い (主税率は提案行のまま)
        return [_make_single_row(tx_no, proposal)]
    return [_make_single_row(tx_no, proposal)]


def write_csv_shift_jis(rows, output_path):
    """MF標準19列CSV を Shift_JIS で書き出す"""
    with open(output_path, 'w', encoding='cp932', newline='', errors='replace') as f:
        writer = csv.DictWriter(
            f, fieldnames=MF_HEADERS, quoting=csv.QUOTE_ALL, lineterminator='\r\n'
        )
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, '') for k in MF_HEADERS})


def validate_proposal(proposal):
    """確定済仕訳が CSV化可能かチェック"""
    required = ['取引日', '借方勘定科目', '借方税区分', '借方金額',
                '貸方勘定科目', '貸方税区分', '貸方金額']
    for k in required:
        if not proposal.get(k):
            return False, f'必須列が空: {k}'
    d = _safe_int(proposal.get('借方金額') or 0)
    c = _safe_int(proposal.get('貸方金額') or 0)
    if d != c:
        return False, f'借方金額 {d} != 貸方金額 {c}'
    return True, ''


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


def _read_confirmed_proposals(sheets, ss_id, yymm):
    month = int(yymm[2:])
    tab_name = f'仕訳案_YY.{month}月'
    try:
        resp = sheets.spreadsheets().values().get(
            spreadsheetId=ss_id, range=f"'{tab_name}'!A1:R",
            valueRenderOption='UNFORMATTED_VALUE',
        ).execute()
    except Exception as e:
        sys.exit(f'ERROR: 仕訳案タブ読込失敗: {tab_name} / {e}')

    rows = resp.get('values', [])
    if len(rows) < 2:
        return []
    headers = rows[0]
    out = []
    for r in rows[1:]:
        r = (list(r) + [''] * 18)[:18]
        proposal = {h: (r[i] if i < len(r) else '') for i, h in enumerate(headers)}
        if (proposal.get('確定状態') or '').strip() != '確定':
            continue
        out.append(proposal)
    return out


def upload_to_drive(drive, local_path, parent_folder_id, dest_name):
    from googleapiclient.http import MediaFileUpload
    metadata = {'name': dest_name, 'parents': [parent_folder_id]}
    media = MediaFileUpload(local_path, mimetype='text/csv', resumable=False)
    file = drive.files().create(
        body=metadata, media_body=media, fields='id, webViewLink',
        supportsAllDrives=True,
    ).execute()
    return file.get('webViewLink')


def write_mf_import_tab(sheets, ss_id, month_label, rows, drive_url):
    tab_name = f'MF取込_{month_label}'
    ss = sheets.spreadsheets().get(spreadsheetId=ss_id).execute()
    gid = None
    for s in ss['sheets']:
        if s['properties']['title'] == tab_name:
            gid = s['properties']['sheetId']
            break
    if gid is None:
        resp = sheets.spreadsheets().batchUpdate(spreadsheetId=ss_id, body={
            'requests': [{'addSheet': {'properties': {'title': tab_name}}}]
        }).execute()
        gid = resp['replies'][0]['addSheet']['properties']['sheetId']

    out_rows = [MF_HEADERS]
    for r in rows:
        out_rows.append([r.get(k, '') for k in MF_HEADERS])
    if not rows:
        out_rows.append([])
        out_rows.append(['（確定行がありません。仕訳案タブで A列「確定」を入力後、再実行してください）'])
    out_rows.append([])
    if drive_url and drive_url.startswith('http'):
        out_rows.append([f'=HYPERLINK("{drive_url}","📥 CSVダウンロード")'])
    else:
        out_rows.append([f'ローカル CSV: {drive_url} (Drive 未設定)'])

    sheets.spreadsheets().values().clear(
        spreadsheetId=ss_id, range=f"'{tab_name}'!A:S"
    ).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=ss_id, range=f"'{tab_name}'!A1",
        valueInputOption='USER_ENTERED',
        body={'values': out_rows},
    ).execute()

    # ヘッダ書式 + フリーズ
    sheets.spreadsheets().batchUpdate(spreadsheetId=ss_id, body={
        'requests': [
            {'updateSheetProperties': {
                'properties': {'sheetId': gid, 'gridProperties': {'frozenRowCount': 1}},
                'fields': 'gridProperties.frozenRowCount',
            }},
            {'repeatCell': {
                'range': {'sheetId': gid, 'startRowIndex': 0, 'endRowIndex': 1,
                          'startColumnIndex': 0, 'endColumnIndex': len(MF_HEADERS)},
                'cell': {'userEnteredFormat': {
                    'backgroundColor': {'red': 0.20, 'green': 0.35, 'blue': 0.55},
                    'textFormat': {
                        'foregroundColor': {'red': 1.0, 'green': 1.0, 'blue': 1.0},
                        'bold': True, 'fontSize': 11,
                    },
                    'horizontalAlignment': 'CENTER',
                }},
                'fields': 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
            }},
            {'autoResizeDimensions': {
                'dimensions': {'sheetId': gid, 'dimension': 'COLUMNS',
                               'startIndex': 0, 'endIndex': len(MF_HEADERS)},
            }},
        ]
    }).execute()
    return tab_name, gid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--month', required=True, help='YYMM (例: 2604)')
    parser.add_argument('--drive-folder', default=DEFAULT_DRIVE_FOLDER,
                        help=f'Drive MF取込CSV フォルダID (default={DEFAULT_DRIVE_FOLDER})')
    args = parser.parse_args()
    yymm = args.month
    month = int(yymm[2:])
    month_label = f'YY.{month}月'

    from googleapiclient.discovery import build
    creds = get_creds()
    sheets = build('sheets', 'v4', credentials=creds)
    drive = build('drive', 'v3', credentials=creds)

    confirmed = _read_confirmed_proposals(sheets, SS_ID, yymm)
    print(f'[INFO] 確定済仕訳: {len(confirmed)} 件')

    mf_rows = []
    tx_no = 0
    skip_count = 0
    for proposal in confirmed:
        tx_no += 1
        ok, msg = validate_proposal(proposal)
        if not ok:
            print(f'[SKIP] {proposal.get("取引先", "?")}: {msg}')
            skip_count += 1
            continue
        mf_rows.extend(expand_to_mf_rows(proposal, tx_no))

    # CSVファイル生成 (0件でもヘッダのみのファイルを作る)
    ts = datetime.now().strftime('%Y%m%d-%H%M')
    fname = f'MF取込_中原_{month_label}_{ts}.csv'
    local_path = os.path.join(WORK_DIR, fname)
    write_csv_shift_jis(mf_rows, local_path)
    print(f'[INFO] ローカル保存: {local_path} ({len(mf_rows)} 行)')

    drive_url = ''
    if args.drive_folder:
        try:
            drive_url = upload_to_drive(drive, local_path, args.drive_folder, fname)
            print(f'[INFO] Drive アップロード: {drive_url}')
        except Exception as e:
            print(f'[WARN] Drive アップロード失敗: {e}', file=sys.stderr)

    # SS タブは常に作成 (0件でもヘッダだけ書く)
    tab_name, gid = write_mf_import_tab(sheets, SS_ID, month_label, mf_rows, drive_url or local_path)
    print(f'[OK] {tab_name} タブ生成 (gid={gid})')
    print(f'     URL: https://docs.google.com/spreadsheets/d/{SS_ID}/edit#gid={gid}')
    if not confirmed:
        print(f'[INFO] 仕訳案タブのA列で「確定」を選んでから再実行すると CSV に反映されます。')
    else:
        print(f'     確定済 {len(confirmed)} 仕訳 → CSV {len(mf_rows)} 行 (スキップ {skip_count})')


if __name__ == '__main__':
    main()
