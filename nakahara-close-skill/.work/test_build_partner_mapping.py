"""build_partner_mapping のテスト (TDD)

Run:
    python .work/test_build_partner_mapping.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build_partner_mapping import (
    assign_confidence,
    extract_partner_patterns,
    group_by_transaction,
    load_journal_csv,
)

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test_data', 'sample_journal_small.csv')


class TestLoadCsv(unittest.TestCase):
    def test_shift_jis_decoding(self):
        rows = load_journal_csv(FIXTURE)
        self.assertGreater(len(rows), 100)
        kanji_rows = [
            r for r in rows
            if '株式会社' in (r.get('借方補助科目') or '') or '株式会社' in (r.get('貸方補助科目') or '')
        ]
        self.assertGreater(len(kanji_rows), 0)


class TestGroupByTransaction(unittest.TestCase):
    def test_grouping_includes_opening(self):
        rows = load_journal_csv(FIXTURE)
        groups = group_by_transaction(rows)
        self.assertIn(1, groups)
        self.assertGreaterEqual(len(groups[1]), 2)

    def test_exclude_opening_balance(self):
        rows = load_journal_csv(FIXTURE)
        groups = group_by_transaction(rows, exclude_opening=True)
        self.assertNotIn(1, groups)


class TestExtractPatterns(unittest.TestCase):
    def setUp(self):
        rows = load_journal_csv(FIXTURE)
        groups = group_by_transaction(rows, exclude_opening=True, exclude_closing=True)
        self.patterns = extract_partner_patterns(groups)

    def test_yamaishi_kobayashi_pattern(self):
        """有限会社ヤマイシ小林 が仕入8% パターンで取り込まれる (B/S系=買掛金の補助科目 優先)"""
        self.assertIn('有限会社ヤマイシ小林', self.patterns)
        p = self.patterns['有限会社ヤマイシ小林']
        self.assertEqual(p['type'], '仕入')
        self.assertEqual(p['debit_account'], '仕入高【8％】')
        self.assertEqual(p['debit_tax'], '課税仕入 (軽)8%')
        self.assertEqual(p['credit_account'], '買掛金')
        self.assertEqual(p['credit_tax'], '対象外')

    def test_special_partner_with_tax_suffix(self):
        """築地魚市場株式会社 / 10％ のような税率併記を正規化せず保持 (売掛金の補助科目)"""
        self.assertIn('築地魚市場株式会社 / 10％', self.patterns)
        p = self.patterns['築地魚市場株式会社 / 10％']
        self.assertEqual(p['type'], '売上')
        self.assertEqual(p['credit_account'], '売上高【10％】')

    def test_toyosu_purchase_8(self):
        """豊洲市場株式会社 が売上または仕入8% パターン"""
        self.assertIn('豊洲市場株式会社', self.patterns)


class TestConfidence(unittest.TestCase):
    def test_high(self):
        self.assertEqual(assign_confidence(15), '高')
        self.assertEqual(assign_confidence(10), '高')

    def test_mid(self):
        self.assertEqual(assign_confidence(5), '中')
        self.assertEqual(assign_confidence(3), '中')

    def test_low(self):
        self.assertEqual(assign_confidence(2), '低')
        self.assertEqual(assign_confidence(1), '低')

    def test_unmapped(self):
        self.assertEqual(assign_confidence(0), '未登録')


if __name__ == '__main__':
    unittest.main()
