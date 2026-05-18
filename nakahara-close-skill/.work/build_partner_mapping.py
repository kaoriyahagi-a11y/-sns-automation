"""中原水産 過去 MF 仕訳CSV → 取引先別 標準仕訳マッピング辞書 学習

使い方:
  # ローカルCSVから学習 (Phase A3 用)
  python .work/build_partner_mapping.py \\
    --input-dir .work/test_data \\
    --output .work/partner_mapping_中原.json

  # Drive フォルダから学習 (Phase A4 本番)
  python .work/build_partner_mapping.py \\
    --drive-folder <フォルダID> \\
    --output .work/partner_mapping_中原.json

Author: orika.co.ltd@gmail.com / Claude
"""
import argparse
import csv
import json
import os
import sys
from collections import Counter, defaultdict

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK_DIR = os.path.join(PROJECT_ROOT, '.work').replace('\\', '/')
AUTH_DIR = os.environ.get('NAKAHARA_AUTH_DIR') or os.path.join(PROJECT_ROOT, '.auth', 'lb')

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
]

# 取引先名抽出時に優先する勘定科目 (B/S系: 取引先名がフルネームで入る慣習)
BS_ACCOUNTS_FOR_PARTNER = {
    '買掛金', '売掛金', '新 売掛金', '未払金', '未払金【立替経費】', '未払金【給与】',
    '未払費用', '未収入金', '短期借入金', '短期貸付金', '長期借入金', '長期貸付金',
    '差入保証金', '前払費用', '立替金', '預り金', '仮払金', '仮受金',
}

# 取引先扱いしない補助科目 (銀行口座/個人名以外の管理用)
BANK_ACCOUNT_MARKERS = ['【法人】', '【個人】']  # これを含むものは銀行口座とみなしスキップ

# 「振替/回収」と判定する勘定科目 (両側がこのリストにあれば学習対象外)
TRANSFER_ACCOUNTS = {
    '買掛金', '売掛金', '新 売掛金', '普通預金', '現金',
    '短期借入金', '短期貸付金', '長期借入金', '長期貸付金',
    '未払金', '未払金【立替経費】', '未払金【給与】', '未払費用', '未収入金',
    '預り金', '前払費用', '立替金', '仮払金', '仮受金', '差入保証金',
}


def load_journal_csv(path):
    """MF仕訳帳CSV (Shift_JIS) を読込、各行を dict で返す"""
    with open(path, 'r', encoding='cp932', newline='') as f:
        reader = csv.DictReader(f)
        return list(reader)


def _parse_tx_no(value):
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def group_by_transaction(rows, exclude_opening=False, exclude_closing=False):
    """取引No 単位でグルーピング"""
    groups = defaultdict(list)
    for row in rows:
        tx_no = _parse_tx_no(row.get('取引No'))
        if tx_no is None:
            continue
        if exclude_opening and tx_no == 1:
            continue
        if exclude_closing and (row.get('取引日') or '').endswith('/12/31'):
            continue
        groups[tx_no].append(row)
    return dict(groups)


def _is_bank_account(text):
    if not text:
        return False
    return any(marker in text for marker in BANK_ACCOUNT_MARKERS)


def _get_partner(tx_rows):
    """取引から取引先名を抽出。

    優先順位:
      1. B/S系勘定科目 (買掛金/売掛金等) の補助科目 (中原慣習でフルネーム+税率併記が集中)
      2. 借方/貸方の取引先列 (空でなければ)
      3. 借方/貸方の補助科目 (銀行口座マーカー除外)
    """
    # 1. B/S系勘定科目の補助科目
    for row in tx_rows:
        for acc_col, sub_col in [
            ('借方勘定科目', '借方補助科目'),
            ('貸方勘定科目', '貸方補助科目'),
        ]:
            if row.get(acc_col) in BS_ACCOUNTS_FOR_PARTNER:
                sub = (row.get(sub_col) or '').strip()
                if sub and not _is_bank_account(sub):
                    return sub
    # 2. 取引先列
    for row in tx_rows:
        for col in ['借方取引先', '貸方取引先']:
            val = (row.get(col) or '').strip()
            if val:
                return val
    # 3. 補助科目 (銀行口座除外)
    for row in tx_rows:
        for col in ['借方補助科目', '貸方補助科目']:
            val = (row.get(col) or '').strip()
            if val and not _is_bank_account(val):
                return val
    return None


