# JANKY Studio 初心者向け公開・接続ガイド

更新: 2026-10-17

## 絶対に守ること

- **最初は画面だけ公開。** 自動投稿・LINE配信をONにしないでください。
- GitHub PagesのHTML/CSS/JSは一般公開されます。APIキー、Cloudflare管理トークン、LINEトークン、動画ファイルをGitHubにアップロードしないでください。
- R2には無料枠がありますが、利用開始時に課金設定を求められ、枠超過で課金される場合があります。料金・利用資格・支払い条件を確認してください。
- この配布物は外部APIを使った本番投稿の実機検証がまだ済んでいません。Buffer/LINEをONにする前に小規模テストが必要です。
- 手元のZIPをGitHubに一括アップロードする場合、**ZIPそのものではなく展開したフォルダの中身**をアップロードします。

## 全体像

1. GitHub Pages: `docs/` フォルダ内の公開画面だけを配信。
2. Cloudflare Workers: 管理用APIと定期実行。
3. Cloudflare D1: 予約データ、設定、ログ。
4. Cloudflare R2: 本編・プレビュー動画（公開取得可能なURLをSNS・LINEで使用）。
5. Buffer: YouTube Shorts・Instagram Reels・TikTokへの予約。
6. LINE Messaging API: 指定人数へのランダム通知。

## ステップ1：GitHubに画面を公開（SNS送信なし）

1. パソコンで https://github.com/new を開き、普段使っているGitHubアカウントでサインインします。
2. **Repository name** に `janky-studio` と入力します。既に存在する場合は `janky-sns-studio` など別名にします。
3. **Public** を選びます（GitHub FreeのPagesを想定）。「Add a README file」はオンでもオフでも構いません。
4. **Create repository** を選びます。
5. ZIPをパソコンで展開し、`sns-studio` フォルダを開きます。
6. 新しいリポジトリの **Add file → Upload files** へ進み、展開した `sns-studio` の**中身**（`docs/`, `worker/`, `tests/`, `README.md`, `package.json`, `.gitignore` など）をアップロードします。ブラウザでフォルダをまとめてアップロードできない場合はGitHub DesktopかGPT Workを使います。
7. コミット欄に `Initial JANKY Studio files` と入力して **Commit changes** を押します。
8. リポジトリ上部 **Settings → Pages** に入ります。
9. **Build and deployment → Source** を **Deploy from a branch** にします。
10. **Branch** を `main`、**Folder** を `/docs` にして **Save** を押します。
11. 数分後に同じ画面へ戻り `https://<GitHubユーザー名>.github.io/janky-studio/` を開きます。実際のリポジトリ名が異なる場合はその名前です。
12. 画面上部に **DEMO MODE** と出ていることを確かめます。公開画面が開けても、まだSNS投稿やLINE配信は行われません。

### この段階で行う動作確認

- カレンダー画面へ移動できる。
- 試しに下書きを保存できる。
- 設定画面が開ける。
- ダッシュボードに「デモモード」の説明がある。
- テストで入力した内容はブラウザに保存され、他の端末と同期されません。

## ステップ2：Cloudflareのデータ保管先を作る（まだ自動投稿しない）

1. https://dash.cloudflare.com/ にサインインします。
2. R2の利用資格・請求設定と使用量課金の条件を確認します。R2は無料枠を含みますが、完全無課金・支払い情報なしの利用を保証するものではありません。
3. パソコンのNode.js環境を用意します。https://nodejs.org/en/download を参照。
4. パソコンでターミナルを開きます。WindowsはPowerShell、macOSはターミナルを使用します。
5. 展開したフォルダの `sns-studio/worker` まで移動します。例えばフォルダのパスを直接入力します。
6. `npm install` を実行します。
7. `npx wrangler login` を実行し、開いたブラウザでCloudflare接続を許可します。
8. `npx wrangler d1 create janky-studio-db` を実行します。表示される `database_id` をメモします（秘密鍵ではありません）。
9. `npx wrangler r2 bucket create janky-studio-media` を実行します。事前にR2の利用登録が必要です。
10. `worker/wrangler.toml` をエディタで開き、`REPLACE_WITH_D1_DATABASE_ID` を8のIDへ置き換えます。
11. 同じファイルの `SITE_ORIGIN` を `https://<GitHubユーザー名>.github.io` に変更します。**リポジトリ名を末尾に付けません。**
12. `MEDIA_ORIGIN` はWorkerの本番URLにします。まだ分からない場合は仮のままにして、初回デプロイ時に表示されたURLで直します。
13. `npx wrangler d1 execute janky-studio-db --remote --file=schema.sql` を実行し、テーブルを作成します。
14. `npx wrangler deploy` を実行します。表示された `https://janky-studio-api.<サブドメイン>.workers.dev` を控えます。
15. Worker URLの末尾に `/api/health` を付けて開き、`{"ok":true,"service":"JANKY Studio API"}` が表示されることを確認します。
16. `MEDIA_ORIGIN` を14のWorker URLに直して、もう一度 `npx wrangler deploy` を実行します。

