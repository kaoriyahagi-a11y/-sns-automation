"""ocr_purchase_pdfs.py の extract_tax_subtotals 関数のテスト

PDF を作らず、合成テキストを直接渡してロジック単体をテストする。
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ocr_purchase_pdfs import extract_tax_subtotals


class TestExtractTaxSubtotals(unittest.TestCase):

    def test_simple_8_and_10(self):
        text = """株式会社ABC御中
請求書

合計金額 ¥100,000
8%対象 ¥80,000
10%対象 ¥20,000
"""
        self.assertEqual(extract_tax_subtotals(text), (80000, 20000))

    def test_only_8(self):
        text = "合計金額 ¥80,000\n8%対象 ¥80,000\n"
        self.assertEqual(extract_tax_subtotals(text), (80000, 0))

    def test_only_10(self):
        text = "合計金額 ¥30,000\n10%対象 ¥30,000\n"
        self.assertEqual(extract_tax_subtotals(text), (0, 30000))

    def test_keigen_hyoujun_labels(self):
        """軽減税率/標準税率 ラベル"""
        text = """軽減税率対象 ¥80,000
標準税率対象 ¥20,000
"""
        self.assertEqual(extract_tax_subtotals(text), (80000, 20000))

    def test_full_width_percent(self):
        """全角 8％ / 10％ も対応"""
        text = "8％対象 80,000円\n10％対象 20,000円\n"
        self.assertEqual(extract_tax_subtotals(text), (80000, 20000))

    def test_no_tax_keywords_returns_zeros(self):
        """税率キーワード無し → (0, 0)"""
        text = "合計金額 100,000\nお振込先 みずほ銀行\n"
        self.assertEqual(extract_tax_subtotals(text), (0, 0))

    def test_does_not_pick_consumption_tax_amount(self):
        """「消費税(8%) X」のような税額表記は対象金額として拾わない"""
        text = """合計金額 100,000円
内 消費税(8%) 5,925円
内 消費税(10%) 1,818円
"""
        # 対象金額キーワード無いので (0, 0) になる
        self.assertEqual(extract_tax_subtotals(text), (0, 0))

    def test_empty_text(self):
        self.assertEqual(extract_tax_subtotals(''), (0, 0))
        self.assertEqual(extract_tax_subtotals(None), (0, 0))


if __name__ == '__main__':
    unittest.main()
