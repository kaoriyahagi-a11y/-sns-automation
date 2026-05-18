"""export_mf_csv.expand_to_mf_rows / write_csv_shift_jis / validate_proposal のテスト"""
import csv
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from export_mf_csv import expand_to_mf_rows, validate_proposal, write_csv_shift_jis, MF_HEADERS


def _proposal_purchase_8(amount=80000, sub8=80000, sub10=0):
    return {
        '取引日': '2026/04/15', '取引種別': '仕入', '取引先': 'ヤマイシ小林',
        '借方勘定科目': '仕入高【8％】', '借方補助科目': 'ヤマイシ小林',
        '借方税区分': '課税仕入 (軽)8%', '借方金額': amount,
        '貸方勘定科目': '買掛金', '貸方補助科目': 'ヤマイシ小林',
        '貸方税区分': '対象外', '貸方金額': amount,
        '摘要': 'ヤマイシ小林 4月分',
        '8%対象(内訳)': sub8, '10%対象(内訳)': sub10,
    }


def _proposal_purchase_mixed():
    return {
        '取引日': '2026/04/15', '取引種別': '仕入', '取引先': '混在さん',
        '借方勘定科目': '仕入高【8％】', '借方補助科目': '混在さん',
        '借方税区分': '課税仕入 (軽)8%', '借方金額': 80000,
        '貸方勘定科目': '買掛金', '貸方補助科目': '混在さん',
        '貸方税区分': '対象外', '貸方金額': 80000,
        '摘要': '混在さん 4月分',
        '8%対象(内訳)': 50000, '10%対象(内訳)': 30000,
    }


def _proposal_sales_10():
    return {
        '取引日': '2026/04/30', '取引種別': '売上', '取引先': '築地魚市場 / 10％',
        '借方勘定科目': '売掛金', '借方補助科目': '築地魚市場 / 10％',
        '借方税区分': '対象外', '借方金額': 200000,
        '貸方勘定科目': '売上高【10％】', '貸方補助科目': '築地魚市場 / 10％',
        '貸方税区分': '課税売上 10%', '貸方金額': 200000,
        '摘要': '築地魚市場 / 10％ 4月分',
        '8%対象(内訳)': 0, '10%対象(内訳)': 200000,
    }


class TestExpandToMfRows(unittest.TestCase):

    def test_single_rate_purchase_8_one_row(self):
        rows = expand_to_mf_rows(_proposal_purchase_8(), tx_no=1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['取引No'], 1)
        self.assertEqual(rows[0]['借方勘定科目'], '仕入高【8％】')
        self.assertEqual(rows[0]['借方金額(円)'], 80000)
        self.assertEqual(rows[0]['貸方勘定科目'], '買掛金')
        self.assertEqual(rows[0]['貸方金額(円)'], 80000)

    def test_single_rate_sales_one_row(self):
        rows = expand_to_mf_rows(_proposal_sales_10(), tx_no=2)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['借方勘定科目'], '売掛金')
        self.assertEqual(rows[0]['貸方勘定科目'], '売上高【10％】')

    def test_mixed_rates_purchase_three_rows(self):
        rows = expand_to_mf_rows(_proposal_purchase_mixed(), tx_no=3)
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r['取引No'] == 3 for r in rows))
        self.assertEqual(rows[0]['借方勘定科目'], '仕入高【8％】')
        self.assertEqual(rows[0]['借方金額(円)'], 50000)
        self.assertEqual(rows[0]['貸方勘定科目'], '')
        self.assertEqual(rows[1]['借方勘定科目'], '仕入高【10％】')
        self.assertEqual(rows[1]['借方金額(円)'], 30000)
        self.assertEqual(rows[2]['借方勘定科目'], '')
        self.assertEqual(rows[2]['貸方勘定科目'], '買掛金')
        self.assertEqual(rows[2]['貸方金額(円)'], 80000)
        # 借方計 = 貸方計
        total_d = sum(r['借方金額(円)'] or 0 for r in rows)
        total_c = sum(r['貸方金額(円)'] or 0 for r in rows)
        self.assertEqual(total_d, total_c)


class TestValidateProposal(unittest.TestCase):

    def test_valid(self):
        ok, _ = validate_proposal(_proposal_purchase_8())
        self.assertTrue(ok)

    def test_missing_credit_account(self):
        p = _proposal_purchase_8()
        p['貸方勘定科目'] = ''
        ok, msg = validate_proposal(p)
        self.assertFalse(ok)
        self.assertIn('貸方勘定科目', msg)

    def test_amount_mismatch(self):
        p = _proposal_purchase_8()
        p['貸方金額'] = 79000
        ok, msg = validate_proposal(p)
        self.assertFalse(ok)
        self.assertIn('金額', msg)


class TestShiftJisCsv(unittest.TestCase):

    def test_write_and_read_round_trip(self):
        rows = expand_to_mf_rows(_proposal_purchase_8(), tx_no=1) + \
               expand_to_mf_rows(_proposal_purchase_mixed(), tx_no=2)
        with tempfile.NamedTemporaryFile('w', delete=False, suffix='.csv') as tmp:
            tmp_path = tmp.name
        try:
            write_csv_shift_jis(rows, tmp_path)
            with open(tmp_path, 'r', encoding='cp932', newline='') as f:
                reader = csv.DictReader(f)
                read_back = list(reader)
            self.assertEqual(len(read_back), len(rows))
            self.assertEqual(read_back[0]['借方勘定科目'], '仕入高【8％】')
            self.assertEqual(read_back[0]['借方補助科目'], 'ヤマイシ小林')
            self.assertEqual(read_back[0]['摘要'], 'ヤマイシ小林 4月分')
            self.assertEqual(read_back[1]['借方勘定科目'], '仕入高【8％】')
            self.assertEqual(read_back[2]['借方勘定科目'], '仕入高【10％】')
            self.assertEqual(read_back[3]['貸方勘定科目'], '買掛金')
        finally:
            os.unlink(tmp_path)


if __name__ == '__main__':
    unittest.main()
