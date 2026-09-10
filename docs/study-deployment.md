# 実験デモの開発・公開・運用

2026-09-11 JST。合成データ専用の4場面デモです。研究責任者・連絡先・参加条件・承認済み同意文・必要人数は未確定であり、実参加者を募集する環境ではありません。

## 実行場所と環境

| 場所 | 実行するもの | 保存先 |
| --- | --- | --- |
| 開発PC / Devbox | Node.js 24.12.0、npm、Vite、Wrangler、テスト、CSV取得 | ローカルD1は `.wrangler/state/v3/d1` |
| ブラウザー | React 19.3.0、jsPsych 8.3.0、survey-likert 2.2.0 | 排他制御付きlocalStorage。ID・256ビットトークン・進捗 |
| Cloudflare | WorkerのAPI・毎時削除 | D1にトークンハッシュ・manifest・回答 |

公開後に開発PCを動かし続ける必要はありません。管理認証をブラウザー成果物に含めず、開発者のWrangler認証で管理します。ReactとjsPsychはサーバー上で試行を実行するものではありません。

公開URL: <https://jspsych-demo-staging.jspsych-demo.workers.dev/>

| 設定 | 値 |
| --- | --- |
| CLI環境名 | `demo`。名前にstagingを含む既存の検証用資源を、この合成データ公開先1つとして使用 |
| Worker | `jspsych-demo-staging` |
| D1 | `jspsych-demo-staging-db` |
| D1 ID | `c845b0dd-7e3c-46a6-8b13-04b2674dce6b` |
| Binding | `DB` |
| Cron | `17 * * * *`（毎時17分） |
| バージョン | study=`holiday-v1`、consent=`technical-v1`、schema=`1` |
| 確認済み公開版 | `0704842d-83ab-424f-888a-be709a66141b` |
| 受付設定 | `COLLECTION_ENABLED=true`、`TEST_ONLY=true`。合成データの操作検証のみ |

旧Hello WorldのWorker・DBは変更していません。要件簡略化前に作成した未使用の `jspsych-demo-study-db` はユーザーテーブルがないことを確認して削除しました。有料プラン変更・独自ドメイン購入は行っていません。

## セットアップ

DevboxとNix、ブラウザー試験にはChromeが必要です。

```sh
devbox install
devbox run setup
devbox run dev
```

通常のURLは `http://127.0.0.1:5173/` です。`setup` は `npm ci` とローカルマイグレーションを行います。公開DBは操作しません。`.dev.vars` などに別設定がある場合は適用内容を確認してください。

```sh
devbox run check
devbox run -- npm run test:api
devbox run -- npm run test:e2e
devbox run build
```

`check` は型チェックと単体・分離したローカルD1試験です。`test:api` と `test:e2e` は起動中のローカルサーバーが必要で、合成セッションを追加します。`test:volume` は任意の追加確認で500完了セッションなどをローカルへ追加します。どれも実データの環境では実行しないでください。

Chromeのテストは `e2e/`、API同時送信・ロールバック試験は `scripts/verify-api.ts`、期限境界・受付停止は `tests/api.test.ts` です。ブラウザー自動試験のレポート・画面は `test-results/` に保存され、Git対象外です。失敗トレースには合成トークンが含まれうるため公開しないでください。

## デプロイ

認証が未設定の場合だけ `devbox run -- npx wrangler login` を実行します。

```sh
devbox run -- npm run db:migrate:demo
devbox run -- npm run deploy:demo
```

ビルドは `dist/client/` と `dist/jspsych_demo_local/` を生成します。後者のディレクトリ名はビルド環境名であり、接続先の意味ではありません。実際のWorker名・D1 bindingは生成されたWrangler設定に入り、デプロイログにも表示されます。生成物を直接編集しないでください。

対象省略の `deploy` と `db:migrate:remote` は安全のためエラーで停止します。`deploy:demo` がビルドから公開まで行うため、古い成果物を別環境へ送る操作を避けられます。DBマイグレーションは公開とは別操作です。

## CSV取得

```sh
devbox run -- npm run data:export -- --target local --output exports/local-run-001
devbox run -- npm run data:export -- --target demo --output exports/demo-run-001
```

毎回、次の4ファイルを作ります。0行の場合もCSVヘッダーは出ます。既存ファイルは上書きしないため、再取得時は新しい出力名を指定してください。

- `.completed-trials.csv`: 完了セッションの試行。
- `.incomplete-trials.csv`: 未完了セッションの保存済み試行。
- `.sessions.csv`: 0回答を含む全セッション。完了・期限内未完了・期限切れ未完了を区別。
- `.metadata.json`: 抽出時刻、対象、条件、schema、件数。

試行CSVにはmanifestから状況・前置き・提案・質問の全文を含めます。保存尺度は1〜7です。トークン・ハッシュは出力しません。全ページで同じ抽出時刻を使い、保持期限の境界を統一し、最後に件数をDBと照合します。収集中の厳密なスナップショットではありません。

## 受付停止と保持期限

`wrangler.jsonc` の `env.demo.vars.COLLECTION_ENABLED` を `false` にして再デプロイすると、新規開始だけが停止します。有効な既存セッションの再開・保存は続けられます。`TEST_ONLY` の変更だけで研究準備が完了することはありません。実参加者の収集には研究準備と検証用データからの環境分離が必要です。

サーバーは開始から24時間の期限未満に限って認証付きアクセスを受理します。30日の保持期限に到達するとCSVの対象外になり、毎時処理でセッションと回答を連動削除します。最終成功時刻と削除件数を次で確認できます。

```sh
devbox run -- npx wrangler d1 execute DB --remote --env demo --command "SELECT last_success_at, deleted_sessions FROM retention_runs WHERE singleton=1" --json
```

行がなければ初回成功未確認です。Cron設定の存在だけで実行成功とみなさず、公開後の運用で確認してください。失敗時は次回同じ条件で削除を再実行します。回答本文・トークンをログに出す処理は設けていません。

バックアップ復元後は受付再開前に、管理認証で `delete_after <= 現在のUTC時刻` のセッションを削除してください。端末の進捗消去はサーバー削除ではありません。CSVは取得者が保持期限を管理し、復元履歴を含め全コピーが30日ちょうどに消える保証はしません。

## 実装の入口

- `shared/study.ts`: 固定した4場面、質問、群の抽選、提示順。
- `shared/experiment.ts`: DTO、厳密な入力検証、比較用正規化。
- `worker/study-api.ts`: 認証・セッション・回答・完了・保持期限。
- `src/session.ts`: 最大1場面の保存待ち・手動再送・再開。
- `src/StudyTrial.tsx`: jsPsychの入力とローカル保存の順序、StrictMode cleanup。
- `scripts/export-data.ts`: 開発者の管理認証による4ファイル出力。

`src/HelloTrial.tsx` などの旧接続確認用コードは履歴比較用で、現行の参加フローからは使用しません。
