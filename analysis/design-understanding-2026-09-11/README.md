# 指示・質問回答の整理と設計理解の分析

作成日：2026年9月11日（日本時間）。プロジェクトのアプリコードは変更せず、本ディレクトリに分析資料を作成しています。

## ファイル

| ファイル | 内容 |
| --- | --- |
| [report.md](report.md) | 結論・根拠・反証材料・考察を含む日本語レポート |
| [instruction_summary.tsv](instruction_summary.tsv) | 通常指示27件を13テーマに要約。全U識別子に対応 |
| [decision_summary.tsv](decision_summary.tsv) | 主要判断21テーマの変遷、ユーザーの寄与、成果物との対応、限界 |
| [instructions.tsv](instructions.tsv) | 通常メッセージ27件の原文と直前のAI発話、出典、同文参照 |
| [question_answers.tsv](question_answers.tsv) | 全74質問の質問文・全選択肢・選択値・自由記述・未回答状態・出典 |
| [sessions.tsv](sessions.tsv) | 対象10セッションのメタデータ、ファイルサイズ、ハッシュ |
| [source_manifest.json](source_manifest.json) | 再抽出する入力ファイルのバイト長とSHA-256。追記されても今回の入力範囲を固定 |
| [extraction_stats.json](extraction_stats.json) | 件数集計 |
| [extract_history.py](extract_history.py) | Python標準ライブラリだけで動く読取専用の履歴抽出処理 |
| [validate_artifacts.py](validate_artifacts.py) | 原文、質問回答対応、補助履歴、要約のID、リンクの検証処理 |
| [validation.json](validation.json) | 実行した検証の結果と、履歴間のスキル表記差の原文 |
| [argument-audit.md](argument-audit.md) | 指定スキルによる文章診断と論証分解 |
| [review-log.md](review-log.md) | 指定Reviewerのレビュー、対応、終了判断 |

## TSVの形式

UTF-8 BOM付き、タブ区切り、1記録1物理行です。標準CSVの引用符規則でセルを読み込み、原文のバックスラッシュを`\\`、改行を`\n`、タブを`\t`、CRを`\r`へ置換してあります。元に戻す場合はこの4種類だけを左から復号します。日本語を壊すため、セル全体への`unicode_escape`は使用しないでください。`options`や`answer_values`等は、セルの復号後にJSONとして読めます。

`same_text_as`は完全一致の先行発言を指し、二重記録であるとの断定ではありません。同じコミット依頼も時点・対象が異なり得るため、行は削除していません。`preceding_assistant`は補助文脈でありユーザーの指示には数えません。元の質問への補足説明が必要な場合は、出典JSONLの前後も参照してください。

質問は`call_id`と結果の`call_id`で結び、回答内の`question_id`に対応させます。`Recommended`はAIの推薦ラベル、`None of the above`はツールに返った値です。後者の自由記述や「詳しく説明して」は承認ではありません。空回答、中断、結果欠落は別の状態として扱い、初期選択が承認されたとは推定しません。

## 対象の選定と確認

1. `~/.codex/state_5.sqlite`を読取専用で開き、cwdに`jsPsych-demo`を含むか、タイトルに`jsPsych`を含むCLIセッションを検索しました。親ディレクトリで始まったリポジトリ作成2件を含めます。
2. `sessions/`と`archived_sessions/`のJSONL先頭メタデータを横断して、プロジェクトcwdの候補を照合しました。これにより自動承認審査と過去Reviewerのセッションも見つかりましたが、人間の発言を重複計上するため通常指示の対象外にしています。
3. 各JSONLの`response_item`から通常の`role=user`と同期質問呼び出し・結果を抽出しました。注入されたAGENTS.md・環境・スキル本文11出現は通常指示から除外しました。圧縮要約やツール内に引用された会話を独立した発言として復元してはいません。
4. 通常メッセージ27件は`history.jsonl`の対象セッション27行と、`thread_history_1.sqlite`の対象セッションの`userMessage`合計27件に一致しました。本文は26件が完全一致し、U003だけは`history.jsonl`側でスキル名がローカルのMarkdownリンクへ展開されていました。この既知の表記差を正規化すると27件すべて一致します。TSVの原文は変更せず、両方の原文と照合結果を`validation.json`に残しています。
5. 本調査セッションは過去の設計過程の集計から除外しています。分析開始時のファイル内容をバイト長とハッシュで固定しました。元履歴は書き換えていません。認証ファイルや資格情報は抽出対象にしていません。

探索は、ローカルに保存されているセッション、メタデータ、履歴の範囲です。削除済みセッション、別のCodexホーム、別ツールや口頭の指示、異なるcwdでプロジェクト名も記録されていない会話の完全な復元を保証するものではありません。スクリプトの初回候補取得はstate DB検索で、メタデータ横断と補助履歴との照合は今回別途実施した確認です。

## 再抽出

```sh
python3 analysis/design-understanding-2026-09-11/extract_history.py
python3 analysis/design-understanding-2026-09-11/validate_artifacts.py
```

manifestが存在する場合、そのバイト範囲のハッシュを確認して同じ対象から原文TSVと集計を再生成します。分析・要約TSVやレポートは自動生成しません。元のローカル履歴が必要です。TSVとmanifestには私的な会話やローカルパスが含まれます。資料作成時点ではコミット・pushを実施せず、その後ユーザーから本資料のコミット・pushを明示的に依頼されました。

コード照合の基準は`ecac4387ef4b44efeb1b491514c8a23b452242fe`です。過去の公開確認は`docs/implementation-verification.md`を参照し、本調査で再実施した試験とは扱いません。最新の回答Q068〜Q071には要件文書への反映未確認があるため、レポート作成のために既存要件を勝手に変更してはいません。
