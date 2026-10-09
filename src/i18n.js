// The words, in one place.
//
// Japanese is the source: it is what the UI was written in, and every message
// here was first said that way. Anything missing from another language falls
// back to it rather than showing a key, because a Japanese sentence is still
// a sentence and `bar.global` is not.
//
// `chrome.i18n` is not used for this. It reads the browser's own UI language
// and offers no way to choose — which is exactly wrong here: someone watching
// Japanese streams with Chrome set to Chinese may want either. So the table
// lives here and the choice is a setting. (`chrome.i18n` still names the
// extension itself in the manifest, which this cannot reach.)
(() => {
  const OD = (globalThis.OshiDeck ||= {});

  const SOURCE = "ja";

  const LANGUAGES = [
    { code: "ja", label: "日本語" },
    { code: "zh-TW", label: "繁體中文" }
  ];

  // `$1`, `$2` … are filled by the caller, in order. Numbered rather than
  // named because the order differs between languages and the number is what
  // survives the move.
  const MESSAGES = {
    /* ---------- the bar ---------- */
    "bar.global":            { ja: "共通", "zh-TW": "通用" },
    "bar.editing":           { ja: "編集中", "zh-TW": "編輯中" },
    "channel.this":          { ja: "このチャンネル", "zh-TW": "這個頻道" },
    "count.cards":           { ja: "$1枚", "zh-TW": "$1 張" },

    /* ---------- buttons ---------- */
    "action.close":          { ja: "閉じる", "zh-TW": "收起" },
    "action.collapse":       { ja: "たたむ", "zh-TW": "收起" },
    "action.build":          { ja: "編成", "zh-TW": "組牌" },
    "action.update":         { ja: "更新", "zh-TW": "更新" },
    "action.cancel":         { ja: "やめる", "zh-TW": "取消" },
    "action.undo":           { ja: "元に戻す", "zh-TW": "復原" },
    "action.undoSave":       { ja: "取り消す", "zh-TW": "取消" },
    "action.more":           { ja: "あと$1枚", "zh-TW": "還有 $1 張" },

    "aria.closePool":        { ja: "プールを閉じる", "zh-TW": "收起卡池" },
    "aria.openBuilder":      { ja: "デッキ編成をひらく", "zh-TW": "打開牌組編輯頁" },
    "aria.updateCard":       { ja: "編集中の札を更新", "zh-TW": "更新編輯中的牌" },
    "aria.cancelEdit":       { ja: "編集をやめる", "zh-TW": "取消編輯" },
    "aria.showRest":         { ja: "残りの札を出す", "zh-TW": "顯示其餘的牌" },
    "aria.addFromPool":      { ja: "プールから札を追加する", "zh-TW": "從卡池加入牌" },

    /* ---------- where a card is saved ---------- */
    "save.channelOnly":      { ja: "$1専用として保存", "zh-TW": "存成 $1 專用" },
    "save.global":           { ja: "共通の札として保存", "zh-TW": "存成通用牌" },
    "save.channelShort":     { ja: "このチャンネル専用", "zh-TW": "這個頻道專用" },
    "save.globalShort":      { ja: "共通", "zh-TW": "通用" },
    "save.pool":             { ja: "プールに保存", "zh-TW": "存進卡池" },
    "save.poolWhy":          { ja: "チャンネルが分からないので、共通の札としてプールに置きます",
                               "zh-TW": "認不出是哪個頻道，所以存成通用牌放進卡池" },
    "save.channelWhy":       { ja: "このチャンネルのデッキだけに出る札にします",
                               "zh-TW": "只會出現在這個頻道的牌組裡" },
    "save.globalWhy":        { ja: "どのチャンネルのデッキにも入れられる札にします",
                               "zh-TW": "任何頻道的牌組都能加入" },
    "save.forcedChannel":    { ja: "メン限スタンプなので、このチャンネル専用にしかできません",
                               "zh-TW": "含會員限定貼圖，只能存成這個頻道專用" },
    "save.forcedWhy":        { ja: "メン限スタンプ入りなので、このチャンネル専用にしかできません",
                               "zh-TW": "含會員限定貼圖，只能設成這個頻道專用" },
    "save.globalBlocked":    { ja: "メン限スタンプ入りの札は共通にできません",
                               "zh-TW": "含會員限定貼圖的牌不能設成通用" },

    /* ---------- what the bar says under the pointer ---------- */
    "peek.saveCard":         { ja: "この札を保存（⇧＋クリックで入力欄へ）",
                               "zh-TW": "儲存這張牌（⇧＋點擊只填入輸入欄）" },
    "peek.takeComment":      { ja: "このコメントを札にする（⇧＋クリックで入力欄へ）",
                               "zh-TW": "把這則留言存成牌（⇧＋點擊只填入輸入欄）" },
    "peek.eject":            { ja: "このデッキから外す", "zh-TW": "從這個牌組移除" },
    "peek.edit":             { ja: "この札を編集", "zh-TW": "編輯這張牌" },
    "peek.lockMembership":   { ja: "メンバー限定：加入すると送れます",
                               "zh-TW": "會員限定：加入會員後可送出" },
    "peek.lockElsewhere":    { ja: "別チャンネル用：ここでは送れません",
                               "zh-TW": "其他頻道專用：這裡無法送出" },

    /* ---------- the pool ---------- */
    "pool.mine":             { ja: "手持ち$1", "zh-TW": "我的牌 $1" },
    "pool.offered":          { ja: "プリセット$1", "zh-TW": "預組 $1" },
    "pool.short":            { ja: "プール$1", "zh-TW": "卡池 $1" },
    "pool.empty":            { ja: "入れられる札がありません", "zh-TW": "沒有可以加入的牌" },
    "pool.emptyHint":        { ja: "コメントを入力して保存すると札になります",
                               "zh-TW": "輸入留言並儲存，就會變成一張牌" },

    /* ---------- what went wrong, and what just happened ---------- */
    "toast.noInput":         { ja: "入力欄が見つかりません", "zh-TW": "找不到輸入欄" },
    "toast.noChannel":       { ja: "チャンネルが分かりません", "zh-TW": "認不出是哪個頻道" },
    "toast.nothingToSave":   { ja: "入れられる中身がありません", "zh-TW": "沒有可以存的內容" },
    "toast.typeSomething":   { ja: "保存する内容を入力してください", "zh-TW": "請先輸入要儲存的內容" },
    "toast.mixedChannels":   { ja: "複数チャンネルのメン限が混ざっています",
                               "zh-TW": "混到了多個頻道的會員限定貼圖" },
    "toast.leftover":        { ja: "送れないスタンプが入力欄に残っています",
                               "zh-TW": "輸入欄裡還留著送不出去的貼圖" },
    "toast.inputKept":       { ja: "入力はそのままです", "zh-TW": "輸入欄的內容保留著" },
    "toast.saveFailed":      { ja: "保存できませんでした", "zh-TW": "儲存失敗" },
    "toast.saveFailedKept":  { ja: "保存できませんでした。$1", "zh-TW": "儲存失敗。$1" },
    "toast.ejected":         { ja: "デッキから外しました（プールに残っています）",
                               "zh-TW": "已從牌組移除（牌還留在卡池裡）" },
    "toast.deleted":         { ja: "札を削除しました", "zh-TW": "已刪除這張牌" },
    "toast.reloaded":        { ja: "OshiDeck を更新しました。ページを再読み込みしてください",
                               "zh-TW": "OshiDeck 已更新，請重新整理頁面" },

    /* ---------- a card that is already there ---------- */
    "dup.globalExists":      { ja: "同じ札が共通の札としてもうあります",
                               "zh-TW": "已經有相同內容的通用牌" },
    "dup.channelExists":     { ja: "同じ札がこのチャンネル専用としてもうあります",
                               "zh-TW": "已經有相同內容的頻道專用牌" },
    "dup.globalExisted":     { ja: "同じ札が共通の札としてもうありました",
                               "zh-TW": "原本就有相同內容的通用牌" },
    "dup.channelExisted":    { ja: "同じ札がこのチャンネル専用としてもうありました",
                               "zh-TW": "原本就有相同內容的頻道專用牌" },
    "dup.inDeck":            { ja: "同じ札がこのデッキにもうあります", "zh-TW": "這個牌組裡已經有相同的牌" },
    "dup.inPool":            { ja: "同じ札がプールにもうあります", "zh-TW": "卡池裡已經有相同的牌" },
    "dup.movedFromPool":     { ja: "プールにあった同じ札をデッキに入れました",
                               "zh-TW": "把卡池裡相同的牌加進牌組了" },
    "saved.pool":            { ja: "プールに保存しました", "zh-TW": "已存進卡池" },
    "saved.global":          { ja: "共通の札として保存しました", "zh-TW": "已存成通用牌" },
    "saved.channel":         { ja: "このチャンネル専用の札として保存しました",
                               "zh-TW": "已存成這個頻道專用的牌" },
    "saved.similar":         { ja: "$1（似た札がすでにあります）", "zh-TW": "$1（已經有內容相近的牌）" },

    /* ---------- a starting hand ---------- */
    "preset.add":            { ja: "＋ $1（$2枚）を入れる", "zh-TW": "＋ 加入「$1」（$2 張）" },
    "preset.failed":         { ja: "読み込めませんでした", "zh-TW": "載入失敗" },
    "preset.loadedReused":   { ja: "「$1」を入れました（うち$2枚はプールにあったもの）",
                               "zh-TW": "已加入「$1」（其中 $2 張原本就在卡池裡）" },

    /* ---------- the membership locks ---------- */
    "lock.membershipPlay":   { ja: "メンバー限定のスタンプです。メンバーになると使えます",
                               "zh-TW": "這是會員限定貼圖，成為會員後就能使用" },
    "lock.elsewherePlay":    { ja: "他チャンネルのメン限スタンプです",
                               "zh-TW": "這是其他頻道的會員限定貼圖" },
    "lock.membershipSave":   { ja: "メンバー限定のスタンプです。メンバーになると保存できます",
                               "zh-TW": "這是會員限定貼圖，成為會員後就能儲存" },
    "lock.elsewhereSave":    { ja: "このチャンネルでは送れないスタンプです",
                               "zh-TW": "這個頻道送不出這個貼圖" },

    /* ---------- the builder: what the columns are called ---------- */
    "size.large":            { ja: "大", "zh-TW": "大" },
    "size.medium":           { ja: "中", "zh-TW": "中" },
    "size.small":            { ja: "小", "zh-TW": "小" },
    "sort.trend":            { ja: "チャット連動", "zh-TW": "跟著聊天室" },
    "sort.heat":             { ja: "最近よく使う順", "zh-TW": "最近常用" },
    "sort.uses":             { ja: "使った回数順", "zh-TW": "使用次數" },
    "sort.manual":           { ja: "自分で並べた順", "zh-TW": "自己排的順序" },
    "sort.trendNote":        { ja: "いまチャットで流れている反応に合う札を前に出します。新しい発言ほど重く数え、4秒ごとに並べ替え。カーソルが札の上にある間は動きません。",
                               "zh-TW": "把符合聊天室當下反應的牌往前排。越新的發言算得越重，每 4 秒重排一次；游標停在牌上時不會動。" },
    "sort.heatNote":         { ja: "このチャンネルでの使用を、古いほど軽く数えます（半減期1週間）。",
                               "zh-TW": "依這個頻道的使用紀錄排序，越久以前的使用算得越輕（半衰期一週）。" },
    "sort.usesNote":         { ja: "このチャンネルで使った回数。ずっと前によく使った札も上に残ります。",
                               "zh-TW": "在這個頻道用過的次數。很久以前常用的牌也會一直留在前面。" },
    "sort.manualNote":       { ja: "編成ページでドラッグして決めた順。勝手に動きません。",
                               "zh-TW": "在牌組編輯頁拖曳決定的順序，不會自己變動。" },

    "opt.capacity":          { ja: "$1 × $2行 = 最大$3枚", "zh-TW": "$1 × $2 行 = 最多 $3 張" },
    "opt.drawNote":          { ja: "12秒のあいだに同じ言葉が$1回以上、かつその間の発言の$2%以上で引きます。",
                               "zh-TW": "12 秒內同一句話出現 $1 次以上，而且佔這段期間發言的 $2% 以上，才會抽牌。" },
    "opt.drawHint":          { ja: "賑やかなチャットほど、ひかえめが要ります。",
                               "zh-TW": "聊天室越熱鬧，越需要保守一點。" },
    "opt.holdNote":          { ja: "引いた札は$1秒そのまま残ります。", "zh-TW": "抽到的牌會留著 $1 秒。" },
    "opt.holdHint":          { ja: "短いと、気づく前に消えることがあります。カーソルがパネル上にある間は入れ替わりません。",
                               "zh-TW": "時間太短可能來不及點到。游標停在面板上時不會換牌。" },
    "opt.paceNote":          { ja: "「チャット連動」の重みが半分になるまで$1秒。",
                               "zh-TW": "「跟著聊天室」的權重減半需要 $1 秒。" },
    "opt.paceHint":          { ja: "速いほど直前の波にすぐ反応し、遅いほど落ち着きます。",
                               "zh-TW": "越快越貼近最新反應，越慢排序越穩定。" },
    "opt.saved":             { ja: "保存しました", "zh-TW": "已儲存" },

    /* ---------- the deck list ---------- */
    "opt.noDecks":           { ja: "配信ページで札を保存するとデッキができます。",
                               "zh-TW": "在直播頁儲存牌之後，就會出現牌組。" },
    "opt.deleteDeck":        { ja: "このデッキを削除（このチャンネル専用の札も一緒に消えます）",
                               "zh-TW": "刪除這個牌組（這個頻道專用的牌也會一起消失）" },
    "aria.deleteDeck":       { ja: "$1 のデッキを削除", "zh-TW": "刪除 $1 的牌組" },
    "opt.oshiColour":        { ja: "推し色", "zh-TW": "應援色" },
    "opt.oshiColourHue":     { ja: "推し色 $1", "zh-TW": "應援色 $1" },
    "opt.hueSlider":         { ja: "推し色を細かく選ぶ", "zh-TW": "細調應援色" },
    "opt.colourPicker":      { ja: "色から選ぶ（カラーコード・スポイト）",
                               "zh-TW": "從顏色選（色碼、滴管）" },

    /* ---------- the deck column ---------- */
    "opt.uses":              { ja: "$1回", "zh-TW": "用過 $1 次" },
    "opt.unused":            { ja: "未使用", "zh-TW": "還沒用過" },
    "peek.ejectPool":        { ja: "このデッキから外す（プールに戻ります）",
                               "zh-TW": "從這個牌組移除（會回到卡池）" },
    "peek.deleteCard":       { ja: "この札を削除（すべてのデッキから消えます）",
                               "zh-TW": "刪除這張牌（會從所有牌組移除）" },
    "opt.deckEmpty":         { ja: "デッキがありません。", "zh-TW": "還沒有牌組。" },
    "opt.deckHint":          { ja: "右のプールからドラッグして追加、札同士をドラッグで並べ替え。",
                               "zh-TW": "從右邊卡池拖曳加入；拖曳牌可調整順序。" },
    "opt.deckHintSorted":    { ja: "並べ替えはできますが、配信ページは「$1」で表示中です。",
                               "zh-TW": "可以排序，但直播頁目前是用「$1」顯示。" },
    "opt.deckEmptyHint":     { ja: "右のプールから札をドラッグしてください。",
                               "zh-TW": "請從右邊的卡池拖一張牌過來。" },

    /* ---------- the pool column ---------- */
    "opt.poolCountFiltered": { ja: "$1 / $2枚", "zh-TW": "$1 / $2 張" },
    "opt.poolCount":         { ja: "$1枚", "zh-TW": "$1 張" },
    "opt.noMatch":           { ja: "一致する札がありません。", "zh-TW": "沒有符合的牌。" },
    "opt.poolEmpty":         { ja: "追加できる札がありません。", "zh-TW": "沒有可以加入的牌。" },
    "opt.stamps":            { ja: "スタンプ$1個", "zh-TW": "貼圖 $1 個" },
    "opt.emptyCard":         { ja: "空の札", "zh-TW": "空白的牌" },

    /* ---------- a starting hand, from the builder ---------- */
    "opt.presetOffer":       { ja: "はじめの一組を入れることもできます:",
                               "zh-TW": "也可以放入一組現成的起手牌：" },
    "opt.presetButton":      { ja: "$1（$2枚）", "zh-TW": "$1（$2 張）" },
    "opt.presetReused":      { ja: "（うち$1枚はプールにあったものを使いました）",
                               "zh-TW": "（其中 $1 張用的是卡池裡原本就有的）" },
    "opt.presetLoaded":      { ja: "「$1」を読み込みました$2", "zh-TW": "已載入「$1」$2" },

    /* ---------- and undoing all of it ---------- */
    "opt.undone":            { ja: "元に戻しました", "zh-TW": "已復原" },
    "opt.addedTo":           { ja: "「$1」を $2 に入れました", "zh-TW": "已把「$1」加進 $2" },
    "opt.reordered":         { ja: "並べ替えました（表示に反映するには並び順を「自分で並べた順」に）",
                               "zh-TW": "已排序（要在直播頁看到，排序方式要選「自己排的順序」）" },
    "opt.ejected":           { ja: "「$1」をデッキから外しました（プールに残っています）",
                               "zh-TW": "已把「$1」移出牌組（牌還留在卡池裡）" },
    "opt.deckDeletedNote":   { ja: "（このチャンネル専用の$1枚も一緒に削除）",
                               "zh-TW": "（這個頻道專用的 $1 張也一起刪除）" },
    "opt.deckKeptNote":      { ja: "（札はプールに残っています）", "zh-TW": "（牌還留在卡池裡）" },
    "opt.deckDeleted":       { ja: "「$1」のデッキを削除しました$2", "zh-TW": "已刪除「$1」的牌組$2" },
    "opt.cardDeleted":       { ja: "「$1」を削除しました", "zh-TW": "已刪除「$1」" },

    /* ---------- deleting a card other decks hold ---------- */
    "opt.sharedWarn":        { ja: "$1 のデッキにもあります。削除すると全部から消えます。",
                               "zh-TW": "$1 的牌組裡也有這張牌。刪除後，這張牌會從所有牌組移除。" },
    "opt.sharedOther":       { ja: "他のデッキにも", "zh-TW": "其他牌組也有" },
    "opt.sharedOthers":      { ja: "他$1つのデッキにも", "zh-TW": "另外 $1 個牌組也有" },
    "opt.sharedAlso":        { ja: "$1 のデッキからも消えます", "zh-TW": "$1 的牌組裡也會消失" },
    "action.delete":         { ja: "削除", "zh-TW": "刪除" },

    /* ---------- export and import ---------- */
    "opt.exported":          { ja: "$1枚を書き出しました", "zh-TW": "已匯出 $1 張" },
    "opt.notJson":           { ja: "JSONとして読めませんでした", "zh-TW": "無法解析這個 JSON 檔案" },
    "opt.cannotRead":        { ja: "読み込めません: $1", "zh-TW": "無法載入：$1" },
    "opt.replaceConfirm":    { ja: "$1: $2枚 / $3デッキ。今のデータをすべて捨てて置き換えます。",
                               "zh-TW": "$1：$2 張 / $3 個牌組。現在的資料會全部丟掉並替換。" },
    "opt.replace":           { ja: "置き換える", "zh-TW": "替換" },
    "opt.replaced":          { ja: "$1枚に置き換えました", "zh-TW": "已替換成 $1 張" },
    "opt.mergedNew":         { ja: "新しい札 $1枚、デッキへの追加 $2件",
                               "zh-TW": "新增 $1 張牌，加進牌組 $2 次" },
    "opt.mergedNone":        { ja: "すでに全部持っていました", "zh-TW": "全部原本就有了" },
    "opt.replaceNote":       { ja: "今のプールとデッキをすべて捨てて、ファイルの内容にします。",
                               "zh-TW": "把現在的卡池和牌組全部丟掉，換成檔案裡的內容。" },
    "opt.mergeNote":         { ja: "同じ内容・同じ保存範囲の札は重複しません。同じファイルを2回読んでも増えません。",
                               "zh-TW": "內容和適用頻道相同的牌不會重複。同一個檔案讀兩次也不會變多。" },
    "opt.cannotExport":      { ja: "書き出せません: $1", "zh-TW": "無法匯出：$1" },
    "opt.presetBound":       { ja: "（このチャンネル専用。メン限スタンプを含みます）",
                               "zh-TW": "（這個頻道專用，含會員限定貼圖）" },
    "opt.presetDropped":     { ja: "（よそのチャンネルのメン限スタンプ$1枚は入りません）",
                               "zh-TW": "（其他頻道的會員限定貼圖 $1 張沒有放進去）" },

    /* ---------- backup and preset validation ---------- */
    "validation.notObject":       { ja: "JSONオブジェクトではありません",
                                    "zh-TW": "JSON 資料必須是物件" },
    "validation.newBackupFormat": { ja: "新しい形式（format $1）です。拡張機能を更新してください",
                                    "zh-TW": "這是較新的格式（format $1），請先更新擴充功能" },
    "validation.cardsNotArray":   { ja: "cards が配列ではありません",
                                    "zh-TW": "cards 必須是陣列" },
    "validation.decksInvalid":    { ja: "decks の形式が不正です",
                                    "zh-TW": "decks 的格式有誤" },
    "validation.cardInvalid":     { ja: "札のデータが壊れています",
                                    "zh-TW": "牌的資料有誤" },
    "validation.cardIdMissing":   { ja: "札にidがありません",
                                    "zh-TW": "牌缺少 id" },
    "validation.cardTokensMissing": { ja: "札に中身がありません",
                                      "zh-TW": "牌缺少內容（tokens）" },
    "validation.cardTokenInvalid": { ja: "札 $1 に壊れた中身があります",
                                     "zh-TW": "牌 $1 含有格式錯誤的內容" },
    "validation.cardTextInvalid": { ja: "札 $1 のテキストが不正です",
                                    "zh-TW": "牌 $1 的文字格式有誤" },
    "validation.emojiIdMissing":  { ja: "札 $1 のスタンプにidがありません",
                                    "zh-TW": "牌 $1 的貼圖缺少 id" },
    "validation.tokenTypeUnknown": { ja: "札 $1 に未知の種類（$2）があります",
                                     "zh-TW": "牌 $1 含有未知的內容類型（$2）" },
    "validation.cardIdDuplicate": { ja: "同じidの札が2枚あります: $1",
                                    "zh-TW": "有兩張牌使用相同的 id：$1" },
    "validation.deckNotArray":    { ja: "デッキ $1 が配列ではありません",
                                    "zh-TW": "牌組 $1 必須是陣列" },
    "validation.deckIdInvalid":   { ja: "デッキ $1 に不正なidがあります",
                                    "zh-TW": "牌組 $1 含有無效的 id" },
    "validation.deckCardMissing": { ja: "デッキ $1 が存在しない札を指しています",
                                    "zh-TW": "牌組 $1 包含不存在的牌" },
    "validation.deckCardDuplicate": { ja: "デッキ $1 に同じ札が重複しています",
                                      "zh-TW": "牌組 $1 重複加入了同一張牌" },
    "validation.cardScopeInvalid": { ja: "札 $1 の scope が不正です",
                                     "zh-TW": "牌 $1 的 scope 無效" },
    "validation.cardScopeNotChannel": { ja: "札 $1 の scope（$2）がチャンネルIDではありません",
                                        "zh-TW": "牌 $1 的 scope（$2）不是頻道 ID" },
    "validation.cardEmojiScope":  { ja: "札 $1 は $2 のメン限スタンプですが scope が $3 です",
                                    "zh-TW": "牌 $1 含有 $2 的會員限定貼圖，但 scope 設為 $3" },
    "validation.cardMixedChannels": { ja: "札 $1 が複数チャンネルのメン限スタンプを含んでいます",
                                      "zh-TW": "牌 $1 混用了多個頻道的會員限定貼圖" },
    "validation.deckEmojiChannel": { ja: "札 $1 は $2 のメン限スタンプですが $3 のデッキにあります",
                                     "zh-TW": "牌 $1 含有 $2 的會員限定貼圖，卻放在 $3 的牌組裡" },
    "validation.deckScopeChannel": { ja: "札 $1 は $2 専用ですが $3 のデッキにあります",
                                     "zh-TW": "牌 $1 是 $2 專用的，卻放在 $3 的牌組裡" },
    "validation.newPresetFormat": { ja: "新しい形式（format $1）です",
                                    "zh-TW": "這是較新的格式（format $1）" },
    "validation.presetNameMissing": { ja: "名前（name）がありません",
                                      "zh-TW": "缺少名稱（name）" },
    "validation.presetCardsEmpty": { ja: "cards が空です",
                                     "zh-TW": "cards 裡沒有任何牌" },
    "validation.presetChannelInvalid": { ja: "channel が不正です: $1",
                                         "zh-TW": "channel 的值無效：$1" },
    "validation.presetTokensMissing": { ja: "札に tokens がありません",
                                        "zh-TW": "牌缺少 tokens" },
    "validation.presetCardEmpty": { ja: "中身のない札があります",
                                    "zh-TW": "有一張牌沒有內容" },
    "validation.presetScopeInvalid": { ja: "scope が不正です: $1",
                                       "zh-TW": "scope 的值無效：$1" },
    "validation.presetMixedChannels": { ja: "複数のチャンネルのメン限スタンプが混ざっています",
                                        "zh-TW": "混用了多個頻道的會員限定貼圖" },
    "validation.presetChannelMissing": { ja: "メン限スタンプを入れるには channel が要ります",
                                         "zh-TW": "含會員限定貼圖時，必須指定 channel" },
    "validation.presetEmojiChannel": { ja: "よそのチャンネルのメン限スタンプが入っています: $1",
                                       "zh-TW": "含有其他頻道的會員限定貼圖：$1" },
    "validation.presetCardDuplicate": { ja: "同じ内容の札が二度入っています",
                                        "zh-TW": "有兩張牌的內容相同" },

    /* ---------- the diagnostic log ---------- */
    "opt.journalCount":      { ja: "$1件を記録しています", "zh-TW": "已記錄 $1 筆" },
    "opt.journalEmpty":      { ja: "まだ記録はありません", "zh-TW": "還沒有任何記錄" },
    "opt.journalNothing":    { ja: "まだ記録がないので、書き出すものがありません",
                               "zh-TW": "還沒有記錄，沒有東西可以匯出" },
    "opt.journalExported":   { ja: "$1件を書き出しました", "zh-TW": "已匯出 $1 筆" },
    "opt.journalCleared":    { ja: "記録を消しました", "zh-TW": "已清除記錄" },
    "opt.journalClearFailed":{ ja: "消せませんでした", "zh-TW": "清除失敗" },

    /* ---------- the settings page itself ---------- */
    "ui.title":              { ja: "OshiDeck 設定", "zh-TW": "OshiDeck 設定" },
    "ui.lede":               { ja: "保存した札の確認と、配信ページでの見え方の設定。",
                               "zh-TW": "檢視存下來的牌，以及設定它們在直播頁的樣子。" },
    "ui.decks":              { ja: "デッキ", "zh-TW": "牌組" },
    "ui.pool":               { ja: "カードプール", "zh-TW": "卡池" },
    "aria.deckList":         { ja: "デッキ一覧", "zh-TW": "牌組清單" },
    "ui.searchPlaceholder":  { ja: "中身で絞り込む", "zh-TW": "用內容篩選" },

    "ui.displayMode":        { ja: "表示モード", "zh-TW": "顯示模式" },
    "ui.modeHand":           { ja: "手札", "zh-TW": "手牌" },
    "ui.modeHandNote":       { ja: "札が扇状に並びます。幅に合わせて1行の枚数が増減。",
                               "zh-TW": "牌像扇子一樣排開，每行幾張會隨寬度增減。" },
    "ui.modeList":           { ja: "リスト", "zh-TW": "列表" },
    "ui.modeListNote":       { ja: "リストで表示。幅に合わせて列数が変わります。",
                               "zh-TW": "以列表顯示，欄數會隨寬度調整。" },

    "ui.handLayout":         { ja: "手札の並べ方", "zh-TW": "手牌的排法" },
    "ui.cardSize":           { ja: "札の大きさ", "zh-TW": "牌的大小" },
    "ui.cardSizeNote":       { ja: "小さいほど枚数が増え、長い札は途中で薄くなります。",
                               "zh-TW": "越小張數越多，內容長的牌會在中途淡出。" },
    "ui.rows":               { ja: "行数", "zh-TW": "行數" },
    "ui.rowsNote":           { ja: "。これは一度に見える枚数で、残りはスクロールで出てきます。",
                               "zh-TW": "。這是一次看得到的張數，其餘的捲動就會出現。" },
    "ui.row1":               { ja: "1行", "zh-TW": "1 行" },
    "ui.row2":               { ja: "2行", "zh-TW": "2 行" },

    "ui.drawEase":           { ja: "引きやすさ", "zh-TW": "多容易抽到" },
    "ui.holdTime":           { ja: "引いた札が残る時間", "zh-TW": "抽到的牌留多久" },
    "ui.pace":               { ja: "反応の速さ", "zh-TW": "反應的快慢" },
    "ui.shy":                { ja: "ひかえめ", "zh-TW": "保守" },
    "ui.normal":             { ja: "ふつう", "zh-TW": "普通" },
    "ui.eager":              { ja: "よく引く", "zh-TW": "常抽" },
    "ui.short":              { ja: "みじかめ", "zh-TW": "短" },
    "ui.long":               { ja: "ながめ", "zh-TW": "長" },
    "ui.slow":               { ja: "ゆっくり", "zh-TW": "慢" },
    "ui.secondsShort":       { ja: "秒", "zh-TW": "秒" },
    "ui.customSeconds":      { ja: "自分で秒数を決める", "zh-TW": "自訂秒數" },
    "ui.quick":              { ja: "はやい", "zh-TW": "快" },

    "ui.sortBy":             { ja: "並び順", "zh-TW": "排序方式" },
    "ui.sortNoteDefault":    { ja: "「最近よく使う順」は、古い使用ほど軽く数えます（半減期1週間）。",
                               "zh-TW": "「最近常用」是越久以前用過的算得越輕（半衰期一週）。" },

    "ui.drawFromChat":       { ja: "チャットから引く", "zh-TW": "從聊天室抽牌" },
    "ui.suggest":            { ja: "いま多い反応を1枚だけ手札に出す",
                               "zh-TW": "把聊天室當下常見的反應抽成一張手牌" },
    "ui.suggestNote":        { ja: "手札にない反応が盛り上がると、左端に1枚出します。＋でデッキに保存できます。メン限スタンプの送信には、そのチャンネルのメンバーシップが必要です。",
                               "zh-TW": "聊天室當下常見的反應不在手牌裡時，會在左端顯示一張。按＋可存進牌組。會員限定貼圖要加入該頻道會員後才能送出。" },

    "ui.send":               { ja: "送信", "zh-TW": "送出" },
    "ui.autoSend":           { ja: "札をクリックしたら自動で送信する", "zh-TW": "點了牌就自動送出" },
    "ui.autoSendNote1":      { ja: "オフなら入力欄に入れるだけ。オフでも",
                               "zh-TW": "關閉時只填入輸入欄，仍可用" },
    "ui.autoSendNote2":      { ja: "＋クリックで送れます。",
                               "zh-TW": "＋點擊直接送出。" },

    "ui.backup":             { ja: "バックアップ", "zh-TW": "備份" },
    "ui.export":             { ja: "書き出す", "zh-TW": "匯出" },
    "ui.exportNote":         { ja: "プール・デッキ・チャンネル設定・表示設定をまとめてJSONにします。",
                               "zh-TW": "把卡池、牌組、頻道設定、顯示設定一起存成 JSON。" },
    "ui.saveToFile":         { ja: "ファイルに保存", "zh-TW": "存成檔案" },
    "ui.import":             { ja: "読み込む", "zh-TW": "載入" },
    "ui.merge":              { ja: "追加", "zh-TW": "合併" },
    "ui.replaceAll":         { ja: "全部置き換え", "zh-TW": "全部替換" },
    "ui.pickFile":           { ja: "ファイルを選ぶ", "zh-TW": "選擇檔案" },

    "opt.deckExport":        { ja: "この編成をファイルに（人に渡せます）",
                               "zh-TW": "把這個牌組存成檔案（可以給別人）" },
    "opt.deckImport":        { ja: "ファイルから、この編成に読み込む",
                               "zh-TW": "從檔案載入到這個牌組" },
    "opt.importNotForHere":  { ja: "このファイルは別のチャンネル専用です（メン限スタンプを含むため）",
                               "zh-TW": "這個檔案是別的頻道專用的（因為含會員限定貼圖）" },
    "opt.importedNothing":   { ja: "入れられる札がありませんでした", "zh-TW": "沒有可以加入的牌" },

    "ui.journal":            { ja: "診断ログ", "zh-TW": "診斷記錄" },
    "ui.journalNote":        { ja: "どのチャンネルをどう判定したかの記録です。うまくいかないときは、このファイルを一緒に送ってください。札やチャットの中身は入っていません。",
                               "zh-TW": "記錄的是「怎麼判斷出是哪個頻道」的過程。出問題時請把這個檔案一起附上。裡面不含牌和聊天的內容。" },
    "ui.clear":              { ja: "消す", "zh-TW": "清除" },
    "ui.clearNote":          { ja: "記録は最新の300件だけ残ります。いったん記録を消してから問題を再現すると、読みやすくなります。",
                               "zh-TW": "只會留最新的 300 筆。先清掉再重現一次，會比較好讀。" },
    "ui.clearButton":        { ja: "記録を消す", "zh-TW": "清除記錄" },

    "ui.language":           { ja: "表示言語", "zh-TW": "顯示語言" },
    "ui.languageNote":       { ja: "このページと配信ページのパネル、どちらにも効きます。",
                               "zh-TW": "這一頁和直播頁的面板都會跟著變。" },
    "ui.languageAuto":       { ja: "ブラウザに合わせる", "zh-TW": "跟著瀏覽器" }
  };

  // "zh-TW" exactly, then any zh-*, then the source. A viewer whose Chrome is
  // in zh-CN is better served by Traditional Chinese than by Japanese, and
  // better served by Japanese than by a screen full of dotted keys.
  function resolve(want) {
    const code = String(want || "").trim();
    if (!code) return SOURCE;
    if (MESSAGES["bar.global"][code]) return code;
    const primary = code.split("-")[0].toLowerCase();
    const near = LANGUAGES.find((lang) => lang.code.split("-")[0].toLowerCase() === primary);
    return near ? near.code : SOURCE;
  }

  // What the browser itself is in, as the opening guess. The setting overrides
  // it, and "" in the setting means "keep guessing" rather than "Japanese".
  function fromBrowser() {
    try {
      return resolve(chrome.i18n?.getUILanguage?.());
    } catch (_) {
      return SOURCE;
    }
  }

  let current = fromBrowser();

  const use = (want) => (current = want ? resolve(want) : fromBrowser());

  function t(key, ...args) {
    // Validators return [key, ...arguments] instead of choosing a language.
    // Resolve those arguments now, so existing status wrappers translate both
    // halves together, even if the language changed after validation. Values
    // inside an error are file data, so keep them literal rather than treating
    // a malformed value that resembles an error tuple as another message.
    args = args.map((value) =>
      !String(key).startsWith("validation.") &&
      Array.isArray(value) && typeof value[0] === "string" && value[0].startsWith("validation.")
        ? t(...value)
        : value
    );
    const entry = MESSAGES[key];
    // A missing key is a bug, and showing the key is how it gets noticed.
    // A missing *translation* is not: the Japanese is still a sentence.
    const text = entry ? entry[current] || entry[SOURCE] : key;
    return args.length
      ? text.replace(/\$(\d)/g, (_, n) => String(args[Number(n) - 1] ?? ""))
      : text;
  }

  OD.i18n = { t, use, resolve, MESSAGES, LANGUAGES, SOURCE, current: () => current };
})();
