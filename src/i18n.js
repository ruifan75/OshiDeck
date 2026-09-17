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
    "action.build":          { ja: "編成", "zh-TW": "編組" },
    "action.update":         { ja: "更新", "zh-TW": "更新" },
    "action.cancel":         { ja: "やめる", "zh-TW": "取消" },
    "action.undo":           { ja: "元に戻す", "zh-TW": "復原" },
    "action.undoSave":       { ja: "取り消す", "zh-TW": "取消" },
    "action.more":           { ja: "あと$1枚", "zh-TW": "還有 $1 張" },

    "aria.closePool":        { ja: "プールを閉じる", "zh-TW": "收起卡池" },
    "aria.openBuilder":      { ja: "デッキ編成をひらく", "zh-TW": "打開牌組編組頁" },
    "aria.updateCard":       { ja: "編集中の札を更新", "zh-TW": "更新編輯中的牌" },
    "aria.cancelEdit":       { ja: "編集をやめる", "zh-TW": "取消編輯" },
    "aria.showRest":         { ja: "残りの札を出す", "zh-TW": "顯示其餘的牌" },
    "aria.addFromPool":      { ja: "プールから札を追加する", "zh-TW": "從卡池加入牌" },

    /* ---------- where a card is saved ---------- */
    "save.channelOnly":      { ja: "$1専用として保存", "zh-TW": "存成 $1 專用" },
    "save.global":           { ja: "通用の札として保存", "zh-TW": "存成通用牌" },
    "save.channelShort":     { ja: "このチャンネル専用", "zh-TW": "這個頻道專用" },
    "save.globalShort":      { ja: "通用", "zh-TW": "通用" },
    "save.pool":             { ja: "プールに保存", "zh-TW": "存進卡池" },
    "save.poolWhy":          { ja: "チャンネルが分からないので、通用の札としてプールに置きます",
                               "zh-TW": "認不出是哪個頻道，所以存成通用牌放進卡池" },
    "save.channelWhy":       { ja: "このチャンネルのデッキだけに出る札にします",
                               "zh-TW": "只會出現在這個頻道的牌組裡" },
    "save.globalWhy":        { ja: "どのチャンネルのデッキにも入れられる札にします",
                               "zh-TW": "任何頻道的牌組都能加入" },
    "save.forcedChannel":    { ja: "メン限スタンプなので、このチャンネル専用にしかできません",
                               "zh-TW": "含會員限定貼圖，只能存成這個頻道專用" },
    "save.forcedWhy":        { ja: "メン限スタンプ入りなので、このチャンネル専用にしかできません",
                               "zh-TW": "含會員限定貼圖，只能設成這個頻道專用" },
    "save.globalBlocked":    { ja: "メン限スタンプ入りの札は通用にできません",
                               "zh-TW": "含會員限定貼圖的牌不能設成通用" },

    /* ---------- what the bar says under the pointer ---------- */
    "peek.saveCard":         { ja: "この札を保存（⇧＋クリックで入力欄へ）",
                               "zh-TW": "儲存這張牌（⇧＋點擊只填入輸入欄）" },
    "peek.takeComment":      { ja: "このコメントを札にする（⇧＋クリックで入力欄へ）",
                               "zh-TW": "把這則留言存成牌（⇧＋點擊只填入輸入欄）" },
    "peek.eject":            { ja: "このデッキから外す", "zh-TW": "從這個牌組移除" },
    "peek.edit":             { ja: "この札を編集", "zh-TW": "編輯這張牌" },
    "peek.stamps":           { ja: "スタンプ $1個", "zh-TW": "貼圖 $1 個" },
    "peek.drawnHits":        { ja: "$1  ・ いま立て続けに$2回。押すと入力欄へ、＋で保存",
                               "zh-TW": "$1  ・ 剛剛連續出現 $2 次。點擊填入輸入欄，＋ 可儲存" },
    "peek.hits":             { ja: "$1  ・ いまチャットで$2回",
                               "zh-TW": "$1  ・ 聊天室裡正出現 $2 次" },
    "peek.lockMembership":   { ja: "メンバー限定のスタンプ — メンバーになると送れます",
                               "zh-TW": "會員限定貼圖 — 成為會員後就能送出" },
    "peek.lockElsewhere":    { ja: "別チャンネルのメン限スタンプ — この配信では送れません",
                               "zh-TW": "其他頻道的會員限定貼圖 — 這場直播送不出去" },

    /* ---------- the pool ---------- */
    "pool.addFrom":          { ja: "プールから追加", "zh-TW": "從卡池加入" },
    "pool.addFromCount":     { ja: "プールから追加（$1枚）", "zh-TW": "從卡池加入（$1 張）" },
    "pool.empty":            { ja: "プールに追加できる札がありません", "zh-TW": "沒有可以加入的牌" },
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
    "toast.cardUpdated":     { ja: "札を更新しました", "zh-TW": "已更新這張牌" },
    "toast.editHint":        { ja: "直したら「更新」を押してください", "zh-TW": "改好後按「更新」" },
    "toast.editCancelled":   { ja: "編集をやめました", "zh-TW": "已取消編輯" },
    "toast.ejected":         { ja: "デッキから外しました（プールに残っています）",
                               "zh-TW": "已從牌組移除（牌還留在卡池裡）" },
    "toast.deleted":         { ja: "札を削除しました", "zh-TW": "已刪除這張牌" },
    "toast.reloaded":        { ja: "OshiDeck を更新しました。ページを再読み込みしてください",
                               "zh-TW": "OshiDeck 已更新，請重新整理頁面" },

    /* ---------- a card that is already there ---------- */
    "dup.globalExists":      { ja: "同じ札が通用の札としてもうあります",
                               "zh-TW": "已經有相同內容的通用牌" },
    "dup.channelExists":     { ja: "同じ札がこのチャンネル専用としてもうあります",
                               "zh-TW": "已經有相同內容的頻道專用牌" },
    "dup.globalExisted":     { ja: "同じ札が通用の札としてもうありました",
                               "zh-TW": "原本就有相同內容的通用牌" },
    "dup.channelExisted":    { ja: "同じ札がこのチャンネル専用としてもうありました",
                               "zh-TW": "原本就有相同內容的頻道專用牌" },
    "dup.inDeck":            { ja: "同じ札がこのデッキにもうあります", "zh-TW": "這個牌組裡已經有相同的牌" },
    "dup.inPool":            { ja: "同じ札がプールにもうあります", "zh-TW": "卡池裡已經有相同的牌" },
    "dup.movedFromPool":     { ja: "プールにあった同じ札をデッキに入れました",
                               "zh-TW": "把卡池裡相同的牌加進牌組了" },
    "saved.pool":            { ja: "プールに保存しました", "zh-TW": "已存進卡池" },
    "saved.global":          { ja: "通用の札として保存しました", "zh-TW": "已存成通用牌" },
    "saved.channel":         { ja: "このチャンネル専用の札として保存しました",
                               "zh-TW": "已存成這個頻道專用的牌" },
    "saved.similar":         { ja: "$1（似た札がすでにあります）", "zh-TW": "$1（已經有內容相近的牌）" },

    /* ---------- a starting hand ---------- */
    "preset.add":            { ja: "＋ $1（$2枚）を入れる", "zh-TW": "＋ 加入「$1」（$2 張）" },
    "preset.failed":         { ja: "読み込めませんでした", "zh-TW": "載入失敗" },
    "preset.loaded":         { ja: "「$1」を入れました", "zh-TW": "已加入「$1」" },
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
                               "zh-TW": "這個頻道送不出這個貼圖" }
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
