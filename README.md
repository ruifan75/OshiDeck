# OshiDeck

YouTube Live Chatのコメントやメンバー絵文字の組み合わせを保存し、ワンクリックで呼び出せるChrome拡張機能です。

現在のバージョン: `v0.1.3`

## Features

- 共通（Global）プリセット
- チャンネル別プリセット
- 通常テキスト / Unicode絵文字
- YouTubeのカスタム絵文字・メンバー絵文字を含むプリセット
- プリセットをクリックしてチャット入力欄へ復元
- Global設定による自動送信 ON / OFF
- プリセット削除
- `chrome.storage.local` によるローカル保存

## Install

1. このリポジトリをCloneまたはDownloadします。
2. Chromeで `chrome://extensions/` を開きます。
3. 「デベロッパー モード」をオンにします。
4. 「パッケージ化されていない拡張機能を読み込む」を選択します。
5. OshiDeckのフォルダを選択します。
6. YouTube Live / Premiere のチャットを開きます。

## Usage

1. YouTubeの通常のチャット入力欄でコメントを作ります。
   - `🐦‍🔥⛩🔥🎶🐦‍🔥⛩🔥🎶`
   - `はい！はい！はい！はい！`
   - YouTubeの絵文字ピッカーからメンバー絵文字を並べてもOKです。
2. OshiDeckの「＋ 現在の入力を保存」を押します。
3. 「共通」または「このチャンネル」に保存します。
4. 次回からプリセットをクリックするだけで入力欄へ復元できます。

## Auto Send

設定ページの「プリセットをクリックしたら自動送信する」をオンにすると、プリセットを入力した直後に送信します。

初期値はオフです。

## Notes

OshiDeckはYouTubeの公開APIではなく、Live ChatのDOMを利用しています。
そのためYouTube側のHTML構造が変更された場合、調整が必要になる可能性があります。

メンバー絵文字はYouTubeが入力欄で使用している以下のDOM形式を再現しています。

```html
<img
  class="emoji yt-formatted-string style-scope yt-live-chat-text-input-field-renderer"
  src="..."
  alt="..."
  data-emoji-id="..."
>
```

## Roadmap

- UI / UXの改善
- ドラッグ＆ドロップによる並び替え
- プリセット編集
- チャンネル名の表示
- グループ / フォルダ
- チャット上のコメントから直接保存
- Import / Export
- Chrome Sync
