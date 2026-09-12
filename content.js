// OshiDeck — card deck for YouTube Live Chat.
(() => {
  const OD = globalThis.OshiDeck;
  const { journal, layout, presets, store, tokens, trending } = OD;

  const MAX_ROWS_CAP = 2;
  const PANEL_PADDING = 24;    // matches #oshideck-root horizontal padding in content.css
  const SCROLLBAR_GUTTER = 8;  // matches the ::-webkit-scrollbar width, plus slack
  const LIST_VISIBLE = 12;     // rows shown before the list starts scrolling

  let rootEl = null;
  let currentInput = null;
  let refreshTimer = null;
  let resizeObserver = null;
  let lastWidth = 0;
  let notice = null;
  let inputHasContent = false;
  let currentTokens = [];
  let barEl = null;
  let barContext = null;
  let watchedInput = null;
  let inputObserver = null;
  let panelObserver = null;
  let watchedRenderer = null;
  let grabEl = null;
  let grabRow = null;
  let expanded = false;
  let flashId = null;
  let drag = null;
  let poolOpen = false;
  let peek = null;
  let peekOwner = null; // the element whose description the bar is showing
  let painted = null;   // what the panel is already showing
  let editingId = null;  // card being re-recorded, if any
  let settingsCache = { ...store.DEFAULT_SETTINGS };
  let frozen = false;    // pointer is over the deck — do not reorder under it
  let pendingRender = false;

  // Always running: even outside trend mode it keeps emoji urls fresh.
  const watcher = trending.createWatcher({
    onChange: () => {
      // Chat can change the hand two ways now: by reordering it, and by
      // holding out a card that is not in it.
      if (settingsCache.sortBy === "trend" || settingsCache.suggest) scheduleRender();
    }
  });

  const log = (...args) => console.debug("[OshiDeck]", ...args);

  /* ---------- YouTube DOM ---------- */

  function findChatInput() {
    const renderer =
      document.querySelector("yt-live-chat-text-input-field-renderer#input") ||
      document.querySelector("yt-live-chat-text-input-field-renderer");

    return (
      renderer?.querySelector('[contenteditable="true"]') ||
      renderer?.querySelector("[contenteditable]") ||
      document.querySelector('yt-live-chat-message-input-renderer [contenteditable="true"]') ||
      document.querySelector("yt-live-chat-message-input-renderer [contenteditable]")
    );
  }

  // Rendered, not merely present. A collapsed element still answers
  // querySelector, which is how the deck came to be drawn over the Super Chat
  // panel: YouTube hides the input rather than removing it, so "found" was
  // read as "usable" and rendering carried on into the same corner.
  const isRendered = (el) => !!el && el.getClientRects().length > 0;

  // The input anyone can actually type into. Measuring forces a layout, so
  // this belongs in render() and in deliberate actions — never in the mutation
  // hot path, which runs on every chat message.
  function getChatInput() {
    const input = findChatInput();
    return isRendered(input) ? input : null;
  }

  // YouTube marks the input renderer while its own panel occupies that corner
  // (`product-picker-open` today) and collapses the input inside it. Watching
  // one element's attributes is cheap and, by not naming the attribute, keeps
  // working if YouTube renames it — this only says "look again", and render()
  // decides by measuring.
  function watchInputPanel() {
    const renderer = document.querySelector("yt-live-chat-message-input-renderer");
    if (!renderer || renderer === watchedRenderer) return;
    panelObserver?.disconnect();
    watchedRenderer = renderer;
    panelObserver = new MutationObserver(syncVisibility);
    panelObserver.observe(renderer, { attributes: true });
  }

  // Hiding is not reordering. The freeze exists so cards cannot move out from
  // under the pointer, and routing this through it left the deck drawn over
  // the Super Chat panel for as long as the pointer stayed on the deck.
  function syncVisibility() {
    if (stopped) return;
    const hide = !getChatInput();

    // Nothing mounted yet — the first render found the input collapsed and
    // returned before mounting. Returning here too left the deck missing
    // until something else happened to schedule a render, which on a quiet
    // chat can be a long time.
    if (!rootEl?.isConnected) {
      if (!hide) scheduleRender();
      return;
    }

    if (rootEl.hidden === hide) return;
    rootEl.hidden = hide;

    if (!hide) return scheduleRender();
    // Nothing is under the pointer any more, and no pointerleave is owed.
    frozen = false;
    painted = null;
    journal.record({ kind: "note", what: "stepped-aside", reason: "input-not-rendered" });
  }

  const getScroller = () =>
    document.querySelector("yt-live-chat-item-list-renderer #item-scroller") ||
    document.querySelector("#item-scroller") ||
    document.querySelector("#chat #item-scroller");

  // Growing or shrinking the panel changes the scroller's viewport, and YouTube
  // reads that as the reader having scrolled up: it stops following the chat.
  // Put it back where it was so the stream keeps running.
  function keepChatPinned(mutate) {
    const scroller = getScroller();
    const pinned =
      scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;

    mutate();

    if (!pinned || !scroller) return;
    const stick = () => { scroller.scrollTop = scroller.scrollHeight; };
    stick();
    requestAnimationFrame(stick); // again after our own layout settles
  }

  const getSendButton = () =>
    document.querySelector("yt-live-chat-message-input-renderer #send-button button") ||
    document.querySelector("#send-button button") ||
    document.querySelector("yt-button-renderer#send-button button");

  const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

  const asChannelId = (value) =>
    typeof value === "string" && CHANNEL_ID.test(value) ? value : null;

  const channelFromHref = (href) =>
    asChannelId(/^\/channel\/(UC[A-Za-z0-9_-]{22})(?:[/?#]|$)/.exec(href || "")?.[1]);

  // Every source below has to be owner-scoped AND has to be checked for
  // freshness. Both rules were learned from a wrong channel on screen.
  //
  // Owner-scoped: these were once a single comma-separated selector list,
  // which does NOT mean "try each in turn" — querySelector returns the first
  // element in DOCUMENT ORDER matching any of them. So a broad
  // `ytd-channel-name a[href^="/channel/"]` beat the owner and filed cards
  // under whichever channel the video merely mentioned.
  //
  // Fresh: YouTube navigates without reloading, and not every part of the page
  // that carries a channel id keeps up. Both `ytInitialPlayerResponse` and the
  // `itemprop="author"` microdata still describe the PREVIOUS video after an
  // in-page navigation, so neither may be believed unguarded.
  // One selector at a time, in order. A comma-separated list would NOT mean
  // "try each in turn": querySelector returns whichever matched first in
  // DOCUMENT ORDER, and `#owner` appears in more than one place on a watch
  // page — that is how an empty one won and detection gave up entirely.
  const OWNER_BLOCKS = [
    "ytd-video-owner-renderer",
    "ytd-watch-metadata #owner",
    "#owner"
  ];

  // Buttons sit inside the owner block and link to the channel too: the
  // membership button is `/channel/UC…/join`. Its id is the right one, but
  // reading its label put 「メンバー特典」 on screen where the channel name
  // belongs — so ids may come from any link here, names never do.
  const NOT_A_NAME =
    "#sponsor-button, #subscribe-button, ytd-button-renderer, yt-button-shape," +
    " tp-yt-paper-button, button, yt-subscribe-button-view-model";

  const NAME_IN_OWNER = [
    "ytd-channel-name #text",
    "#channel-name #text",
    "ytd-channel-name a",
    "#channel-name a"
  ];

  function ownerName(owner) {
    for (const selector of NAME_IN_OWNER) {
      for (const el of owner.querySelectorAll(selector)) {
        if (el.closest(NOT_A_NAME)) continue;
        const text = el.textContent?.trim();
        if (text) return text;
      }
    }
    return "";
  }

  // `/@name`, with query and fragment dropped and percent-escapes undone so an
  // encoded handle and a plain one compare equal. Nothing here restricts the
  // character set: YouTube supports handles outside ASCII, and `\w` quietly
  // rejected them — which on a layout whose owner block carries no id link
  // meant no identification at all.
  function handleOf(href) {
    const path = (href || "").split(/[?#]/)[0];
    if (!path.startsWith("/@")) return null;

    // Only the first segment: an info card can link to `/@name/videos` while
    // the owner block links to `/@name`, and comparing whole paths made those
    // two different channels. The old attribute selector allowed the tab form
    // explicitly; dropping it silently narrowed the match.
    const name = path.split("/")[1];
    if (!name || name.length < 2) return null;

    try {
      return `/${decodeURIComponent(name).toLowerCase()}`;
    } catch (_) {
      return `/${name.toLowerCase()}`; // malformed escape: compare it as written
    }
  }

  function ownerHandle(doc) {
    for (const selector of OWNER_BLOCKS) {
      const owner = doc.querySelector(selector);
      const handle = handleOf(owner?.querySelector("a[href^='/@']")?.getAttribute("href"));
      if (handle) return handle;
    }
    return null;
  }

  const namesHandle = (section, handle) =>
    [...section.querySelectorAll("a[href^='/@']")]
      .some((link) => handleOf(link.getAttribute("href")) === handle);

  const cardName = (section) =>
    section.querySelector("#title, h3")?.textContent?.trim() || "";

  // The owner block often names its channel only by handle, and on some
  // layouts — a collaboration, a members-only premiere — it carries no link at
  // all. The description's info cards describe the video's own channel and
  // pair its handle with a `/channel/UC…` link, so they can supply the id when
  // the owner block cannot. A channel the description merely mentions is NOT
  // here; it appears inline in the description text.
  //
  // Matching the owner's handle is the strong form. Without a handle the cards
  // are believed only when they all name one channel, so a layout that ever
  // lists a second one refuses rather than guesses.
  function fromInfocards(doc, handle) {
    const seen = [];

    for (const section of doc.querySelectorAll(
      "ytd-video-description-infocards-section-renderer"
    )) {
      const isOwner = !!handle && namesHandle(section, handle);
      for (const link of section.querySelectorAll("a[href^='/channel/']")) {
        const id = channelFromHref(link.getAttribute("href"));
        if (!id) continue;
        if (isOwner) return { id, name: cardName(section), byHandle: true };
        seen.push({ id, name: cardName(section), byHandle: false });
        break;
      }
    }

    // Knowing the owner handle and finding no card for it means these cards
    // describe somebody else. Unanimity answers only the case the owner block
    // gave no handle at all — a collaboration, where it carries no link.
    if (handle) return null;

    return new Set(seen.map((card) => card.id)).size === 1 ? seen[0] : null;
  }

  // Authoritative — but only while it still describes the video in the address
  // bar. After an in-page navigation this script is left over from whichever
  // video was loaded first, and often removed outright, so a mismatch means
  // "no answer", never "keep it".
  function fromPlayerResponse(doc) {
    const video = new URLSearchParams(doc.defaultView?.location.search || "").get("v");
    if (!video) return null;
    for (const script of doc.querySelectorAll("script")) {
      const text = script.textContent;
      if (!text || !text.startsWith("var ytInitialPlayerResponse")) continue;
      if (/"videoId"\s*:\s*"([\w-]{11})"/.exec(text)?.[1] !== video) return null;
      const id = asChannelId(/"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/.exec(text)?.[1]);
      return id && { id, name: /"ownerChannelName"\s*:\s*"(.{0,80}?)"/.exec(text)?.[1] || "" };
    }
    return null;
  }

  // During an in-page navigation the address bar changes about a second before
  // the page does — measured, not assumed. `ytd-watch-flexy` carries the video
  // the DOM is actually showing, so while the two disagree every source below
  // still describes the video we just left. Reading anyway paired the previous
  // owner with the new video, and that pairing outlived the DOM that made it.
  function showsCurrentVideo(doc) {
    const shown = doc.querySelector("ytd-watch-flexy")?.getAttribute("video-id");
    if (!shown) return true; // a popped-out chat has no player to disagree with
    const video = new URLSearchParams(doc.defaultView?.location.search || "").get("v");
    return !video || shown === video;
  }

  function readChannel(doc) {
    if (!showsCurrentVideo(doc)) return null;

    const cards = fromInfocards(doc, ownerHandle(doc));

    let ownerId = null;
    let label = "";
    for (const selector of OWNER_BLOCKS) {
      const owner = doc.querySelector(selector);
      if (!owner) continue;
      label = label || ownerName(owner);
      for (const link of owner.querySelectorAll("a[href^='/channel/']")) {
        ownerId = ownerId || channelFromHref(link.getAttribute("href"));
        if (ownerId) break;
      }
      if (ownerId && label) break;
    }

    // The card's title is the channel's own, while the owner row can summarise
    // a collaboration ("REVERBERATION和2"), so it is the better label.
    const name = cards?.name || label;

    // A card matched by the owner's own handle is the most direct evidence
    // there is; otherwise a link in the owner block outranks unanimity.
    if (cards?.byHandle) return { id: cards.id, name, via: "card-by-handle" };
    if (ownerId) return { id: ownerId, name, via: "owner-link" };
    if (cards) return { id: cards.id, name, via: "cards-agree" };

    const meta = asChannelId(doc.querySelector('meta[itemprop="channelId"]')?.content);
    if (meta) return { id: meta, name, via: "meta" };

    const player = fromPlayerResponse(doc);
    return player ? { id: player.id, name: name || player.name, via: "player-response" } : null;
  }

  // Only built when detection failed, and only shapes — which sources existed,
  // never anything anyone wrote. This is precisely the list that had to be
  // gathered by hand, on the live page, to explain the last two bad channels.
  function describeSources() {
    let doc = document;
    try {
      if (window.top !== window && window.top.document) doc = window.top.document;
    } catch (_) { /* cross-origin frame: describe what this one had */ }

    const block = OWNER_BLOCKS.find((selector) => doc.querySelector(selector));
    const owner = block ? doc.querySelector(block) : null;
    const sections = doc.querySelectorAll(
      "ytd-video-description-infocards-section-renderer"
    );

    const ids = new Set();
    for (const section of sections) {
      for (const link of section.querySelectorAll("a[href^='/channel/']")) {
        const id = channelFromHref(link.getAttribute("href"));
        if (id) { ids.add(id); break; }
      }
    }

    return {
      ownerBlock: block || "none",
      ownerLink: !!owner?.querySelector("a[href^='/channel/']"),
      handle: !!ownerHandle(doc),
      cards: sections.length,
      cardIds: [...ids],
      meta: !!doc.querySelector('meta[itemprop="channelId"]'),
      player: fromPlayerResponse(doc) ? "fresh" : "stale-or-absent"
    };
  }

  // The live chat runs in a same-origin iframe, so the video in the address
  // bar is the parent's.
  function currentVideo() {
    try {
      const top = window.top !== window ? window.top : window;
      return new URLSearchParams(top.location.search).get("v");
    } catch (_) {
      return null; // cross-origin frame: nothing to read
    }
  }

  // An answer is kept only for the video it was found on. Keeping it any
  // longer is how the panel came to name a channel the viewer had already
  // left: the page moved on, detection came up empty for a moment, and the
  // previous answer was still sitting there looking current.
  let lastSeen = { video: null, channel: null };

  function getChannel() {
    const video = currentVideo();
    let found = readChannel(document);
    if (!found) {
      try {
        if (window.top !== window) found = readChannel(window.top.document);
      } catch (_) { /* cross-origin frame: nothing to read */ }
    }

    if (found) {
      lastSeen = { video, channel: found };
      return found;
    }

    // The info cards that carry the id fill in after the rest of the page, so
    // a blank answer for the video we already identified is a gap, not a move.
    return video && video === lastSeen.video ? lastSeen.channel : null;
  }

  /* ---------- deck assembly ---------- */

  // Nothing appears here unless it was put here: the deck is an explicit list
  // drawn from the pool.
  function buildDeck(data, channelId) {
    const cards = store.deckOf(data, channelId).map((card) => ({ ...card }));
    markLocked(cards, channelId);
    // The stripe had become the deck's colour on every card, which said
    // nothing. It marks scope again: grey works anywhere, coloured is tied to
    // this channel by its member emoji — and that is what makes deleting it
    // feel different.
    for (const card of cards) card.bound = store.scopeOf(card) !== store.GLOBAL;
    return orderDeck(cards, data.settings);
  }

  // Member emoji only send on the channel that hands them out. Lock only when
  // we are sure: with no channel detected we cannot judge ownership, and a
  // wrong lock is far worse than a card that fails to send.
  function markLocked(cards, channelId) {
    for (const card of cards) {
      const required = channelId ? tokens.requiredChannels(card.tokens) : [];
      card.locked = required.length > 0 && !required.every((id) => id === channelId);
    }
    return cards;
  }

  function orderDeck(cards, settings) {
    if (settings.sortBy !== "trend") return store.sortCards(cards, settings.sortBy);

    const ranking = watcher.ranking();
    // Personal habit is the tiebreak, so a quiet chat still gives a sane order.
    const fallback = new Map(
      store.sortCards(cards, "heat").map((card, index) => [card.id, index])
    );

    return cards
      .map((card) => {
        card.signature ||= trending.signature(card.tokens || []);
        const seen = ranking.get(card.signature);
        card.hits = seen?.count || 0;   // what the bar tells the viewer
        card.trend = seen?.score || 0;  // what decides the order
        return card;
      })
      .sort((a, b) => b.trend - a.trend || fallback.get(a.id) - fallback.get(b.id));
  }

  // A card is drawn when the chat bursts — several people saying the same
  // thing within a few seconds — not merely when something is popular. It then
  // stays put for a while: recomputing it every render made it flicker between
  // reactions, and a card that changes under the pointer is worth less than no
  // card.
  //
  // Matching is by exact wording, not by the loose signature that orders the
  // hand. That signature deliberately treats `きちゃ` and `きちゃきちゃ` as one
  // reaction, which is right for sorting and wrong for offering: they are
  // different things to say.
  const HOLD_MS = 45_000;

  let drawn = null;       // { key, card, until }
  let drawnShown = null;  // the card the entry animation has already played for

  // Must match od-drawn-breathe in content.css: the glow is picked up where
  // the last one left off, and that needs the cycle length.
  const BREATH_MS = 2600;

  // A reaction already in the hand is no offer at all, and member emoji are
  // left out altogether: they belong to this channel, but YouTube serves them
  // to members only, and a card that fails when pressed is worse than no card.
  // When membership can be told apart, that is the line to revisit.
  const worthOffering = (mine) => (seen) =>
    !mine.has(seen.key) &&
    tokens.hasSubstance(seen.tokens) &&
    !tokens.requiredChannels(seen.tokens).length;

  function drawFromChat(deck) {
    if (!settingsCache.suggest) return (drawn = null);

    const now = Date.now();
    const mine = new Set();
    for (const card of deck) {
      card.key ||= tokens.cardKey(card.tokens || []);
      mine.add(card.key);
    }

    // Taking it into the deck ends the offer, and so does its time running out.
    if (drawn && (now >= drawn.until || mine.has(drawn.key))) drawn = null;
    if (drawn) return drawn.card;

    const seen = watcher.burst(worthOffering(mine));
    if (!seen) return null;

    drawn = {
      key: seen.key,
      until: now + HOLD_MS,
      card: {
        id: `drawn:${seen.key}`,
        drawn: true,      // not a card anyone owns: no id in storage
        tokens: seen.tokens,
        key: seen.key,
        hits: seen.count
      }
    };
    return drawn.card;
  }

  function buildDrawnRow(card) {
    const el = document.createElement("div");
    el.className = "od-listcard od-drawn";
    el.dataset.scope = "global";

    const play = document.createElement("button");
    play.type = "button";
    play.className = "od-listcard-play";
    play.appendChild(tokens.toFragment(card.tokens || [], { preview: true }));
    play.addEventListener("click", (event) => playCard(card, { send: event.shiftKey }));

    el.appendChild(play);
    trackPeek(el, card);
    return el;
  }

  // No tools, no dragging, nothing to reorder — there is nothing here to
  // rearrange yet. Pressing it puts the reaction in the editor, which is also
  // how keeping it works: the bar is already offering the two save targets by
  // then, and saving puts it in the pool and in this deck together.
  function buildDrawn(card, { size }) {
    const el = document.createElement("div");
    el.className = "od-card od-drawn";
    el.dataset.size = size;
    el.dataset.scope = "global";

    // A render for some other reason builds this element again, and a new
    // element replays its animations — so it slid in from the left every time
    // anything at all happened. It slides in only when it is genuinely a new
    // card; otherwise it picks the glow up mid-breath, where the one before it
    // would have been.
    if (card.key !== drawnShown) {
      drawnShown = card.key;
      el.dataset.fresh = "true";
    } else {
      el.style.animationDelay = `-${Date.now() % BREATH_MS}ms`;
    }

    const play = document.createElement("button");
    play.type = "button";
    play.className = "od-card-play";
    play.addEventListener("click", (event) => playCard(card, { send: event.shiftKey }));
    play.appendChild(cardBody(card, size).body);
    el.appendChild(play);

    // Keeping it cannot go through playing it. With auto-send on, pressing the
    // card sends it at once, and the save targets never get a chance to
    // appear — so the way to keep a drawn card was closed for exactly the
    // people who had turned that setting on.
    const tools = document.createElement("div");
    tools.className = "od-card-tools";

    const plus = iconButton("plus", "この札を保存（⇧＋クリックで入力欄へ）", (event) => {
      event.stopPropagation();
      if (event.shiftKey) return stageForSaving(card);
      // The choice belongs on the card, not up on the bar.
      tools.replaceChildren(...targetButtons(card.tokens || [], {
        onPick: (target) => saveTokens(card.tokens || [], target)
      }));
    }, () => cardPeek(card));

    tools.appendChild(plus);
    el.appendChild(tools);

    trackPeek(el, card);
    return el;
  }

  // Into the editor and no further, whatever auto-send is set to.
  function stageForSaving(card) {
    const input = getChatInput();
    if (!input) return showToast("入力欄が見つかりません");
    tokens.writeToInput(input, card.tokens || []);
  }

  /* ---------- notices ---------- */

  let noticeTimer = null;

  // A floating toast covers the chat, whichever way it is anchored — the panel
  // sits at the very bottom, so anything above it lands on the messages. The
  // bar already swaps between states, so a notice is just one more state.
  function showToast(message, { actionLabel, onAction } = {}) {
    clearTimeout(noticeTimer);
    notice = { message, actionLabel, onAction };
    refreshBar();
    noticeTimer = setTimeout(clearNotice, 6000);
  }

  function clearNotice() {
    clearTimeout(noticeTimer);
    if (!notice) return;
    notice = null;
    refreshBar();
  }

  /* ---------- playing a card ---------- */

  let sending = false;

  async function playCard(card, { send }) {
    if (card.locked) {
      return showToast("他チャンネルのメン限スタンプです");
    }
    // A click appends to the editor at once, but the send waits a beat for
    // YouTube to enable its button. A second click in that gap appended to the
    // same editor, and the first timer then sent both cards as one comment.
    if (sending) return;

    const input = getChatInput();
    if (!input) return showToast("入力欄が見つかりません");

    const willSend = send || settingsCache.autoSend;
    sending = willSend;

    tokens.writeToInput(input, card.tokens || []);
    if (willSend) submitChat(() => { sending = false; });

    // A drawn card is not in the pool, so there is no use count to raise.
    if (!card.drawn) await store.apply("markUsed", { id: card.id });
  }

  // The renderer enables the button a beat after the input event lands.
  function submitChat(done) {
    const started = performance.now();
    const attempt = () => {
      const button = getSendButton();
      if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
        button.click();
        return done?.();
      }
      if (performance.now() - started < 800) return setTimeout(attempt, 50);
      log("Send button never became available.");
      journal.record({ kind: "error", what: "no-send-button" });
      done?.();
    };
    setTimeout(attempt, 80);
  }

  /* ---------- taking a comment from the chat ---------- */

  // Only the kinds that carry a comment anyone could say themselves. A
  // membership or gift announcement has no `#message` worth keeping.
  const COMMENT_ROWS =
    "yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer";

  // The button rides in the same right-hand gutter YouTube keeps for its own
  // per-message menu, just inside it. That gutter is absolutely positioned, so
  // nothing reflows and the comment itself is never covered while idle — the
  // button exists only on the row under the pointer, which is exactly how
  // YouTube's own ⋮ behaves.
  function grabButton() {
    if (grabEl) return grabEl;
    grabEl = document.createElement("div");
    grabEl.className = "od-grab";
    return grabEl;
  }

  // Back to the ＋, whichever row it is about to sit in.
  function resetGrab() {
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "od-grab-plus";
    plus.textContent = "＋";
    const label = "このコメントを札にする（⇧＋クリックで入力欄へ）";
    plus.setAttribute("aria-label", label);
    plus.title = label;
    plus.addEventListener("click", (event) => {
      // The row underneath opens YouTube's own menus on click.
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) return takeComment(grabRow);
      askWhere(grabRow);
    });
    grabButton().replaceChildren(plus);
  }

  function offerGrab(row) {
    if (row === grabRow && grabEl?.isConnected) return;
    grabRow = row;
    if (!row) return grabEl?.remove();
    resetGrab();
    row.appendChild(grabEl);
  }

  // The two save targets, offered where the press happened. They used to be
  // offered only on the bar at the top of the panel, which is a long way from
  // a ＋ down in the chat — the same mistake as a warning at the foot of a
  // settings page.
  function targetButtons(captured, { onPick }) {
    const forced = tokens.requiredChannels(captured).length > 0;
    const hue = barContext?.hue;
    const here = barContext?.channel?.name || "このチャンネル";

    const make = (target, scope, label) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "od-target";
      button.dataset.scope = scope;
      if (scope === "channel" && hue != null) button.style.setProperty("--od-scope-hue", hue);
      button.setAttribute("aria-label", label);
      button.title = label;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onPick(target);
      });
      return button;
    };

    const channel = make("channel", "channel", `${here}専用として保存`);
    const global = make("global", "global", "通用の札として保存");

    if (forced) {
      global.disabled = true;
      global.title = "メン限スタンプなので、このチャンネル専用にしかできません";
    }
    if (!barContext?.channel?.id) {
      // There is no channel to be tied to. Offering it anyway would save a
      // universal card under a button that said otherwise.
      channel.disabled = true;
      channel.title = "チャンネルが分かりません";
    }
    return [channel, global];
  }

  function readComment(row) {
    const message = row?.querySelector("#message");
    if (!message) return null;

    const captured = tokens.collectTokens(message);
    if (!tokens.hasSubstance(captured)) {
      showToast("入れられる中身がありません");
      return null;
    }
    // Emoji from two channels can be sent nowhere, so such a card could never
    // exist. Say so here rather than at the save target.
    if (tokens.requiredChannels(captured).length > 1) {
      showToast("複数チャンネルのメン限が混ざっています");
      return null;
    }
    return captured;
  }

  function askWhere(row) {
    const captured = readComment(row);
    if (!captured) return;
    grabButton().replaceChildren(...targetButtons(captured, {
      onPick: (target) => {
        resetGrab();
        saveTokens(captured, target);
      }
    }));
  }

  // The other thing someone might want a comment for: to say it too. Shift
  // takes it to the editor instead of saving it, which is the same shift that
  // sends a card rather than typing it.
  function takeComment(row) {
    const captured = readComment(row);
    if (!captured) return;

    const input = getChatInput();
    if (!input) return showToast("入力欄が見つかりません");
    tokens.writeToInput(input, captured);
  }

  /* ---------- saving and editing ---------- */

  async function saveCurrentInput(target) {
    const input = getChatInput();
    if (!input) return;

    const captured = tokens.collectTokens(input);
    if (!tokens.hasSubstance(captured)) {
      return showToast("保存する内容を入力してください");
    }

    return saveTokens(captured, target, {
      clear: () => clearInput(input),
      kept: "入力はそのままです",
      editing: true
    });
  }

  // Saving is the same wherever the content came from — the editor, a comment
  // in the chat, or a card the chat held out. Only the tidying up differs, and
  // only the editor can be in the middle of re-recording a card.
  async function saveTokens(captured, target, { clear = () => {}, kept = "", editing = false } = {}) {
    const data = await store.read();
    if (!data) return shutdown();
    const channel = reconcileChannel(getChannel(), captured);

    if (editing && editingId) {
      const id = editingId;
      editingId = null;
      if (data.cards.some((c) => c.id === id)) {
        // Nothing is cleared until the write is known to have landed.
        if (!(await store.apply("editCard", { id, tokens: captured })).ok) {
          return showToast(`保存できませんでした。${kept}`);
        }
        clear();
        showToast("札を更新しました");
        return render();
      }
    }

    // Scope is settled first: the duplicate shortcut used to run before it and
    // silently ignore which kind you asked for.
    const scope = target === "channel" && channel?.id ? channel.id : store.GLOBAL;

    const duplicate = findDuplicate(data, channel?.id, captured);
    if (duplicate?.exact) {
      const existingScope = store.scopeOf(duplicate.card);
      clear();

      if (existingScope !== scope) {
        // Re-scoping it would change what every other deck holding it can do,
        // so say what it already is instead of quietly deciding.
        showToast(existingScope === store.GLOBAL
          ? "同じ札が通用の札としてもうあります"
          : "同じ札がこのチャンネル専用としてもうあります");
        if (channel?.id) await store.apply("addToDeck", { channelId: channel.id, cardId: duplicate.card.id });
        render();
        return flashCard(duplicate.card.id);
      }

      if (duplicate.inDeck || !channel?.id) {
        showToast(duplicate.inDeck ? "同じ札がこのデッキにもうあります" : "同じ札がプールにもうあります");
        return flashCard(duplicate.card.id);
      }

      const drawn = await store.apply("addToDeck", {
        channelId: channel.id, cardId: duplicate.card.id
      });
      if (!drawn.ok) return showToast("保存できませんでした");
      showToast("プールにあった同じ札をデッキに入れました");
      render();
      return flashCard(duplicate.card.id);
    }

    const card = {
      id: crypto.randomUUID(),
      tokens: captured,
      createdAt: Date.now(),
      uses: 0,
      heat: 0,
      lastUsedAt: 0
    };

    // Saving puts the card in the pool and, when we know the channel, straight
    // into its deck — one action, not two.
    // The worker settles duplicates: two fast saves can both decide there is
    // none, and only it sees settled state.
    // Saving here always puts the card in this channel's deck; the kind was
    // settled above.
    const added = await store.apply("addCard", { card, channelId: channel?.id, scope });
    if (!added.ok) {
      // Quota, or the context went away. Keep what was typed.
      return showToast(`保存できませんでした。${kept}`);
    }
    if (added.value?.duplicate) {
      clear();
      // It says what it is and whether the deck actually took it, so this can
      // stop claiming a success that did not happen.
      const { scope: had, added: joined } = added.value;
      showToast(had !== scope
        ? (had === store.GLOBAL ? "同じ札が通用の札としてもうありました" : "同じ札がこのチャンネル専用としてもうありました")
        : joined ? "プールにあった同じ札をデッキに入れました" : "同じ札がこのデッキにもうあります");
      render();
      return flashCard(added.value.id);
    }
    if (channel?.id) {
      await store.apply("setChannel", { channelId: channel.id, name: channel.name });
    }

    clear();

    const saved = !channel?.id
      ? "プールに保存しました"
      : scope === store.GLOBAL
        ? "通用の札として保存しました"
        : "このチャンネル専用の札として保存しました";
    if (duplicate) {
      // Same reaction, different wording — probably redundant, but only the
      // user can say for sure, so keep it and make undoing it one click.
      showToast(`${saved}（似た札がすでにあります）`, {
        actionLabel: "取り消す",
        onAction: () => deleteCard(card, { silent: true })
      });
    } else {
      showToast(saved);
    }
    render();
  }

  function clearInput(input) {
    input.innerHTML = "";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  }

  // A member emoji carries its home channel in its id, and YouTube only serves
  // it on that channel. So when the emoji disagrees with what we scraped off
  // the page, the emoji is right — this alone would have stopped the card that
  // got filed under YouTube Music.
  function reconcileChannel(channel, captured) {
    const required = tokens.requiredChannels(captured);
    if (required.length !== 1 || required[0] === channel?.id) return channel;

    log("Channel corrected from member emoji:", channel?.id, "->", required[0]);
    journal.record({
      kind: "note", what: "emoji-corrected", from: channel?.id || "none", to: required[0]
    });
    // Drop the scraped name with the scraped id — they came from one element,
    // so a wrong id means the name is not trustworthy either. rememberChannel
    // keeps whatever good name is already stored.
    return { id: required[0], name: "" };
  }

  // Check the whole pool, not just this deck: an identical card saved on
  // another channel should be drawn from the pool rather than made again.
  function findDuplicate(data, channelId, captured) {
    const key = tokens.cardKey(captured);
    const sig = trending.signature(captured);

    let similar = null;
    for (const card of data.cards) {
      if (tokens.cardKey(card.tokens) === key) {
        return { card, exact: true, inDeck: store.inDeck(data, channelId, card.id) };
      }
      if (!similar && trending.signature(card.tokens || []) === sig) {
        similar = { card, exact: false };
      }
    }
    return similar;
  }

  function flashCard(id) {
    flashId = id;
    render();
    setTimeout(() => {
      if (flashId !== id) return;
      flashId = null;
      render();
    }, 1600);
  }

  function beginEdit(card) {
    const input = getChatInput();
    if (!input) return;
    editingId = card.id;
    tokens.writeToInput(input, card.tokens || [], { replace: true });
    showToast("直したら「更新」を押してください");
    render();
  }

  async function removeFromDeck(card) {
    const channelId = getChannel()?.id;
    if (!channelId) return;

    const { ok, value } = await store.apply("removeFromDeck", { channelId, cardId: card.id });
    if (!ok || value < 0) return;
    render();

    showToast("デッキから外しました（プールに残っています）", {
      actionLabel: "元に戻す",
      onAction: async () => {
        await store.apply("insertIntoDeck", { channelId, cardId: card.id, at: value });
        render();
      }
    });
  }

  async function addToDeck(card) {
    const channelId = getChannel()?.id;
    if (!channelId) return showToast("チャンネルが分かりません");
    const { ok } = await store.apply("addToDeck", { channelId, cardId: card.id });
    if (ok) render();
  }

  /* ---------- arranging by hand ---------- */

  // Only in manual mode: every other order is computed, so a drag would be
  // undone by the next render.
  const canArrange = () => settingsCache.sortBy === "manual";

  function wireCardDrag(el, card) {
    el.draggable = true;
    el.dataset.arrangeable = "true";

    el.addEventListener("dragstart", (event) => {
      drag = card;
      el.dataset.dragging = "true";
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", card.id);
    });

    el.addEventListener("dragend", () => {
      drag = null;
      delete el.dataset.dragging;
      for (const node of rootEl?.querySelectorAll("[data-drop]") || []) delete node.dataset.drop;
    });

    el.addEventListener("dragover", (event) => {
      if (!drag || drag.id === card.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const box = el.getBoundingClientRect();
      el.dataset.drop = event.clientX < box.left + box.width / 2 ? "before" : "after";
    });

    el.addEventListener("dragleave", () => delete el.dataset.drop);

    el.addEventListener("drop", (event) => {
      if (!drag) return;
      event.preventDefault();
      const side = el.dataset.drop || "before";
      delete el.dataset.drop;
      arrange(drag, card, side);
    });
  }

  async function arrange(moved, target, side) {
    const channelId = getChannel()?.id;
    const { ok, value } = await store.apply("reorderDeck", {
      channelId, movedId: moved.id, targetId: target.id, side
    });
    if (ok && value) render();
  }

  function buildTools(card) {
    const tools = document.createElement("div");
    tools.className = "od-card-tools";
    const back = () => cardPeek(card);
    // Only reversible things here. A card taken out of the deck lands in this
    // channel's pool, so it is always one drag from coming back.
    tools.append(
      iconButton("eject", "このデッキから外す", (event) => {
        event.stopPropagation();
        removeFromDeck(card);
      }, back),
      iconButton("edit", "この札を編集", (event) => { event.stopPropagation(); beginEdit(card); }, back)
    );
    return tools;
  }

  async function deleteCard(card, { silent = false } = {}) {
    // Splicing the pool alone would leave the id dangling in every deck that
    // held it, which an export then cannot import.
    const { ok, value: snapshot } = await store.apply("deleteCard", { id: card.id });
    if (!ok || !snapshot) return;
    render();

    if (silent) return; // the caller already explained what happened

    // Undo instead of a blocking confirm() — the whole page freezes on those.
    showToast("札を削除しました", {
      actionLabel: "元に戻す",
      onAction: async () => {
        await store.apply("restoreCard", { snapshot });
        render();
      }
    });
  }

  /* ---------- rendering ---------- */

  // What the bar should say while this card is under the pointer. A native
  // tooltip would float over the chat; the bar is space we already occupy.
  function cardPeek(card) {
    if (card.locked) {
      return { text: "別チャンネルのメン限スタンプ — この配信では送れません", warning: true };
    }
    const text = tokens.toPlainText(card.tokens || []).trim();
    const stamps = (card.tokens || []).filter((t) => t.type === "youtubeEmoji").length;
    const body = text || (stamps ? `スタンプ ${stamps}個` : "");

    if (card.drawn) {
      // Messages, not people: one person can send six. Saying 人 was a claim
      // the count does not support.
      return { text: `${body}  ・ いま立て続けに${card.hits}回。押すと入力欄へ、＋で保存` };
    }
    return { text: card.hits > 0 ? `${body}  ・ いまチャットで${card.hits}回` : body };
  }

  function trackPeek(el, card) {
    el.addEventListener("pointerenter", () => setPeek(cardPeek(card), el));
    el.addEventListener("pointerleave", () => setPeek(null));
  }

  // Native tooltips float over the chat wherever they are attached, so nothing
  // in this UI gets a `title`. The name goes to assistive tech, and the same
  // text shows in our own bar on hover.
  function describe(el, text, options = {}) {
    el.setAttribute("aria-label", text);
    // pointerenter/leave do not bubble, so entering a control inside a card
    // leaves the card's own peek alone; restore() puts it back on the way out.
    el.addEventListener("pointerenter", () =>
      setPeek({ text, warning: options.warning }, el));
    el.addEventListener("pointerleave", () =>
      setPeek(options.restore ? options.restore() : null, el.parentElement));
    return el;
  }

  function cardBody(card, size) {
    const body = document.createElement("div");
    body.className = "od-card-body";
    body.appendChild(tokens.toFragment(card.tokens || [], { preview: true }));

    // Long text shrinks a step and fades out rather than overflowing.
    const length = tokens.toPlainText(card.tokens || []).trim().length;
    const budget = size === "small" ? 6 : size === "medium" ? 9 : 12;
    if (length > budget * 3) body.dataset.length = "long";
    else if (length > budget) body.dataset.length = "medium";
    return { body, truncated: length > budget * 3 };
  }

  function buildCard(card, { size, hue }) {
    const el = document.createElement("div");
    el.className = "od-card";
    el.dataset.size = size;
    el.dataset.scope = card.bound ? "channel" : "global";
    if (card.bound && hue != null) el.style.setProperty("--od-scope-hue", hue);
    if (card.id === editingId) el.dataset.editing = "true";
    if (card.locked) el.dataset.locked = "true";
    if (card.hits > 0) el.dataset.trending = "true";
    if (card.id === flashId) el.dataset.flash = "true";

    const { body } = cardBody(card, size);

    const play = document.createElement("button");
    play.type = "button";
    play.className = "od-card-play";
    play.addEventListener("click", (event) =>
      poolOpen ? addToDeck(card) : playCard(card, { send: event.shiftKey }));
    play.appendChild(body);
    el.appendChild(play);
    trackPeek(el, card);
    if (canArrange() && !poolOpen) wireCardDrag(el, card);

    if (!poolOpen) el.appendChild(buildTools(card));
    return el;
  }

  const ICONS = {
    chevron: "M6 9l6 6 6-6",
    close: "M6 6l12 12M18 6L6 18",
    edit: "M4 20h4L19 9l-4-4L4 16v4z",
    delete: "M5 7h14M6 7l1 13h10l1-13M9 7V4h6v3",
    eject: "M12 4l7 8H5l7-8M5 19h14",
    deck: null,
    plus: "M12 5v14M5 12h14"
  };

  function iconButton(name, label, onClick, restore) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "od-icon-button";
    describe(button, label, { restore });
    button.appendChild(svgIcon(name));
    button.addEventListener("click", onClick);
    return button;
  }

  function svgIcon(name) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");

    if (name === "deck") {
      for (const x of [3, 14]) {
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", x);
        rect.setAttribute("y", "4");
        rect.setAttribute("width", "7");
        rect.setAttribute("height", "16");
        rect.setAttribute("rx", "1.5");
        svg.appendChild(rect);
      }
      return svg;
    }

    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", ICONS[name]);
    svg.appendChild(path);
    return svg;
  }

  const DRAWN_GAP = 14; // wide enough that it never reads as part of the hand

  // Everything the panel draws from. Deliberately coarse about the chat: an
  // exact hit count would change every few seconds and defeat the point, so
  // only whether a card is trending at all counts as a change.
  function panelSignature(data, channel, hue, shown, drawn) {
    const s = data.settings;
    return [
      s.mode, s.cardSize, s.rows, s.sortBy, s.suggest ? "draw" : "",
      channel?.id || "", hue ?? "",
      poolOpen ? "pool" : "deck", expanded ? "more" : "",
      editingId || "", flashId || "", inputHasContent ? "typing" : "",
      drawn?.key || "",
      shown.map((card) => (card.hits ? `${card.id}*` : card.id)).join(",")
    ].join("|");
  }

  function renderHand(container, deck, settings, hue, drawn) {
    const width = container.clientWidth || 400;
    const size = settings.cardSize;
    const cardWidth = layout.CARD_SIZE[size] || layout.CARD_SIZE.small;
    // Leave room for a scrollbar: when the deck overflows, the gutter eats
    // into the row and the last card would push a horizontal bar into view.
    const avail = width - PANEL_PADDING - SCROLLBAR_GUTTER;
    const perRow = layout.cardsPerRow(avail, cardWidth);
    const visibleRows = Math.min(MAX_ROWS_CAP, Math.max(1, settings.rows));

    // Lay out every card. The row setting caps how many rows are *shown*, not
    // how many exist — cards past the cap used to be unreachable.
    const allRows = Math.max(1, Math.ceil(deck.length / perRow));
    const { rows } = layout.splitRows(deck.length, perRow, allRows);
    // A deck with nothing in it still needs a row to be handed a card into.
    if (drawn && !rows.length) rows.push(0);

    const hand = document.createElement("div");
    hand.className = "od-hand";
    hand.style.setProperty("--od-visible-rows", visibleRows);
    if (expanded) hand.dataset.expanded = "true";
    // Only cap and scroll when there is genuinely more than fits; otherwise a
    // hovered card would be clipped by an overflow container it never needed.
    else if (rows.length > visibleRows) hand.dataset.scrollable = "true";

    let cursor = 0;
    let firstRow = null;
    for (const rowLength of rows) {
      const row = document.createElement("div");
      row.className = "od-row";
      firstRow ||= row;

      // The drawn card gets a place of its own at the left edge, not the left
      // end of the hand: with an empty deck the hand has no left end, and the
      // card came out in the middle of the panel. The hand then fans in what
      // is left, centred there.
      const wanted = drawn && row === firstRow;
      const handWidth = wanted ? layout.besideDrawn(avail, cardWidth, DRAWN_GAP) : avail;
      const takes = wanted && layout.fitsSqueezed(handWidth, cardWidth, rowLength);
      const overlap = takes
        ? layout.overlapFor(handWidth, cardWidth, rowLength)
        : layout.OVERLAP;

      if (takes) {
        const slot = document.createElement("div");
        slot.className = "od-drawn-slot";
        slot.style.setProperty("--od-drawn-gap", `${DRAWN_GAP}px`);
        slot.appendChild(buildDrawn(drawn, { size }));
        row.appendChild(slot);
      }

      const fan = document.createElement("div");
      fan.className = "od-fan";
      for (let i = 0; i < rowLength; i++) {
        const card = deck[cursor++];
        const el = buildCard(card, { size, hue });
        const { rot, lift } = layout.tilt(i, rowLength);
        el.style.setProperty("--od-rot", `${rot.toFixed(2)}deg`);
        el.style.setProperty("--od-lift", `${lift.toFixed(2)}px`);
        // Left-to-right is most-used first, so the left card is the one that
        // must not be covered: the stack runs the other way to the DOM.
        el.style.setProperty("--od-depth", rowLength - i);
        if (i > 0) el.style.setProperty("--od-overlap", `-${overlap.toFixed(1)}px`);
        fan.appendChild(el);
      }
      row.appendChild(fan);
      hand.appendChild(row);
    }

    container.appendChild(hand);
    return Math.max(0, deck.length - perRow * visibleRows);
  }

  function renderList(container, deck, settings, hue, drawn) {
    const list = document.createElement("div");
    list.className = "od-list";
    if (expanded) list.dataset.expanded = "true";
    else if (deck.length > LIST_VISIBLE) list.dataset.scrollable = "true";

    // A row rather than a card: the list has no fan to squeeze, so the drawn
    // reaction simply sits at the top in the same dashed hand as the pool.
    if (drawn) list.appendChild(buildDrawnRow(drawn));

    for (const card of deck) {
      const el = document.createElement("div");
      el.className = "od-listcard";
      el.dataset.scope = card.bound ? "channel" : "global";
      if (card.bound && hue != null) el.style.setProperty("--od-scope-hue", hue);
      if (card.id === editingId) el.dataset.editing = "true";
      if (card.locked) el.dataset.locked = "true";
      if (card.hits > 0) el.dataset.trending = "true";
      if (card.id === flashId) el.dataset.flash = "true";

      const play = document.createElement("button");
      play.type = "button";
      play.className = "od-listcard-play";
      play.appendChild(tokens.toFragment(card.tokens || [], { preview: true }));
      play.addEventListener("click", (event) =>
        poolOpen ? addToDeck(card) : playCard(card, { send: event.shiftKey }));

      el.appendChild(play);
      if (!poolOpen) el.appendChild(buildTools(card));
      trackPeek(el, card);
      if (canArrange() && !poolOpen) wireCardDrag(el, card);
      list.appendChild(el);
    }

    container.appendChild(list);
    return Math.max(0, deck.length - LIST_VISIBLE);
  }

  // The bar has two states. Idle it identifies the deck; the moment there is
  // something worth keeping it becomes the destination picker, so choosing
  // where a card goes is one click on a labelled button — never a guess
  // followed by a correction.
  function buildBar(channel, hue, count) {
    const bar = document.createElement("div");
    bar.className = "od-bar";
    // Everything that would otherwise float over the chat lives here instead.
    if (notice) bar.append(noticeRow(notice));
    else if (peek) bar.append(peekReadout(peek));
    else if (poolOpen) bar.append(poolBar(count));
    else bar.append(inputHasContent ? saveTargets(channel, hue) : deckIdentity(channel, hue, count));

    if (poolOpen) {
      bar.appendChild(buildAction("close", "閉じる", "プールを閉じる", () => {
        poolOpen = false;
        render();
      }));
    } else {
      bar.appendChild(buildAction("deck", "編成", "デッキ編成をひらく", () => openOptions()));
    }
    return bar;
  }

  function noticeRow({ message, actionLabel, onAction }) {
    const row = document.createElement("div");
    row.className = "od-notice";

    const text = document.createElement("span");
    text.className = "od-notice-text";
    text.textContent = message;
    row.appendChild(text);

    if (actionLabel) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "od-notice-action";
      action.textContent = actionLabel;
      action.addEventListener("click", () => {
        const run = onAction;
        clearNotice();
        run?.();
      });
      row.appendChild(action);
    }
    return row;
  }

  function peekReadout({ text, warning }) {
    const readout = document.createElement("div");
    readout.className = "od-peek";
    if (warning) readout.dataset.warning = "true";
    readout.textContent = text;
    return readout;
  }

  function setPeek(next, owner = null) {
    const changed = (peek?.text || null) !== (next?.text || null);
    peek = next;
    peekOwner = next ? owner : null;
    if (changed && !notice) refreshBar();
  }

  // pointerleave never arrives for an element that was removed, so a card
  // ejected while the pointer was on its button left its description in the
  // bar for good — and with the bar stuck on a description, it could never
  // become the save targets, so nothing could be added either.
  function dropStalePeek() {
    if (!peekOwner || peekOwner.isConnected) return;
    peek = null;
    peekOwner = null;
  }

  function poolBar(poolCount) {
    const group = document.createElement("div");
    group.className = "od-bar-identity";

    const label = document.createElement("span");
    label.className = "od-save-label";
    label.textContent = "プールから追加";

    const total = document.createElement("span");
    total.className = "od-count";
    total.textContent = `${poolCount}枚`;

    group.append(label, total);
    return group;
  }

  function deckIdentity(channel, hue, count) {
    const group = document.createElement("div");
    group.className = "od-bar-identity";

    if (channel?.id) {
      const dot = document.createElement("span");
      dot.className = "od-dot";
      dot.style.setProperty("--od-scope-hue", hue);
      const name = document.createElement("span");
      name.className = "od-channel";
      name.textContent = channel.name || "このチャンネル";
      const plus = document.createElement("span");
      plus.className = "od-plus-sign";
      plus.textContent = "＋";
      group.append(dot, name, plus);
    }

    const commonDot = document.createElement("span");
    commonDot.className = "od-dot od-dot-common";
    const commonLabel = document.createElement("span");
    commonLabel.className = "od-common";
    commonLabel.textContent = "共通";

    const total = document.createElement("span");
    total.className = "od-count";
    total.textContent = `${count}枚`;

    group.append(commonDot, commonLabel, total);
    return group;
  }

  function saveTargets(channel, hue) {
    const group = document.createElement("div");
    group.className = "od-bar-save";

    if (editingId) {
      const label = document.createElement("span");
      label.className = "od-save-label";
      label.textContent = "編集中";

      const update = buildAction("plus", "更新", "編集中の札を更新", () => saveCurrentInput());
      update.dataset.primary = "true";

      const cancel = buildAction("close", "やめる", "編集をやめる", () => {
        editingId = null;
        const input = getChatInput();
        if (input) clearInput(input);
        render();
      });

      group.append(label, update, cancel);
      return group;
    }

    // The choice is what kind of card this is, not whether it joins the deck
    // — you are saving it here because you want it here. A card carrying
    // member emoji has no choice: it can only ever be this channel's.
    if (!channel?.id) {
      const only = buildAction("plus", "プールに保存",
        "チャンネルが分からないので、通用の札としてプールに置きます", () => saveCurrentInput("global"));
      only.dataset.primary = "true";
      group.appendChild(only);
      return group;
    }

    const forced = tokens.requiredChannels(currentTokens).length > 0;

    const toChannel = buildAction("plus", channel.name || "このチャンネル専用",
      forced
        ? "メン限スタンプ入りなので、このチャンネル専用にしかできません"
        : "このチャンネルのデッキだけに出る札にします",
      () => saveCurrentInput("channel"));
    toChannel.dataset.primary = "true";
    toChannel.classList.add("od-save-channel");
    if (hue != null) toChannel.style.setProperty("--od-scope-hue", hue);

    const toGlobal = buildAction("plus", "通用",
      forced
        ? "メン限スタンプ入りの札は通用にできません"
        : "どのチャンネルのデッキにも入れられる札にします",
      () => saveCurrentInput("global"));
    if (forced) toGlobal.disabled = true;

    group.append(toChannel, toGlobal);
    return group;
  }




  function openOptions() {
    try {
      chrome.runtime.sendMessage({ type: "openOptions" });
    } catch (_) {
      shutdown();
    }
  }

  function buildAction(icon, text, title, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "od-text-button";
    button.setAttribute("aria-label", title);
    button.appendChild(svgIcon(icon));
    const label = document.createElement("span");
    label.textContent = text;
    button.appendChild(label);
    button.addEventListener("click", onClick);
    return button;
  }

  // Cheap enough to run on every keystroke: the editor holds one comment.
  function readInput(input) {
    currentTokens = input ? tokens.collectTokens(input) : [];
    return tokens.hasSubstance(currentTokens);
  }

  function watchInput(input) {
    if (watchedInput === input) return;
    watchedInput = input;

    function onEditorChanged() {
      const filled = readInput(input);

      // Emptying the editor means you are no longer editing anything. Without
      // this the flag survives with no visible way to clear it.
      if (!filled && editingId) {
        editingId = null;
        inputHasContent = false;
        return render();
      }

      if (filled === inputHasContent) return; // only the transition moves the bar
      inputHasContent = filled;
      refreshBar();
    }

    input.addEventListener("input", onEditorChanged);

    // Typing fires "input"; picking an emoji does not. YouTube's picker writes
    // the <img> into the editor directly, so watching the DOM is the only way
    // to notice a comment that is nothing but stamps.
    inputObserver?.disconnect();
    inputObserver = new MutationObserver(onEditorChanged);
    inputObserver.observe(input, { childList: true, subtree: true, characterData: true });

    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !editingId) return;
      event.stopPropagation();
      editingId = null;
      clearInput(input);
      render();
      showToast("編集をやめました");
    });
  }

  function refreshBar() {
    if (!barEl?.isConnected || !barContext) return;
    const next = buildBar(barContext.channel, barContext.hue, barContext.count);
    barEl.replaceWith(next);
    barEl = next;
  }

  function mount(input) {
    const panel =
      input.closest("yt-live-chat-message-input-renderer") ||
      document.querySelector("yt-live-chat-message-input-renderer");
    const host = document.querySelector("#input-panel") || panel || input.parentElement;
    if (!host) return null;

    const el = document.createElement("div");
    el.id = "oshideck-root";
    host.appendChild(el);
    lastWidth = 0;

    // Cards must not shuffle out from under the pointer mid-stream. Hold any
    // reorder until the pointer leaves; deliberate actions still render.
    el.addEventListener("pointerenter", () => { frozen = true; });
    el.addEventListener("pointerleave", () => {
      frozen = false;
      setPeek(null); // the pointer left the panel; nothing is being described
      if (pendingRender) { pendingRender = false; scheduleRender(); }
    });

    // The fan re-lays out on width, so watch the panel rather than the window:
    // the popped-out chat and the sidebar are different widths. Only width
    // matters — reacting to height would loop, since rendering changes it.
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (width === lastWidth) return;
      lastWidth = width;
      scheduleRender();
    });
    resizeObserver.observe(el);

    return el;
  }

  async function render() {
    if (stopped) return;
    if (!store.alive()) return shutdown();

    watchInputPanel(); // so the panel opening and closing both reach us

    const input = getChatInput();
    if (!input) {
      // The chat input is there but collapsed: YouTube is showing Super Chat
      // over it. Staying put would draw the deck on top of that panel.
      if (rootEl && !rootEl.hidden) {
        rootEl.hidden = true;
        painted = null;
        journal.record({ kind: "note", what: "stepped-aside", reason: "input-not-rendered" });
      }
      return;
    }
    currentInput = input;

    if (!rootEl || !rootEl.isConnected) {
      rootEl = mount(input);
      painted = null;
      if (!rootEl) {
        journal.record({ kind: "error", what: "no-mount-point" });
        return log("Chat input found, but no place to mount.");
      }
      log("Mounted.");
    }
    rootEl.hidden = false;

    const data = await store.read();
    if (!data) return shutdown();
    settingsCache = data.settings;
    watcher.start(); // no-op once attached; retries while chat is still loading

    const channel = getChannel();
    const video = currentVideo();
    if (!channel) retryUnresolved(video);

    if (channel) {
      journal.record({ kind: "channel", video, id: channel.id, name: channel.name, via: channel.via });
    } else if (video) {
      // Without a video there is nothing to explain: a popped-out chat window
      // has no owner to find, and saying so every render would bury the log.
      journal.record({ kind: "unresolved", video, ...describeSources() });
    }
    const hue = channel?.id
      ? data.channelMeta[channel.id]?.hue ?? store.defaultHue(channel.id)
      : null;
    const deck = buildDeck(data, channel?.id);

    watchInput(input);
    inputHasContent = readInput(input);

    const pool = channel?.id
      ? markLocked(store.poolFor(data, channel.id).map((card) => ({ ...card })), channel.id)
      : [];

    keepChatPinned(() => {
      rootEl.replaceChildren();
      // Everything that was hovered is gone now; whatever it was describing
      // must go with it.
      dropStalePeek();
      rootEl.dataset.mode = data.settings.mode;
      rootEl.dataset.pool = String(poolOpen);

      const shown = poolOpen ? pool : deck;
      // Only alongside your own deck. The pool is a place to choose from, not
      // somewhere to be handed things.
      const drawn = poolOpen ? null : drawFromChat(deck);

      // Chat-driven mode renders every few seconds whether or not anything it
      // shows has changed, and rebuilding is not free: the elements are new, so
      // the drawn card replayed its entry animation and looked like it was
      // jumping. Nothing to redraw, nothing redrawn.
      const next = panelSignature(data, channel, hue, shown, drawn);
      if (next === painted && rootEl.firstChild) return;
      painted = next;

      barContext = { channel, hue, count: shown.length };
      barEl = buildBar(channel, hue, shown.length);
      rootEl.appendChild(barEl);

      if (!shown.length && !drawn) {
        const empty = document.createElement("div");
        empty.className = "od-empty";
        empty.textContent = poolOpen
          ? "プールに追加できる札がありません"
          : "コメントを入力して保存すると札になります";
        rootEl.appendChild(empty);
        if (!poolOpen) {
          appendPresetOffer(rootEl, channel);
          appendPoolToggle(pool.length);
        }
        return;
      }

      const hidden =
        data.settings.mode === "list"
          ? renderList(rootEl, shown, data.settings, hue, drawn)
          : renderHand(rootEl, shown, data.settings, hue, drawn);

      if (hidden > 0 || expanded) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "od-more";
        more.dataset.expanded = String(expanded);
        more.setAttribute("aria-label", expanded ? "たたむ" : "残りの札を出す");
        more.append(svgIcon("chevron"));

        const label = document.createElement("span");
        label.textContent = expanded ? "たたむ" : `あと${hidden}枚`;
        more.appendChild(label);

        more.addEventListener("click", () => { expanded = !expanded; render(); });
        rootEl.appendChild(more);
      }

      if (!poolOpen) appendPoolToggle(pool.length);
    });
  }

  // Nothing joins a deck on its own, so there has to be a way in from here.
  function appendPoolToggle(poolCount) {
    if (!poolCount) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "od-more";
    button.append(svgIcon("plus"));
    const label = document.createElement("span");
    label.textContent = `プールから追加（${poolCount}枚）`;
    button.appendChild(label);
    button.setAttribute("aria-label", "プールから札を追加する");
    button.addEventListener("click", () => { poolOpen = true; render(); });
    rootEl.appendChild(button);
  }

  // Once the context is gone nothing can be read, written or re-rendered.
  // Tear down rather than throwing on every chat message, and say why the
  // deck vanished — the page has to be reloaded to get it back.
  let stopped = false;

  function shutdown() {
    if (stopped) return;
    stopped = true;

    observer.disconnect();
    resizeObserver?.disconnect();
    inputObserver?.disconnect();
    panelObserver?.disconnect();
    grabEl?.remove();
    watcher.stop();
    clearTimeout(refreshTimer);
    clearTimeout(noticeTimer);

    if (rootEl?.isConnected) {
      rootEl.hidden = false; // the notice below is the whole point of this path
      rootEl.replaceChildren();
      const notice = document.createElement("div");
      notice.className = "od-empty";
      notice.textContent = "OshiDeck を更新しました。ページを再読み込みしてください";
      rootEl.appendChild(notice);
    }
    log("Stopped: extension context invalidated.");
  }

  function scheduleRender() {
    if (stopped) return;
    if (frozen) { pendingRender = true; return; }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(render, 200);
  }

  // The parts of a watch page that carry a channel id can arrive after the
  // chat does, and nothing already watched here would fire again once they
  // do. Bounded, so a page that genuinely has no channel — a popped-out chat
  // window — settles instead of retrying forever.
  let retry = { video: null, left: 0 };

  function retryUnresolved(video) {
    if (!video) return;
    if (retry.video !== video) retry = { video, left: 5 };
    if (retry.left <= 0) return;
    retry.left -= 1;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(render, 600);
  }

  /* ---------- a starting hand ---------- */

  // The bundled presets, asked for once. The worker holds them: they are the
  // extension's own file, and nothing on the page has any business with it.
  let bundledPresets = [];
  let askedForPresets = false;

  function presetsOnHand() {
    if (askedForPresets) return bundledPresets;
    askedForPresets = true;

    try {
      chrome.runtime.sendMessage({ type: "presets" })
        .then((reply) => {
          if (!reply?.ok || !reply.value?.length) return;
          bundledPresets = reply.value;
          scheduleRender(); // they arrived after the panel had already drawn
        })
        .catch(() => {});
    } catch (_) { /* extension reloaded: no starting hand, no harm */ }

    return bundledPresets;
  }

  // Offered only where it means something: a channel whose deck is empty.
  // Never over a deck that already has something in it.
  function appendPresetOffer(container, channel) {
    if (!channel?.id) return;

    for (const preset of presetsOnHand()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "od-more";
      button.textContent = `＋ ${preset.name}（${preset.cards.length}枚）を入れる`;
      button.addEventListener("click", () => usePreset(preset, channel.id));
      container.appendChild(button);
    }
  }

  async function usePreset(preset, channelId) {
    const { ok, value } = await store.apply("loadPreset", {
      channelId,
      cards: presets.cardsFor(preset, channelId)
    });
    if (!ok || !value) return showToast("読み込めませんでした");

    showToast(value.reused
      ? `「${preset.name}」を入れました（うち${value.reused}枚はプールにあったもの）`
      : `「${preset.name}」を入れました`);
    render();
  }

  /* ---------- wiring ---------- */

  // Live chat mutates constantly, so keep the hot path to one cheap lookup.
  const observer = new MutationObserver(() => {
    const input = findChatInput(); // existence only: measuring here costs a layout
    if (input && (input !== currentInput || !rootEl?.isConnected)) scheduleRender();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
        // decks, channelMeta and cards all change independently — a reorder in
      // the builder rewrites only `decks`, and a colour change only
      // `channelMeta`. Watching one key left the panel stale until something
      // unrelated happened to write.
      const watched = [
        store.KEYS.SETTINGS, store.KEYS.CARDS, store.KEYS.DECKS, store.KEYS.CHANNELS
      ];
      if (watched.some((key) => changes[key])) scheduleRender();
    });
  } catch (_) {
    shutdown();
  }

  // Delegated, so a chat that adds a row a second costs nothing: one button
  // moves to whichever comment the pointer is on.
  document.addEventListener("pointerover", (event) => {
    if (stopped || !rootEl || rootEl.hidden) return offerGrab(null);
    const row = event.target instanceof Element ? event.target.closest(COMMENT_ROWS) : null;
    offerGrab(row?.querySelector("#message") ? row : null);
  }, true);

  window.addEventListener("yt-navigate-finish", scheduleRender);
  window.addEventListener("load", scheduleRender);

  log("Loaded.", location.href);
  scheduleRender();
})();