def _extract_journal_pattern(tx_rows):
    """取引行から (借方勘定科目, 借方税区分, 貸方勘定科目, 貸方税区分) を抽出。
    複合仕訳の場合、最初に出現した借方/貸方を採用。
    """
    debit_account = debit_tax = credit_account = credit_tax = None
    for row in tx_rows:
        if row.get('借方勘定科目') and not debit_account:
            debit_account = row['借方勘定科目']
            debit_tax = row.get('借方税区分') or ''
        if row.get('貸方勘定科目') and not credit_account:
            credit_account = row['貸方勘定科目']
            credit_tax = row.get('貸方税区分') or ''
        if debit_account and credit_account:
            break
    return (debit_account, debit_tax, credit_account, credit_tax)


def _guess_type(debit_account, credit_account):
    """勘定科目から取引種別を推測"""
    debit_account = debit_account or ''
    credit_account = credit_account or ''
    if '売上高' in credit_account or ('売掛金' in debit_account and '仕入高' not in credit_account):
        return '売上'
    if '仕入高' in debit_account or '買掛金' in credit_account:
        return '仕入'
    if '立替' in debit_account or '立替' in credit_account or '短期借入金' in credit_account:
        return '立替'
    if '振替' in (debit_account + credit_account):
        return '振替'
    return '固定費'


def _is_transfer_pattern(debit_account, credit_account):
    """両側が B/S系 (買掛金⇔普通預金 等の振替/回収) なら学習対象外"""
    return (
        (debit_account or '') in TRANSFER_ACCOUNTS
        and (credit_account or '') in TRANSFER_ACCOUNTS
    )


def extract_partner_patterns(transaction_groups):
    """取引先ごとに最頻パターンを抽出して辞書を返す"""
    partner_patterns = defaultdict(Counter)
    for tx_no, rows in transaction_groups.items():
        partner = _get_partner(rows)
        if not partner:
            continue
        pattern = _extract_journal_pattern(rows)
        if not pattern[0] or not pattern[2]:
            continue
        if _is_transfer_pattern(pattern[0], pattern[2]):
            continue  # 振替/回収は学習しない (計上仕訳のみ学ぶ)
        partner_patterns[partner][pattern] += 1
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
    if count >= 3:
        return '中'
    if count >= 1:
        return '低'
    return '未登録'


def _load_creds():
    """Drive API 用に OAuth credentials を読み込む (dl_purchase_pdfs.py と同じパターン)"""
    from google.oauth2.credentials import Credentials  # 遅延 import
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


def _download_drive_csvs(folder_id):
    """Drive フォルダ配下の CSV を一時ディレクトリにDLしてパス一覧を返す"""
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
    import io

    creds = _load_creds()
    drive = build('drive', 'v3', credentials=creds)

    tmp_dir = os.path.join(WORK_DIR, 'tmp_drive_csv')
    os.makedirs(tmp_dir, exist_ok=True)

    local_paths = []
    page_token = None
    while True:
        resp = drive.files().list(
            q=f"'{folder_id}' in parents and trashed=false and mimeType='text/csv'",
            fields='nextPageToken, files(id, name, mimeType)',
            pageSize=100,
            pageToken=page_token,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()
        for f in resp.get('files', []):
            local = os.path.join(tmp_dir, f['name'])
            request = drive.files().get_media(fileId=f['id'])
            with open(local, 'wb') as out:
                downloader = MediaIoBaseDownload(out, request)
                done = False
                while not done:
                    _, done = downloader.next_chunk()
            local_paths.append(local)
            print(f'[DL] {f["name"]}')
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return local_paths


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-dir', help='ローカルCSV ディレクトリ (テスト用)')
    parser.add_argument('--drive-folder', help='Drive フォルダID (本番)')
    parser.add_argument('--output', required=True, help='出力 JSON パス')
    args = parser.parse_args()

    if args.input_dir:
        csv_paths = sorted(
            os.path.join(args.input_dir, f)
            for f in os.listdir(args.input_dir)
            if f.lower().endswith('.csv')
        )
    elif args.drive_folder:
        csv_paths = _download_drive_csvs(args.drive_folder)
    else:
        sys.exit('ERROR: --input-dir or --drive-folder required')

    if not csv_paths:
        sys.exit('ERROR: CSV ファイルが見つかりません')

    all_rows = []
    for path in csv_paths:
        all_rows.extend(load_journal_csv(path))
    print(f'[INFO] 入力 CSV {len(csv_paths)} 件 / 合計 {len(all_rows)} 行')

    groups = group_by_transaction(all_rows, exclude_opening=True, exclude_closing=True)
    print(f'[INFO] 集計対象取引数: {len(groups)}')

    patterns = extract_partner_patterns(groups)

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(patterns, f, ensure_ascii=False, indent=2)

    print(f'[OK] 取引先 {len(patterns)} 件を {args.output} に出力')
    by_conf = Counter(p['confidence'] for p in patterns.values())
    for conf in ['高', '中', '低']:
        print(f'  信頼度 {conf}: {by_conf.get(conf, 0)} 件')


if __name__ == '__main__':
    main()
