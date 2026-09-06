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
  //
  // Same order OshiDeck itself uses, and it reports which source answered —
  // the wrong channel on screen is almost always the wrong source winning.
  const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
  const fromHref = (href) =>
    /^\/channel\/(UC[A-Za-z0-9_-]{22})(?:[/?#]|$)/.exec(href || "")?.[1] || null;

  // One at a time: a comma-separated list returns whichever matched first in
  // DOCUMENT ORDER, and #owner appears more than once on a watch page.
  const BLOCKS = ["ytd-video-owner-renderer", "ytd-watch-metadata #owner", "#owner"];
  const NOT_A_NAME =
    "#sponsor-button, #subscribe-button, ytd-button-renderer, yt-button-shape," +
    " tp-yt-paper-button, button, yt-subscribe-button-view-model";
  const NAMES = [
    "ytd-channel-name #text", "#channel-name #text",
    "ytd-channel-name a", "#channel-name a"
  ];

  let owner = null;
  let name = "";
  let handle = null;
  let id = null;
  let via = null;

  for (const sel of BLOCKS) {
    const el = top.querySelector(sel);
    if (!el) continue;
    owner = owner || el;
    for (const s of NAMES) {
      if (name) break;
      for (const n of el.querySelectorAll(s)) {
        if (n.closest(NOT_A_NAME)) continue;      // 「メンバー特典」は名前ではない
        if (n.textContent?.trim()) { name = n.textContent.trim(); break; }
      }
    }
    const h = el.querySelector('a[href^="/@"]')?.getAttribute("href")?.split(/[?#]/)[0];
    if (!handle && h && /^\/@[\w.-]{1,64}$/.test(h)) handle = h;
    for (const a of el.querySelectorAll('a[href^="/channel/"]')) {
      id = id || fromHref(a.getAttribute("href"));
      if (id) { via = "オーナー欄のリンク"; break; }
    }
  }

  // 説明欄のカードは動画自身のチャンネルだけを指す（言及しただけの
  // チャンネルは説明文の中に出る）。ハンドル一致が最も強く、ハンドルが
  // 無い場合は全カードが一致したときだけ信じる。
  const cards = [];
  for (const sec of top.querySelectorAll("ytd-video-description-infocards-section-renderer")) {
    const title = sec.querySelector("#title, h3")?.textContent?.trim() || "";
    const matched = handle && sec.querySelector(
      `a[href="${handle}"], a[href^="${handle}/"], a[href^="${handle}?"]`
    );
    for (const a of sec.querySelectorAll('a[href^="/channel/"]')) {
      const cid = fromHref(a.getAttribute("href"));
      if (!cid) continue;
      cards.push({ cid, title, matched: !!matched });
      break;
    }
  }
  const byHandle = cards.find((c) => c.matched);
  const agreed = new Set(cards.map((c) => c.cid)).size === 1 ? cards[0] : null;
  if (byHandle) { id = byHandle.cid; via = "説明欄のカード（ハンドル一致）"; name = byHandle.title || name; }
  else if (!id && agreed) { id = agreed.cid; via = "説明欄のカード（全カード一致）"; name = agreed.title || name; }

  const meta = top.querySelector('meta[itemprop="channelId"]')?.content;
  if (!id && CHANNEL_ID.test(meta || "")) { id = meta; via = "meta[itemprop=channelId]"; }

  // Only believed while it still describes the video in the address bar: after
  // an in-page navigation this script is left over from the video loaded first.
  const video = new URLSearchParams(top.defaultView?.location.search || "").get("v");
  let staleScript = null;
  if (video) for (const s of top.querySelectorAll("script")) {
    const text = s.textContent;
    if (!text || !text.startsWith("var ytInitialPlayerResponse")) continue;
    const scriptVideo = /"videoId"\s*:\s*"([\w-]{11})"/.exec(text)?.[1];
    const scriptId = /"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/.exec(text)?.[1];
    if (scriptVideo !== video) staleScript = { scriptVideo, scriptId };
    else if (!id && CHANNEL_ID.test(scriptId || "")) { id = scriptId; via = "ytInitialPlayerResponse"; }
    break;
  }

  add("チャンネルID", id, id ? `${id}（${via}）` : "どの手段でも取れませんでした");
  add("チャンネル名", name, name || "");
  if (handle) rows.push({ "": "OK", 対象: "オーナーのハンドル", メモ: handle });
  if (staleScript) {
    rows.push({
      "": "OK",
      対象: "ページ内遷移を検出",
      メモ: `埋め込みスクリプトは ${staleScript.scriptVideo} のまま（古いので不使用）`
    });
  }

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
