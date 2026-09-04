// Paste into the DevTools console on a YouTube live stream to check that the
// selectors OshiDeck relies on still resolve. Read-only: nothing is typed or
// sent. Works from the top frame — it reaches into the live_chat iframe.
(() => {
  const frame = [...document.querySelectorAll("iframe")]
    .find((f) => (f.src || "").includes("live_chat"));

  let chat = document;
  let where = "this document";
  if (frame) {
    try {
      chat = frame.contentDocument || chat;
      where = "live_chat iframe";
    } catch { where = "live_chat iframe (blocked)"; }
  } else if (location.pathname.includes("live_chat")) {
    where = "live_chat document";
  }

  const q = (sel, doc = chat) => doc.querySelector(sel);
  const rows = [];
  const add = (label, value, note = "") =>
    rows.push({ "": value ? "OK" : "MISSING", 対象: label, メモ: note || (value ? "" : "見つからない") });

  const renderer =
    q("yt-live-chat-text-input-field-renderer#input") ||
    q("yt-live-chat-text-input-field-renderer");
  const input =
    renderer?.querySelector('[contenteditable="true"]') ||
    renderer?.querySelector("[contenteditable]") ||
    q('yt-live-chat-message-input-renderer [contenteditable="true"]');

  const send =
    q("yt-live-chat-message-input-renderer #send-button button") ||
    q("#send-button button") ||
    q("yt-button-renderer#send-button button");

  const items =
    q("yt-live-chat-item-list-renderer #items") ||
    q("#chat #items") ||
    q("#item-scroller #items");

  const panel = q("#input-panel") || q("yt-live-chat-message-input-renderer");

  add("チャット入力欄", input, input ? `contenteditable=${input.getAttribute("contenteditable")}` : "");
  add("送信ボタン", send, send ? `disabled=${send.disabled} aria-disabled=${send.getAttribute("aria-disabled")}` : "");
  add("チャット一覧 (#items)", items, items ? `${items.children.length}件表示中` : "チャット連動が動きません");
  add("マウント先", panel, panel ? `#${panel.id || panel.tagName.toLowerCase()}` : "");

  // Channel id and name come from the parent document.
  const top = frame ? document : (() => { try { return window.top.document; } catch { return document; } })();
  const meta = top.querySelector('meta[itemprop="channelId"]')?.content;
  const link = top.querySelector('ytd-video-owner-renderer a[href^="/channel/"], #owner a[href^="/channel/"]');
  const id = meta || link?.getAttribute("href")?.match(/^\/channel\/([^/?#]+)/)?.[1];
  const name = top.querySelector("ytd-video-owner-renderer #channel-name a")?.textContent?.trim();
  add("チャンネルID", id, id || "");
  add("チャンネル名", name, name || "");

  // This is what OshiDeck uses to decide whether a card is sendable here.
  const OWNER = /^(UC[A-Za-z0-9_-]{22})\//;
  const stamps = [...chat.querySelectorAll("img[data-emoji-id]")];
  const ids = [...new Set(stamps.map((i) => i.getAttribute("data-emoji-id")).filter(Boolean))];
  add("絵文字が流れている", stamps.length, `${stamps.length}件（ユニーク ${ids.length}種）`);

  console.log(`OshiDeck selftest — 探索先: ${where}`);
  console.table(rows);

  // The id format is the part we are least sure about, so print it raw.
  if (ids.length) {
    console.log("\n実際に流れている絵文字ID（この形が判定の前提です）:");
    console.table(ids.slice(0, 25).map((raw) => {
      const owner = OWNER.exec(raw)?.[1] || null;
      return {
        "data-emoji-id": raw.length > 60 ? raw.slice(0, 60) + "…" : raw,
        長さ: raw.length,
        "/を含む": raw.includes("/"),
        判定された持ち主: owner || "-",
        判定: owner ? (owner === id ? "この配信のメン限" : "他チャンネルのメン限") : "公開絵文字"
      };
    }));
    const wrong = ids.filter((raw) => { const o = OWNER.exec(raw)?.[1]; return o && o !== id; });
    if (wrong.length) {
      console.warn(`この配信で流れているのに「他チャンネル」と判定されたIDが ${wrong.length}件あります — これは誤判定です:`);
      console.warn(wrong.slice(0, 5));
    }
  } else {
    console.log("\n絵文字がまだ流れていません。少し待ってからもう一度実行してください。");
  }

  const missing = rows.filter((r) => r[""] === "MISSING").map((r) => r.対象);
  console.log(missing.length ? `\n直す必要があるのは: ${missing.join(", ")}` : "\nすべての参照が解決しました");
  return { rows, emojiIds: ids, channelId: id };
})();
