// OshiDeck — card deck for YouTube Live Chat.
(() => {
  const OD = globalThis.OshiDeck;
  const { i18n, journal, layout, presets, store, tokens, trending } = OD;
  const t = (...args) => i18n.t(...args);

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
  let inputIsPinned = false;  // …and whether what is in it can only be channel-only
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
  let flashKind = "found";
  let drag = null;
  let poolOpen = false;
  // Which half of it is on show: what you have, or what a preset offers.
  let poolTab = "mine";
  let peek = null;
  let peekOwner = null; // the element whose description the bar is showing
  let painted = null;   // what the panel is already showing
  let editingId = null;  // card being re-recorded, if any
  let settingsCache = { ...store.DEFAULT_SETTINGS };
  let frozen = false;    // pointer is over the deck — do not reorder under it
  let pendingRender = false;

  // Always running: even outside trend mode it keeps emoji urls fresh.
  const watcher = trending.createWatcher({
    tuning: () => {
      const draw = store.tuning(settingsCache, "draw");
      return {
        halfLife: store.tuning(settingsCache, "pace"),
        burstMin: draw.min,
        burstShare: draw.share
      };
    },
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
    markLocked(cards, channelId, membership());
    // The stripe had become the deck's colour on every card, which said
    // nothing. It marks scope again: grey works anywhere, coloured is tied to
    // this channel by its member emoji — and that is what makes deleting it
    // feel different.
    for (const card of cards) card.bound = store.scopeOf(card) !== store.GLOBAL;
    return orderDeck(cards, data.settings, channelId);
  }

  // Two answers to "what else can go in this deck", kept apart because they
  // are different things. A card in the pool is one you saved; a card from a
  // preset is one you have never had. Mixed together, the pool showed cards
  // that were not in it.
  //
  // Assembled here rather than inline in render(), where nothing could reach
  // them — dropping the lock, or the partition, changed nothing any test saw.

  // What you have and have not put in this deck.
  function buildPool(data, channelId) {
    if (!channelId) return [];
    return readyToAdd(store.poolFor(data, channelId).map((card) => ({ ...card })), channelId);
  }

  // What this channel's regulars use that you have none of.
  //
  // A preset used to be all-or-nothing and only on an empty deck — ten cards
  // or none, and the moment the deck had one card of its own the offer was
  // gone for good. Nothing about that follows from what a preset is. It is a
  // list of cards, and a card you do not own yet is still one you could put
  // in here.
  function buildOffered(data, channelId) {
    if (!channelId) return [];

    // Anything already in the collection *that can be sent here* is answered
    // for by the other half: it is in this deck or in the pool, and
    // loadPreset would have reused it rather than making a second one.
    //
    // Usable here, not merely held. A card of the same wording tied to
    // another channel cannot be played on this one, so counting it as owned
    // left both halves empty: the pool excludes it because it is not
    // compatible, and the offer excluded it because it existed.
    const held = new Set(
      data.cards
        .filter((card) => store.usableOn(card, channelId))
        .map((card) => tokens.cardKey(card.tokens || []))
    );
    const offered = [];
    for (const preset of presetsOnHand(channelId)) {
      for (const source of preset.cards || []) {
        const key = tokens.cardKey(source.tokens || []);
        if (held.has(key)) continue;
        held.add(key); // two presets can carry the same card
        // The id has to be the same on every render or the panel's signature
        // changes for nothing and it redraws forever; cardsFor hands out a
        // fresh uuid each time it is asked.
        offered.push({ ...presets.cardsFor({ cards: [source] }, channelId)[0],
                       id: `preset:${key}`, offered: source });
      }
    }
    return readyToAdd(offered, channelId);
  }

  // Both halves are looked at the same way: what cannot be sent goes last,
  // and the stripe says scope. Without the second line every card in the
  // pool was drawn grey, including the ones tied to this channel.
  function readyToAdd(cards, channelId) {
    const ready = playableFirst(markLocked(cards, channelId, membership()));
    for (const card of ready) card.bound = store.scopeOf(card) !== store.GLOBAL;
    return ready;
  }

  // Am I a member of the channel running this chat?
  //
  // Measured on the page rather than worked out. My own badge sits in the
  // author chip beside the input, and that chip is the only place that answers
  // for *me*: the message list is full of other people's badges — 57 of them
  // on a stream I am not a member of — so an unscoped query says "member"
  // in any chat that has members at all.
  //
  // Three answers, not two. The chip missing altogether means the page has not
  // said yet, and a wrong lock is worse than a card that fails to send, so
  // that case locks nothing. (`hidden` on the chip is not the answer either:
  // a popped-out chat hides it while the badge is right there.)
  const MY_CHIP = "yt-live-chat-message-input-renderer yt-live-chat-author-chip";

  function membership() {
    const chip = document.querySelector(MY_CHIP);
    if (!chip) return null;
    return !!chip.querySelector("yt-live-chat-author-badge-renderer[type='member']");
  }

  // Why these tokens cannot be sent here, or "" if they can. Two locks that
  // look alike and mean different things: one is about where you are, the
  // other about what you are paying for — and only the second is something
  // the viewer can do anything about, so they must not read the same.
  function whyNotSendable(list, channelId, member) {
    const required = tokens.requiredChannels(list || []);
    if (!required.length) return "";              // nobody's emoji but everyone's
    if (!channelId) return "";                    // no channel: cannot judge ownership
    if (!required.every((id) => id === channelId)) return "elsewhere";
    return member === false ? "membership" : "";  // ours, while the membership lasts
  }

  function markLocked(cards, channelId, member) {
    for (const card of cards) {
      const why = whyNotSendable(card.tokens, channelId, member);
      card.locked = !!why;
      card.lapsed = why === "membership";
    }
    return cards;
  }

  // Locked cards go last, whatever the order says. They stay in the deck — a
  // membership can come back, and dropping the card would lose the place it
  // had — but an unplayable card sitting mid-hand is exactly where the eye
  // looks for the next thing to send.
  const playableFirst = (cards) => [
    ...cards.filter((card) => !card.locked),
    ...cards.filter((card) => card.locked)
  ];

  function orderDeck(cards, settings, channelId) {
    if (settings.sortBy !== "trend") {
      return playableFirst(store.sortCards(cards, settings.sortBy, channelId));
    }

    const ranking = watcher.ranking();
    // Personal habit is the tiebreak, so a quiet chat still gives a sane order.
    const fallback = new Map(
      store.sortCards(cards, "heat", channelId).map((card, index) => [card.id, index])
    );

    const ordered = cards
      .map((card) => {
        card.signature ||= trending.signature(card.tokens || []);
        const seen = ranking.get(card.signature);
        card.hits = seen?.count || 0;   // what the bar tells the viewer
        card.trend = seen?.score || 0;  // what decides the order
        return card;
      })
      .sort((a, b) => b.trend - a.trend || fallback.get(a.id) - fallback.get(b.id));

    return playableFirst(ordered);
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
  let drawn = null;       // { key, card, until }
  let holdTimer = null;   // wakes the panel when the hold runs out
  let watching = null;    // the channel the drawn card and the chat counts are about
  let drawnShown = null;  // the card the entry animation has already played for

  // Must match od-drawn-breathe in content.css: the glow is picked up where
  // the last one left off, and that needs the cycle length.
  const BREATH_MS = 2600;

  // A reaction already in the hand is no offer at all, and member emoji are
  // left out altogether: they belong to this channel, but YouTube serves them
  // to members only, and a card that fails when pressed is worse than no card.
  // When membership can be told apart, that is the line to revisit.
  const worthOffering = (mine, channelId, member) => (seen) =>
    !mine.has(seen.key) &&
    tokens.hasSubstance(seen.tokens) &&
    // A card that fails when pressed is worse than no card. Being a member is
    // what changed here: this channel's emoji used to be refused outright,
    // because there was no way to ask.
    !whyNotSendable(seen.tokens, channelId, member);

  function drawFromChat(deck, { channelId, member } = {}) {
    if (!settingsCache.suggest) return (drawn = null);

    const now = Date.now();
    const mine = new Set();
    for (const card of deck) {
      card.key ||= tokens.cardKey(card.tokens || []);
      mine.add(card.key);
    }

    // Taking it into the deck ends the offer, and so does its time running
    // out — and so does losing the right to send it. A held card was checked
    // only when it was drawn, so a membership ending mid-hold left an
    // unplayable card sitting there, unlocked, until the hold ran out.
    if (drawn && (now >= drawn.until || mine.has(drawn.key) ||
        whyNotSendable(drawn.card.tokens, channelId, member))) drawn = null;
    if (drawn) return drawn.card;

    const seen = watcher.burst(worthOffering(mine, channelId, member));
    if (!seen) return null;

    // Expiry is only ever noticed by a render, and a chat that has gone quiet
    // stops causing them — so the card outstayed its hold by as long as the
    // chat stayed quiet. This is the render that retires it.
    const hold = store.tuning(settingsCache, "hold");
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => scheduleRender(), hold + 250);

    drawn = {
      key: seen.key,
      until: now + hold,
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

  // Nothing seen on one stream says anything about the next, and YouTube can
  // swap the message list inside the same document — which left the previous
  // channel's card being offered here, and its messages ranking this hand.
  function switchStream(video, channel) {
    // The video, not the channel: a channel can start a second stream without
    // the page ever being rebuilt, and the first one's card was still being
    // offered in front of the second one's chat.
    const stream = video || channel?.id || "";
    if (stream === watching) return false;
    watching = stream;
    drawn = null;
    painted = null;
    watcher.forget();
    return true;
  }

  // Same reason as buildPool: the question has to be asked somewhere a test
  // can watch it being asked.
  function offerFromChat(deck, channel) {
    return drawFromChat(deck, { channelId: channel?.id, member: membership() });
  }

  function buildDrawnRow(card) {
    const el = document.createElement("div");
    el.className = "od-listcard od-drawn";
    el.dataset.scope = "global";
    if (card.id === flashId) el.dataset.flash = flashKind;

    const play = document.createElement("button");
    play.type = "button";
    play.className = "od-listcard-play";
    play.appendChild(tokens.toFragment(card.tokens || [], { preview: true }));
    play.addEventListener("click", (event) => playCard(card, { send: event.shiftKey }));

    el.append(play, drawnTools(card));
    trackPeek(el, card);
    return el;
  }

  // Keeping a drawn card cannot go through playing it: with auto-send on, the
  // press sends it and the save targets never get their moment. The list row
  // was left without this, so in list mode the card could only be played.
  function drawnTools(card) {
    const tools = document.createElement("div");
    tools.className = "od-card-tools";

    tools.appendChild(iconButton("plus", t("peek.saveCard"), (event) => {
      event.stopPropagation();
      if (event.shiftKey) return stageForSaving(card);
      tools.replaceChildren(...targetButtons(card.tokens || [], {
        onPick: (target) => saveTokens(card.tokens || [], target)
      }));
    }, () => cardPeek(card)));

    return tools;
  }

  // No tools, no dragging, nothing to reorder — there is nothing here to
  // rearrange yet. Pressing it puts the reaction in the editor, which is also
  // how keeping it works: the bar is already offering the two save targets by
  // then, and saving puts it in the pool and in this deck together.
  function buildDrawn(card, { size }) {
    const el = document.createElement("div");
    el.className = "od-card od-drawn";
    el.dataset.size = size;
    if (card.id === flashId) el.dataset.flash = flashKind;
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
    // The choice belongs on the card, not up on the bar.
    el.appendChild(drawnTools(card));

    trackPeek(el, card);
    return el;
  }

  // Into the editor and no further, whatever auto-send is set to.
  function stageForSaving(card) {
    const input = getChatInput();
    if (!input) return showToast(t("toast.noInput"));
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
    // Asked again here, and not only when the deck was built or the card
    // drawn. The hand is deliberately frozen while the pointer is on it, so a
    // membership ending under the pointer leaves every lock exactly as it
    // was — and a drawn card has no lock at all, since it is in nobody's
    // deck. Whatever the panel is showing, the press has to be right.
    //
    // A definite answer now beats what the panel was drawn with, in both
    // directions: rejoining under the pointer left the stale lock refusing a
    // card that had just become sendable again. The lock only speaks when the
    // page cannot.
    const here = getChannel()?.id;
    const member = membership();
    const why = here && member !== null
      ? whyNotSendable(card.tokens || [], here, member)
      : (card.locked ? (card.lapsed ? "membership" : "elsewhere") : "");
    if (why) {
      // The bar still says why — but on its own it was the only signal, and
      // it is nowhere near where the press happened.
      if (card.id) flashCard(card.id, "refused");
      return showToast(why === "membership"
        ? t("lock.membershipPlay")
        : t("lock.elsewherePlay"));
    }
    // A click appends to the editor at once, but the send waits a beat for
    // YouTube to enable its button. A second click in that gap appended to the
    // same editor, and the first timer then sent both cards as one comment.
    if (sending) return;

    const input = getChatInput();
    if (!input) return showToast(t("toast.noInput"));

    const willSend = send || settingsCache.autoSend;
    sending = willSend;

    tokens.writeToInput(input, card.tokens || []);

    // What leaves is the editor, not the card. ⇧＋click stages a reaction
    // without sending it, so an unusable one can already be sitting there and
    // the next card carries it out the door — the card was checked and the
    // comment was not.
    if (willSend && whyNotSendable(tokens.collectTokens(input), here, member)) {
      sending = false;
      return showToast(t("toast.leftover"));
    }
    if (willSend) submitChat(() => { sending = false; });

    // A drawn card is not in the pool, so there is no use count to raise.
    if (!card.drawn) await store.apply("markUsed", { id: card.id, channelId: here });
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
    const label = t("peek.takeComment");
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
    const here = barContext?.channel?.name || t("channel.this");

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

    const channel = make("channel", "channel", t("save.channelOnly", here));
    const global = make("global", "global", t("save.global"));

    if (forced) {
      global.disabled = true;
      global.title = t("save.forcedChannel");
    }
    if (!barContext?.channel?.id) {
      // There is no channel to be tied to. Offering it anyway would save a
      // universal card under a button that said otherwise.
      channel.disabled = true;
      channel.title = t("toast.noChannel");
    }
    return [channel, global];
  }

  function readComment(row) {
    const message = row?.querySelector("#message");
    if (!message) return null;

    const captured = tokens.collectTokens(message);
    if (!tokens.hasSubstance(captured)) {
      showToast(t("toast.nothingToSave"));
      return null;
    }
    // Emoji from two channels can be sent nowhere, so such a card could never
    // exist. Say so here rather than at the save target.
    if (tokens.requiredChannels(captured).length > 1) {
      showToast(t("toast.mixedChannels"));
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
    if (!input) return showToast(t("toast.noInput"));
    tokens.writeToInput(input, captured);
  }

  /* ---------- saving and editing ---------- */

  async function saveCurrentInput(target) {
    const input = getChatInput();
    if (!input) return;

    const captured = tokens.collectTokens(input);
    if (!tokens.hasSubstance(captured)) {
      return showToast(t("toast.typeSomething"));
    }

    return saveTokens(captured, target, {
      clear: () => clearInput(input),
      kept: t("toast.inputKept"),
      editing: true
    });
  }

  // Saving is the same wherever the content came from — the editor, a comment
  // in the chat, or a card the chat held out. Only the tidying up differs, and
  // only the editor can be in the middle of re-recording a card.
  async function saveTokens(captured, target, { clear = () => {}, kept = "", editing = false } = {}) {
    // Both read now, before anything is awaited, and kept together: the page
    // can move to another chat while storage is being read, and a membership
    // answer is only ever about the channel it was read from.
    const seen = { channel: getChannel(), member: membership() };

    const data = await store.read();
    if (!data) return shutdown();
    const channel = reconcileChannel(seen.channel, captured);

    // The emoji can belong to somewhere else — that is what reconcileChannel
    // is for — and a badge from this chat says nothing about that channel.
    const member = channel?.id && channel.id === seen.channel?.id ? seen.member : null;

    // Saving a card you cannot send is saving a card that fails when pressed.
    const why = whyNotSendable(captured, channel?.id, member);
    if (why) {
      return showToast(why === "membership"
        ? t("lock.membershipSave")
        : t("lock.elsewhereSave"));
    }

    if (editing && editingId) {
      const id = editingId;
      editingId = null;
      if (data.cards.some((c) => c.id === id)) {
        // Nothing is cleared until the write is known to have landed.
        if (!(await store.apply("editCard", { id, tokens: captured })).ok) {
          return showToast(t("toast.saveFailedKept", kept));
        }
        clear();
        // No toast: the card's own contents change under the pointer, which
        // is both the result and a better account of it than a word in a
        // corner nobody is looking at.
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
          ? t("dup.globalExists")
          : t("dup.channelExists"));
        if (channel?.id) await store.apply("addToDeck", { channelId: channel.id, cardId: duplicate.card.id });
        render();
        return flashCard(duplicate.card.id);
      }

      if (duplicate.inDeck || !channel?.id) {
        showToast(duplicate.inDeck ? t("dup.inDeck") : t("dup.inPool"));
        return flashCard(duplicate.card.id);
      }

      const drawn = await store.apply("addToDeck", {
        channelId: channel.id, cardId: duplicate.card.id
      });
      if (!drawn.ok) return showToast(t("toast.saveFailed"));
      showToast(t("dup.movedFromPool"));
      render();
      return flashCard(duplicate.card.id);
    }

    const card = {
      id: crypto.randomUUID(),
      tokens: captured,
      createdAt: Date.now(),
      by: {}
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
      return showToast(t("toast.saveFailedKept", kept));
    }
    if (added.value?.duplicate) {
      clear();
      // It says what it is and whether the deck actually took it, so this can
      // stop claiming a success that did not happen.
      const { scope: had, added: joined } = added.value;
      showToast(had !== scope
        ? (had === store.GLOBAL ? t("dup.globalExisted") : t("dup.channelExisted"))
        : joined ? t("dup.movedFromPool") : t("dup.inDeck"));
      render();
      return flashCard(added.value.id);
    }
    if (channel?.id) {
      await store.apply("setChannel", { channelId: channel.id, name: channel.name });
    }

    clear();

    const saved = !channel?.id
      ? t("saved.pool")
      : scope === store.GLOBAL
        ? t("saved.global")
        : t("saved.channel");
    if (duplicate) {
      // Same reaction, different wording — probably redundant, but only the
      // user can say for sure, so keep it and make undoing it one click.
      showToast(t("saved.similar", saved), {
        actionLabel: t("action.undoSave"),
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

  // Two things to say about a card, in the place the eye already is.
  //
  // `found` is "this one, the one you already had" — a card that was reused
  // rather than made again. `refused` is "this one did not go": pressing a
  // locked card does nothing at all, and the only account of why was a line
  // in the corner of a bar nobody has reason to look at. The card that was
  // pressed is under the pointer.
  function flashCard(id, how = "found") {
    flashId = id;
    flashKind = how;
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
    // No toast. The bar is about to say 編集中 and put 更新 and やめる in it,
    // which is the same sentence with buttons — and a notice outranks them,
    // so telling someone to press 更新 hid 更新 for six seconds.
    render();
  }

  async function removeFromDeck(card) {
    const channelId = getChannel()?.id;
    if (!channelId) return;

    const { ok, value } = await store.apply("removeFromDeck", { channelId, cardId: card.id });
    if (!ok || value < 0) return;
    render();

    showToast(t("toast.ejected"), {
      actionLabel: t("action.undo"),
      onAction: async () => {
        await store.apply("insertIntoDeck", { channelId, cardId: card.id, at: value });
        render();
      }
    });
  }

  async function addToDeck(card) {
    const channel = getChannel();
    if (!channel?.id) return showToast(t("toast.noChannel"));

    // A card offered by a preset is not a card yet. loadPreset is what makes
    // one — the same path the whole preset takes — so one added by hand
    // lands exactly where it would have landed anyway.
    if (card.offered) {
      const { ok } = await store.apply("loadPreset", {
        channelId: channel.id,
        name: channel.name,
        cards: presets.cardsFor({ cards: [card.offered] }, channel.id)
      });
      if (!ok) return showToast(t("preset.failed"));
      return render();
    }

    const { ok } = await store.apply("addToDeck", { channelId: channel.id, cardId: card.id });
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
      iconButton("eject", t("peek.eject"), (event) => {
        event.stopPropagation();
        removeFromDeck(card);
      }, back),
      iconButton("edit", t("peek.edit"), (event) => { event.stopPropagation(); beginEdit(card); }, back)
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
    showToast(t("toast.deleted"), {
      actionLabel: t("action.undo"),
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
      return {
        text: card.lapsed
          ? t("peek.lockMembership")
          : t("peek.lockElsewhere"),
        warning: true
      };
    }
    // The card itself, at a size that can be read.
    //
    // This was taken out once, for a reason that has since stopped being
    // true: the bar could only spell a card out as text, and a member
    // emoji's text is the name YouTube files it under, so `:_tadaima:` ×3
    // came back as `tadaimatadaimatadaima`. The bar draws pictures now, so
    // what it shows is what the card shows — only in full, rather than
    // shrunk, faded and cut off, which is the state a full card is in.
    //
    // Still not the things a card says about itself. A card being said
    // right now already breathes in the corner, and five people or fifty
    // does not change what anybody does about it; a drawn card's ＋ is on
    // it, in the same place as every other card's.
    const list = card.tokens || [];
    return { key: tokens.cardKey(list), tokens: list };
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

  // How much a card at this size can show before it fades out.
  const BUDGET = { small: 6, medium: 9, large: 12 };

  // How much room a card's contents want, in characters.
  //
  // Not the length of their names, which is what measuring the plain text
  // does: three `:_tadaima:` came to 21 characters, because that is
  // `tadaimatadaimatadaima`, and a card of three small pictures was shrunk
  // and faded for being too long.
  //
  // But not two either, which is only how wide a stamp is. The budget
  // decides when the contents stop fitting, and fitting is an area: a stamp
  // is also about one and a half lines tall, so a small card holds four of
  // them where it holds eight characters. At two, the third row of stamps
  // was being cut off at the card's edge while the budget still said there
  // was room — the shrink arrived at ten stamps and the fade never did.
  const EMOJI_WIDTH = 3;

  // An emoji sitting inside a text token is a picture too — the card draws it
  // as one — and counting its characters instead made two cards of the same
  // six pictures measure differently: 🦢✨🦢✨🦢✨ came to nine, because ✨ is
  // one UTF-16 unit and 🦢 is two.
  const textWidth = (value) =>
    tokens.splitEmoji((value || "").trim())
      .reduce((wide, part) => wide + (part.emoji ? EMOJI_WIDTH : part.value.length), 0);

  // The `×5`, which takes room on the card like anything else.
  const TIMES_WIDTH = 2;

  // What a card draws, which is not always what it says. A card that is one
  // picture said five times draws the picture once and counts — the stamps
  // are the whole point of a card like that, and five of them on a small
  // card means shrinking them until they cannot be told apart. The bar still
  // shows every one of them; that is where you check what is about to be
  // sent.
  const shownAs = (card) =>
    tokens.repeated(card.tokens || []) || { unit: card.tokens || [], times: 0 };

  const widthOf = (card) => {
    const { unit, times } = shownAs(card);
    return unit.reduce(
      (wide, token) => wide + (token.type === "text" ? textWidth(token.value) : EMOJI_WIDTH),
      0
    ) + (times ? TIMES_WIDTH : 0);
  };

  function cardBody(card, size) {
    const body = document.createElement("div");
    body.className = "od-card-body";

    const { unit, times } = shownAs(card);
    body.appendChild(tokens.toFragment(unit, { preview: true }));
    if (times) {
      const count = document.createElement("span");
      count.className = "od-times";
      count.textContent = `×${times}`;
      body.appendChild(count);
    }

    // Long text shrinks a step and fades out rather than overflowing.
    const width = widthOf(card);
    const budget = BUDGET[size] || BUDGET.small;
    if (width > budget * 3) body.dataset.length = "long";
    else if (width > budget) body.dataset.length = "medium";
    return { body };
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
    if (card.id === flashId) el.dataset.flash = flashKind;

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

  // Everything the panel draws from.
  //
  // Deliberately coarse about the chat: an exact hit count changes every few
  // seconds and would defeat the point, so only whether a card is trending at
  // all counts as a change. The bar reads its count live instead, so nothing
  // goes stale there either.
  //
  // Everything else has to be here, because a signature that misses an input
  // leaves the panel showing what is no longer true — worse than redrawing for
  // nothing. Width, because the fan is laid out to it. Content and scope,
  // because an edit keeps the card's id. The channel name and the pool count,
  // because the bar and the toggle say them. And whether the presets have
  // arrived, because the empty-deck offer waits on them.
  function panelSignature(data, channel, hue, shown, pool, drawn) {
    const s = data.settings;
    const each = (card) => [
      card.id,
      tokens.cardKey(card.tokens || []),
      card.bound ? "b" : "",
      card.locked ? "l" : "",
      card.hits ? "*" : ""
    ].join(":");

    return [
      s.mode, s.cardSize, s.rows, s.sortBy, s.suggest ? "draw" : "",
      s.draw, s.hold, s.pace, s.language,
      inputIsPinned ? "pinned" : "",
      channel?.id || "", channel?.name || "", hue ?? "",
      rootEl?.clientWidth || 0,
      poolOpen ? `pool:${poolTab}` : "deck", expanded ? "more" : "",
      editingId || "", flashId ? `${flashId}:${flashKind}` : "", inputHasContent ? "typing" : "",
      pool.length, presetsOnHand(channel?.id).length,
      drawn?.key || "",
      shown.map(each).join(",")
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
      if (card.id === flashId) el.dataset.flash = flashKind;

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
  function buildBar({ channel, hue, count, mine, offered }) {
    const bar = document.createElement("div");
    bar.className = "od-bar";
    // Everything that would otherwise float over the chat lives here instead.
    if (notice) bar.append(noticeRow(notice));
    else if (peek) bar.append(peekReadout(peek));
    else if (poolOpen) bar.append(poolTabs(mine, offered));
    else bar.append(inputHasContent ? saveTargets(channel, hue) : deckIdentity(channel, hue, count));

    if (poolOpen) {
      bar.appendChild(buildAction("close", t("action.close"), t("aria.closePool"), () => {
        poolOpen = false;
        render();
      }));
    } else {
      // The way in used to be a full-width row under the hand, which cost a
      // line of the panel to say one short thing. The bar is already where
      // this UI puts anything that would otherwise take room of its own, and
      // it has a side for controls.
      //
      // Both halves counted, not just the pool. A channel whose preset is the
      // only thing on offer — nothing saved yet, which is every channel at
      // the start — would otherwise have no way in at all.
      if (mine + offered) {
        bar.appendChild(buildAction("plus", t("pool.short", mine + offered), t("aria.addFromPool"),
          () => { poolOpen = true; poolTab = mine ? "mine" : "offered"; render(); }));
      }
      bar.appendChild(buildAction("deck", t("action.build"), t("aria.openBuilder"), () => openOptions()));
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

  // A card's own contents are drawn; everything else the bar says is words.
  function peekReadout({ text, tokens: list, warning }) {
    const readout = document.createElement("div");
    readout.className = "od-peek";
    if (warning) readout.dataset.warning = "true";
    if (list) readout.appendChild(tokens.toFragment(list, { preview: true }));
    else readout.textContent = text;
    return readout;
  }

  // A peek with nothing to say is not a peek.
  //
  // Once the bar stopped reading cards back, cardPeek began answering
  // `{ text: "" }` for a card that can show itself — which is most of them —
  // and an empty object is still truthy. The bar drew an empty row where the
  // deck's own name and scope had been. Worse, "" and null compare the same
  // two lines down, so moving the pointer off the card was not a change and
  // the name never came back: hovering one card emptied the bar for good.
  // What makes one peek a different peek. A card answers with its key, since
  // its words are the pictures' filenames and two cards can share them; a
  // control answers with the words it put there.
  const peekKey = (what) => what?.key || what?.text || null;

  function setPeek(next, owner = null) {
    const said = peekKey(next) ? next : null;
    const changed = peekKey(peek) !== peekKey(said);
    peek = said;
    peekOwner = said ? owner : null;
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

  // The two halves, as two labels you switch between. A card you saved and a
  // card a preset is offering are different things — shown in one list, the
  // pool was full of cards that were not in it.
  function poolTabs(mine, offered) {
    const group = document.createElement("div");
    group.className = "od-bar-identity";

    const tab = (which, text) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "od-pool-tab";
      button.textContent = text;
      if (poolTab === which) button.dataset.current = "true";
      button.addEventListener("click", () => { poolTab = which; render(); });
      return button;
    };

    group.append(tab("mine", t("pool.mine", mine)));
    // Nothing left to offer is not a tab to press; the preset is spent.
    if (offered) group.append(tab("offered", t("pool.offered", offered)));
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
      name.textContent = channel.name || t("channel.this");
      const plus = document.createElement("span");
      plus.className = "od-plus-sign";
      plus.textContent = "＋";
      group.append(dot, name, plus);
    }

    const commonDot = document.createElement("span");
    commonDot.className = "od-dot od-dot-common";
    const commonLabel = document.createElement("span");
    commonLabel.className = "od-common";
    commonLabel.textContent = t("bar.global");

    const total = document.createElement("span");
    total.className = "od-count";
    total.textContent = t("count.cards", count);

    group.append(commonDot, commonLabel, total);
    return group;
  }

  function saveTargets(channel, hue) {
    const group = document.createElement("div");
    group.className = "od-bar-save";

    if (editingId) {
      const label = document.createElement("span");
      label.className = "od-save-label";
      label.textContent = t("bar.editing");

      const update = buildAction("plus", t("action.update"), t("aria.updateCard"), () => saveCurrentInput());
      update.dataset.primary = "true";

      const cancel = buildAction("close", t("action.cancel"), t("aria.cancelEdit"), () => {
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
      const only = buildAction("plus", t("save.pool"),
        t("save.poolWhy"), () => saveCurrentInput("global"));
      only.dataset.primary = "true";
      group.appendChild(only);
      return group;
    }

    const forced = tokens.requiredChannels(currentTokens).length > 0;

    const toChannel = buildAction("plus", channel.name || t("save.channelShort"),
      forced
        ? t("save.forcedWhy")
        : t("save.channelWhy"),
      () => saveCurrentInput("channel"));
    toChannel.dataset.primary = "true";
    toChannel.classList.add("od-save-channel");
    if (hue != null) toChannel.style.setProperty("--od-scope-hue", hue);

    const toGlobal = buildAction("plus", t("save.globalShort"),
      forced
        ? t("save.globalBlocked")
        : t("save.globalWhy"),
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

  function editorChanged(input) {
    const filled = readInput(input);

    // A notice says what just happened, and it stops being news the moment
    // you do something else. It also outranks the save targets, which are in
    // the same row — so an error about what you typed hid the buttons you
    // needed to fix it and try again, for six seconds.
    if (notice) clearNotice();

    // Emptying the editor means you are no longer editing anything. Without
    // this the flag survives with no visible way to clear it.
    if (!filled && editingId) {
      editingId = null;
      inputHasContent = false;
      return render();
    }

    // Whether the editor holds a member emoji decides whether 通用 can be
    // offered, so the bar has to be rebuilt when that changes too — not only
    // when the editor goes from empty to full.
    const pinned = filled && tokens.requiredChannels(tokens.collectTokens(input)).length > 0;
    if (filled === inputHasContent && pinned === inputIsPinned) return;
    inputHasContent = filled;
    inputIsPinned = pinned;
    refreshBar();
  }

  function watchInput(input) {
    if (watchedInput === input) return;
    watchedInput = input;

    const onEditorChanged = () => editorChanged(input);

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
    });
  }

  function refreshBar() {
    if (!barEl?.isConnected || !barContext) return;
    const next = buildBar(barContext);
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
    i18n.use(settingsCache.language);
    watcher.start(); // no-op once attached; retries while chat is still loading

    const channel = getChannel();
    const video = currentVideo();
    if (!channel) retryUnresolved(video);

    switchStream(video, channel);

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
    inputIsPinned = inputHasContent &&
      tokens.requiredChannels(tokens.collectTokens(input)).length > 0;

    const mine = buildPool(data, channel?.id);
    const offered = buildOffered(data, channel?.id);
    // The last card of a half can be taken while you are looking at it.
    if (poolTab === "offered" && !offered.length) poolTab = "mine";

    const shown = poolOpen ? (poolTab === "offered" ? offered : mine) : deck;
    // Only alongside your own deck. The pool is a place to choose from, not
    // somewhere to be handed things.
    const drawn = poolOpen ? null : offerFromChat(deck, channel);

    // Chat-driven mode renders every few seconds whether or not anything it
    // shows has changed, and rebuilding is not free: the elements are new, so
    // the drawn card replayed its entry animation and looked like it was
    // jumping.
    //
    // This has to be decided *before* anything is torn down. It used to sit
    // just after replaceChildren(), where rootEl.firstChild is null by
    // construction — so the test never passed and the panel was rebuilt every
    // time regardless.
    // Before the early return, not after: a control that replaces itself in
    // place — the drawn card's ＋ becoming the two targets — disconnects its
    // owner without changing anything the signature can see.
    dropStalePeek();

    const next = panelSignature(data, channel, hue, shown, [...mine, ...offered], drawn);
    if (next === painted && rootEl.firstChild) return;
    painted = next;

    keepChatPinned(() => {
      rootEl.replaceChildren();
      // Everything that was hovered is gone now; whatever it was describing
      // must go with it.
      dropStalePeek();
      rootEl.dataset.mode = data.settings.mode;
      rootEl.dataset.pool = String(poolOpen);

      barContext = { channel, hue, count: shown.length,
                     mine: mine.length, offered: offered.length };
      barEl = buildBar(barContext);
      rootEl.appendChild(barEl);

      if (!shown.length && !drawn) {
        const empty = document.createElement("div");
        empty.className = "od-empty";
        empty.textContent = poolOpen
          ? t("pool.empty")
          : t("pool.emptyHint");
        rootEl.appendChild(empty);
        if (!poolOpen) appendPresetOffer(rootEl, channel);
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
        more.setAttribute("aria-label", expanded ? t("action.collapse") : t("aria.showRest"));
        more.append(svgIcon("chevron"));

        const label = document.createElement("span");
        label.textContent = expanded ? t("action.collapse") : t("action.more", hidden);
        more.appendChild(label);

        more.addEventListener("click", () => { expanded = !expanded; render(); });
        rootEl.appendChild(more);
      }
    });
  }

  // Nothing joins a deck on its own, so there has to be a way in from here.
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
      notice.textContent = t("toast.reloaded");
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

  // `channelId` narrows it to what can actually be offered here: a preset
  // that names a channel belongs to that channel alone, because it may carry
  // member emoji nobody else can send.
  function presetsOnHand(channelId) {
    if (askedForPresets) return bundledPresets.filter((p) => presets.offeredOn(p, channelId));
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

    return bundledPresets.filter((p) => presets.offeredOn(p, channelId));
  }

  // Offered only where it means something: a channel whose deck is empty.
  // Never over a deck that already has something in it.
  function appendPresetOffer(container, channel) {
    if (!channel?.id) return;

    for (const preset of presetsOnHand(channel.id)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "od-more";
      button.textContent = t("preset.add", preset.name, preset.cards.length);
      button.addEventListener("click", () => usePreset(preset, channel));
      container.appendChild(button);
    }
  }

  async function usePreset(preset, channel) {
    const channelId = channel.id;
    const { ok, value } = await store.apply("loadPreset", {
      channelId,
      name: channel.name,
      cards: presets.cardsFor(preset, channelId)
    });
    if (!ok || !value) return showToast(t("preset.failed"));

    // Ten cards arriving is its own announcement. What it does not account
    // for is a pool that grew by less than that, so the only thing said here
    // is the part that would otherwise be a surprise.
    if (value.reused) showToast(t("preset.loadedReused", preset.name, value.reused));
    render();
  }

  /* ---------- wiring ---------- */

  // Live chat mutates constantly, so keep the hot path to one cheap lookup.
  let lastMembership = null;   // what the panel was last drawn against

  // Named so it can be driven: what the panel does when the page changes
  // under it is a decision, and it was being made inside the observer where
  // nothing could reach it.
  function onPageChanged() {
    const input = findChatInput(); // existence only: measuring here costs a layout
    if (input && (input !== currentInput || !rootEl?.isConnected)) return scheduleRender();

    // Joining, or a membership ending, changes which cards can be played —
    // and nothing else is going to notice. With suggestions off and a plain
    // sort, a quiet chat never renders on its own, so the locks stayed as
    // they were until something unrelated happened along.
    const member = membership();
    if (member === lastMembership) return;
    lastMembership = member;
    scheduleRender();
  }

  // Handed the observer rather than making one, so a test can be given the
  // same thing the browser is: which function, watching what, for what. The
  // assertions before this checked the source text for a name and an option,
  // which a detached target or `subtree: false` sailed straight past.
  //
  // `type` as well as childList: a badge can change what it is without being
  // replaced, and that is a membership change with no nodes added or removed.
  function watchPage(root, Observer = MutationObserver) {
    const watcher = new Observer(onPageChanged);
    watcher.observe(root, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["type"]
    });
    return watcher;
  }

  const observer = watchPage(document.documentElement);

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
