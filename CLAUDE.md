# CLAUDE.md

## プロジェクト概要

BluenotionDB: 各種サービスをNotionにSync

## 開発コマンド

```bash
# テスト
bun run test

# Lint
bun run lint

# dry-run（実際にNotionに書き込まない）
op run --env-file .env -- bun run dry-run

# 本番実行
op run --env-file .env -- bun run main
```

## サービス追加時の更新手順

新しいサービスやオプションを追加した場合:

1. `src/services/*.ts` - サービス実装を追加/更新
2. `src/notion/envs.ts` - `SupportedEnv`に型を追加、`typeOfEnv`に分岐を追加
3. `src/index.ts` - `fetchService`に分岐を追加（必要な場合）
4. `index.html` - ジェネレーターUIにオプションを追加
5. `README.md` - ドキュメントを更新

## Linear Search Types

- `assigned_me`: 自分にアサインされた進行中のIssue
- `created_by_me`: 自分が作成した進行中のIssue
- `activity`: 自分のアクティビティ全般
  - コメント
  - ステータス変更
  - アサイン変更
  - 優先度変更
  - Issue作成
  - アサインされたIssue

## キャッシュ

重複防止のため`.cache/`にキャッシュを保存。GitHub Actionsでは`actions/cache`の設定が必要。
