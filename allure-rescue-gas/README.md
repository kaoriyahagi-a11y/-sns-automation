# Allure経理救援 GAS v2

「Allure経費」スプレッドシートに bound する Google Apps Script プロジェクト。
領収書PDFのOCR→シート行追加→TKC FX2 取込CSV出力までを自動化する。

## 関連ドキュメント
- 設計書: `../docs/superpowers/specs/2026-05-19-allure-rescue-gas-rewrite-design.md`
- 実装プラン: `../docs/superpowers/plans/2026-05-19-allure-rescue-gas-rewrite-plan1.md`
- マニュアルv0.1 (AS-IS): `../docs/allure-rescue/expense-manual-v0.1.md`

## 対象シート
- `1BNI4MP40iNqVOEX9ecxkXgIhjpxrKbw6ECSYBEiJtNg`（「Allure経費」スプレッドシート）

## デプロイ
本プロジェクトは Apps Script エディタへ手動コピーで反映する（clasp 未使用）。
1. 「Allure経費」スプシを開き、メニュー: 拡張機能 → Apps Script
2. `src/*.gs` の各ファイルを Apps Script エディタに同名で作成、内容を貼付
3. `appsscript.json` の中身を マニフェストエディタに貼付（左メニュー: プロジェクト設定 → 「appsscript.json マニフェスト ファイルをエディタで表示する」を有効化）
4. スクリプトプロパティに `SA_JSON` キーでサービスアカウントJSONを保存（プロジェクト設定 → スクリプト プロパティ）
5. 初回のみ `bootstrapSheets()` を1回実行（タブ作成）
6. `setupTimeTrigger()` を1回実行（毎日9時・21時のcron登録）

## 開発フロー
- ローカルで `.gs` を編集→ Apps Script エディタへコピペ
- テストは `Tests.gs::runAllTests()` を Apps Script エディタから実行
- 本番DocAI叩く前に `processOnePdfManually(driveFileId)` で1件テスト