### 管理者トークン（重要）

1. 推測不能なランダム文字列を生成します。macOS/Linuxであれば `openssl rand -hex 32`。Windowsで同等の安全な生成方法が分からない場合は作業を中断して確認してください。
2. `sns-studio/worker` フォルダのターミナルから `npx wrangler secret put ADMIN_TOKEN` を実行します。
3. 入力を求められたら1の文字列を貼り付けます。**トークンをChatGPTやGitHubやスクリーンショットに貼らないでください。**
4. GitHubリポジトリ内の `docs/config.js` を編集し、`apiBase: ''` の空文字を14のWorker URLへ変更してコミットします。このURL自体は秘密ではありません。
5. GitHub Pagesが更新されたらサイトを開き、管理トークンでログインします。
6. 設定画面で **自動処理/Buffer/LINE送信がすべてOFF** であることを確認します。
7. この段階で試しに下書きを登録し、別ブラウザでも管理トークンでログインして同じ下書きを見られるか確認します。

## ステップ3：Bufferを接続（すべてOFFで準備）

1. https://buffer.com/ に登録／ログインし、YouTube、Instagram、TikTokの3チャンネルを連携します。
2. Bufferの設定にあるAPI画面で**個人用APIキー**を発行します（無料プランにもAPIあり）。
3. `sns-studio/worker` のターミナルから `npx wrangler secret put BUFFER_API_KEY` を実行して登録します。
4. BufferのOrganization IDと各Channel IDを取得し、JANKY Studioの設定画面に入力します。
5. **本番自動化はまだONにしないでください。** API呼び出し・投稿形式・動画URLを少量のテストで検証する必要があります。
6. 本配布版のBuffer監視は通常6時間間隔、公開予定時刻の前後45分は30分間隔（概ね）とし、無料APIを5分ごとに使い続ける実装を避けています。それでも複数時刻の予約や他のAPI利用によって制限超過はあり得ます。

## ステップ4：LINEを接続（すべてOFFで準備）

1. LINE公式アカウントのMessaging APIを有効にしてチャネルを用意します。
2. Messaging APIのチャネルアクセストークンを発行します。
3. `sns-studio/worker` のターミナルから `npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN` を実行して登録します。
4. LINE友だち数、月200通の上限、確保する横動画予約・自発的全員通知の枠を管理画面で確認します。
5. 公開済みのShorts URLとプレビューMP4・サムネイルがあるまでLINEを送らない仕様です。
6. この版は人数指定のNarrowcastランダム抽選で、以前検討した公平抽選と個別除外は実装していません。
7. 動画は完了3日後に削除される設定ですが、過去のLINE動画を再生できなくなる可能性があるため、保存期間は実機で確認する必要があります。

## トラブル対処

- 404: リポジトリのPages設定が `main /docs` か、`docs/index.html` が存在するか確認。
- ページは見えるがデモモード: `docs/config.js` の `apiBase` が空欄、またはPagesの更新前。
- ログインできない: Worker URL、`ADMIN_TOKEN`、Cloudflareの環境変数を確認。トークンを共有しないこと。
- APIが403: Workerの `SITE_ORIGIN` と実際のGitHub Pagesのオリジンが一致するか確認。
- APIが500など: D1テーブルが作成済みか、R2バケットをバインド済みか確認。
- ファイルのアップロードが失敗: Cloudflare R2のバケット・請求状態、動画サイズ、拡張子、ネット接続を確認。
- SNS投稿ができない: この段階では「正常」です。連携後にテストしてから自動化をONにします。

## GPT Workを使う場合

ChatGPTのWorkモードは、対応するWebサイト上でリポジトリ作成・ファイルアップロード・GitHub Pages設定のような複数段階の操作を進める用途に適します。WorkのブラウザでGoogle/GitHub/Cloudflareへのサインインが必要なときは本人が操作してください。秘密鍵はチャットに貼らないでください。

Workへの指示例：

> 新規の公開GitHubリポジトリ `janky-studio` を作成し、手元のZIPを展開した中身を追加して、`main` ブランチの `/docs` をGitHub Pagesで公開してください。既存リポジトリは変更しないでください。CloudflareやBuffer・LINEへの自動送信設定はまだONにしないでください。作業ごとに結果とURLを確認してください。

## 公式情報

- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- GitHub Pages制限: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare D1: https://developers.cloudflare.com/d1/
- Cloudflare R2: https://developers.cloudflare.com/r2/pricing/
- Buffer API: https://developers.buffer.com/guides/getting-started.html
- LINE Messaging API: https://developers.line.biz/ja/docs/messaging-api/sending-messages/
