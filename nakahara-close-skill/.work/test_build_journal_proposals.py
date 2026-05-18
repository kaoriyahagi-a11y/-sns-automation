"""build_journal_proposals.build_proposal_row のテスト

SS書込は別途、build_proposal_row のロジックのみ単体テストする。
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build_journal_proposals import build_proposal_row


SAMPLE_MAPPING = {
    '有限会社ヤマイシ小林': {
        'type': '仕入',
        'debit_account': '仕入高【8％】',
        'debit_tax': '課税仕入 (軽)8%',
        'credit_account': '買掛金',
        'credit_tax': '対象外',
        'summary_template': '{partner} {month}月分',
        'confidence': '高',
        'occurrences': 10,
    },
    '築地魚市場株式会社 / 10％': {
        'type': '売上',
        'debit_account': '売掛金',
        'debit_tax': '対象外',
        'credit_account': '売上高【10％】',
        'credit_tax': '課税売上 10%',
        'summary_template': '{partner} {month}月分',
        'confidence': '中',
        'occurrences': 5,
    },
    '何かの取引先 (低信頼度)': {
        'type': '仕入',
        'debit_account': '仕入高【10％】',
        'debit_tax': '課税仕入 10%',
        'credit_account': '買掛金',
        'credit_tax': '対象外',
        'summary_template': '{partner} {month}月分',
        'confidence': '低',
        'occurrences': 1,
    },
}


class TestBuildProposal(unittest.TestCase):

    def test_high_confidence_yamaishi(self):
        v34 = {
            'partner': '有限会社ヤマイシ小林', 'date': '2026/04/15',
            'section': '仕入', 'amount': 80000,
            'subtotal_8': 80000, 'subtotal_10': 0,
            'pdf_link': 'https://example.com/p.pdf',
        }
        row = build_proposal_row(v34, SAMPLE_MAPPING, '4')
        self.assertEqual(row['取引先'], '有限会社ヤマイシ小林')
        self.assertEqual(row['取引種別'], '仕入')
        self.assertEqual(row['借方勘定科目'], '仕入高【8％】')
        self.assertEqual(row['借方税区分'], '課税仕入 (軽)8%')
        self.assertEqual(row['借方金額'], 80000)
        self.assertEqual(row['貸方勘定科目'], '買掛金')
        self.assertEqual(row['貸方金額'], 80000)
        self.assertEqual(row['摘要'], '有限会社ヤマイシ小林 4月分')
        self.assertEqual(row['_judgment'], 'OK')
        self.assertEqual(row['8%対象(内訳)'], 80000)
        self.assertEqual(row['10%対象(内訳)'], 0)

    def test_mid_confidence_judgment_ok(self):
        """信頼度=中 でも判定OK"""
        v34 = {
            'partner': '築地魚市場株式会社 / 10％', 'date': '2026/04/30',
            'section': '売上末〆', 'amount': 200000,
            'subtotal_8': 0, 'subtotal_10': 200000,
        }
        row = build_proposal_row(v34, SAMPLE_MAPPING, '4')
        self.assertEqual(row['取引種別'], '売上')
        self.assertEqual(row['借方勘定科目'], '売掛金')
        self.assertEqual(row['貸方勘定科目'], '売上高【10％】')
        self.assertEqual(row['_judgment'], 'OK')

    def test_low_confidence_judgment_yokakunin(self):
        """信頼度=低 → 要確認"""
        v34 = {
            'partner': '何かの取引先 (低信頼度)', 'date': '2026/04/15',
            'section': '仕入', 'amount': 50000,
            'subtotal_8': 0, 'subtotal_10': 50000,
        }
        row = build_proposal_row(v34, SAMPLE_MAPPING, '4')
        self.assertEqual(row['_judgment'], '要確認')

    def test_unmapped_purchase_section_uses_default(self):
        """未登録 + 仕入セクション → 仕入高【8％】 デフォルト (鮮魚卸し前提)"""
        v34 = {
            'partner': '謎の新規取引先', 'date': '2026/04/15',
            'section': '仕入', 'amount': 50000,
            'subtotal_8': 50000, 'subtotal_10': 0,
        }
        row = build_proposal_row(v34, {}, '4')
        self.assertEqual(row['_judgment'], '未登録')
        self.assertEqual(row['取引種別'], '仕入')
        self.assertEqual(row['借方勘定科目'], '仕入高【8％】')
        self.assertEqual(row['貸方勘定科目'], '買掛金')

    def test_unmapped_sales_section_uses_default(self):
        """未登録 + 売上セクション → 売上高【8％】 デフォルト (鮮魚卸し前提)"""
        v34 = {
            'partner': '謎の新規売上先', 'date': '2026/04/30',
            'section': '売上15〆', 'amount': 100000,
            'subtotal_8': 100000, 'subtotal_10': 0,
        }
        row = build_proposal_row(v34, {}, '4')
        self.assertEqual(row['取引種別'], '売上')
        self.assertEqual(row['借方勘定科目'], '売掛金')
        self.assertEqual(row['貸方勘定科目'], '売上高【8％】')

    def test_mixed_tax_rate(self):
        """8%+10% 混在: Q/R 列に内訳保持"""
        v34 = {
            'partner': '混在さん', 'date': '2026/04/15',
            'section': '仕入', 'amount': 80000,
            'subtotal_8': 50000, 'subtotal_10': 30000,
        }
        row = build_proposal_row(v34, {}, '4')
        self.assertEqual(row['借方金額'], 80000)
        self.assertEqual(row['8%対象(内訳)'], 50000)
        self.assertEqual(row['10%対象(内訳)'], 30000)

    def test_partner_in_summary_template(self):
        v34 = {
            'partner': '有限会社ヤマイシ小林', 'date': '2026/04/15',
            'section': '仕入', 'amount': 80000,
            'subtotal_8': 80000, 'subtotal_10': 0,
        }
        row = build_proposal_row(v34, SAMPLE_MAPPING, '4')
        self.assertEqual(row['摘要'], '有限会社ヤマイシ小林 4月分')


if __name__ == '__main__':
    unittest.main()
