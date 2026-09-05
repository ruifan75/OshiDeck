// OshiDeck — card deck for YouTube Live Chat.
(() => {
  const OD = globalThis.OshiDeck;
  const { layout, store, tokens, trending } = OD;

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
  let expanded = false;
  let flashId = null;
  let drag = null;
  let poolOpen = false;
  let peek = null;
  let editingId = null;  // card being re-recorded, if any
  let settingsCache = { ...store.DEFAULT_SETTINGS };
  let frozen = false;    // pointer is over the deck — do not reorder under it
  let pendingRender = false;

  // Always running: even outside trend mode it keeps emoji urls fresh.
  const watcher = trending.createWatcher({
    onChange: () => { if (settingsCache.sortBy === "trend") scheduleRender(); }
  });

  const log = (...args) => console.debug("[OshiDeck]", ...args);

  /* ---------- YouTube DOM ---------- */

  function getChatInput() {
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

  const asChannelId = (value) =>
    typeof value === "string" && value.startsWith("UC") ? value : null;

  const channelFromHref = (href) =>
    asChannelId(href?.match(/^\/channel\/([^/?#]+)/)?.[1]);

  // Sources in priority order, tried one at a time.
  //
  // These were once a single comma-separated selector list, which does NOT
  // mean "try each in turn": querySelector returns the first element in
  // DOCUMENT ORDER matching any of them. YouTube's left guide links to its own
  // auto-generated channels (Music, Gaming, …) and sits near the top of the
  // DOM, so a broad `a.yt-simple-endpoint[href^="/channel/"]` beat the owner
  // link every time the page was still filling in — and cards were filed under
  // YouTube Music.
  const OWNER_LINKS = [
    "ytd-video-owner-renderer a[href^='/channel/']",
    "#owner a[href^='/channel/']",
    "ytd-channel-name a[href^='/channel/']"
  ];

  function readChannel(doc) {
    // The owner link carries the id and the label together, so they can never
    // describe two different channels — which is how one deck ended up with
    // the right name and the wrong id.
    for (const selector of OWNER_LINKS) {
      const link = doc.querySelector(selector);
      const id = channelFromHref(link?.getAttribute("href"));
      if (id) return { id, name: link.textContent?.trim() || "" };
    }

    // Authoritative on a watch page, but it carries no name.
    const id = asChannelId(doc.querySelector('meta[itemprop="channelId"]')?.content);
    if (!id) return null;

    const name =
      doc.querySelector("ytd-video-owner-renderer #channel-name a")?.textContent?.trim() ||
      doc.querySelector("ytd-channel-name #text")?.textContent?.trim() ||
      "";
    return { id, name };
  }

  // The live chat runs in a same-origin iframe, so the owner details live in
  // the parent document.
  function getChannel() {
    let found = readChannel(document);
    if (found) return found;
    try {
      if (window.top !== window) found = readChannel(window.top.document);
    } catch (_) { /* cross-origin frame: nothing to read */ }
    return found;
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
        card.hits = ranking.get(card.signature) || 0;
        return card;
      })
      .sort((a, b) => b.hits - a.hits || fallback.get(a.id) - fallback.get(b.id));
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

    await store.apply("markUsed", { id: card.id });
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
      done?.();
    };
    setTimeout(attempt, 80);
  }

  /* ---------- saving and editing ---------- */

  async function saveCurrentInput(target) {
    const input = getChatInput();
    if (!input) return;

    const captured = tokens.collectTokens(input);
    if (!tokens.hasSubstance(captured)) {
      return showToast("保存する内容を入力してください");
    }

    const data = await store.read();
    if (!data) return shutdown();
    const channel = reconcileChannel(getChannel(), captured);

    if (editingId) {
      const id = editingId;
      editingId = null;
      if (data.cards.some((c) => c.id === id)) {
        // Nothing is cleared until the write is known to have landed.
        if (!(await store.apply("editCard", { id, tokens: captured })).ok) {
          return showToast("保存できませんでした。入力はそのままです");
        }
        clearInput(input);
        showToast("札を更新しました");
        return render();
      }
    }

    const duplicate = findDuplicate(data, channel?.id, captured);
    if (duplicate?.exact) {
      if (duplicate.inDeck || !channel?.id) {
        clearInput(input);
        showToast(duplicate.inDeck ? "同じ札がこのデッキにもうあります" : "同じ札がプールにもうあります");
        return flashCard(duplicate.card.id);
      }
      // It exists in the pool already — draw it rather than make a second one.
      const drawn = await store.apply("addToDeck", {
        channelId: channel.id, cardId: duplicate.card.id
      });
      if (!drawn.ok) return showToast("保存できませんでした。入力はそのままです");
      clearInput(input);
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
    // Saving here always puts the card in this channel's deck; `target` says
    // whether it is this channel's card or one that works anywhere.
    const scope = target === "channel" && channel?.id ? channel.id : store.GLOBAL;
    const added = await store.apply("addCard", { card, channelId: channel?.id, scope });
    if (!added.ok) {
      // Quota, or the context went away. Keep what was typed.
      return showToast("保存できませんでした。入力はそのままです");
    }
    if (added.value?.duplicate) {
      clearInput(input);
      showToast("同じ札がもうあります");
      render();
      return flashCard(added.value.id);
    }
    if (channel?.id) {
      await store.apply("setChannel", { channelId: channel.id, name: channel.name });
    }

    clearInput(input);

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
    return { text: card.hits > 0 ? `${body}  ・ いまチャットで${card.hits}回` : body };
  }

  function trackPeek(el, card) {
    el.addEventListener("pointerenter", () => setPeek(cardPeek(card)));
    el.addEventListener("pointerleave", () => setPeek(null));
  }

  // Native tooltips float over the chat wherever they are attached, so nothing
  // in this UI gets a `title`. The name goes to assistive tech, and the same
  // text shows in our own bar on hover.
  function describe(el, text, options = {}) {
    el.setAttribute("aria-label", text);
    // pointerenter/leave do not bubble, so entering a control inside a card
    // leaves the card's own peek alone; restore() puts it back on the way out.
    el.addEventListener("pointerenter", () => setPeek({ text, warning: options.warning }));
    el.addEventListener("pointerleave", () =>
      setPeek(options.restore ? options.restore() : null));
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

  function renderHand(container, deck, settings, hue) {
    const width = container.clientWidth || 400;
    const size = settings.cardSize;
    const cardWidth = layout.CARD_SIZE[size] || layout.CARD_SIZE.small;
    // Leave room for a scrollbar: when the deck overflows, the gutter eats
    // into the row and the last card would push a horizontal bar into view.
    const perRow = layout.cardsPerRow(width - PANEL_PADDING - SCROLLBAR_GUTTER, cardWidth);
    const visibleRows = Math.min(MAX_ROWS_CAP, Math.max(1, settings.rows));

    // Lay out every card. The row setting caps how many rows are *shown*, not
    // how many exist — cards past the cap used to be unreachable.
    const allRows = Math.max(1, Math.ceil(deck.length / perRow));
    const { rows } = layout.splitRows(deck.length, perRow, allRows);

    const hand = document.createElement("div");
    hand.className = "od-hand";
    hand.style.setProperty("--od-visible-rows", visibleRows);
    if (expanded) hand.dataset.expanded = "true";
    // Only cap and scroll when there is genuinely more than fits; otherwise a
    // hovered card would be clipped by an overflow container it never needed.
    else if (rows.length > visibleRows) hand.dataset.scrollable = "true";

    let cursor = 0;
    for (const rowLength of rows) {
      const row = document.createElement("div");
      row.className = "od-row";

      for (let i = 0; i < rowLength; i++) {
        const card = deck[cursor++];
        const el = buildCard(card, { size, hue });
        const { rot, lift } = layout.tilt(i, rowLength);
        el.style.setProperty("--od-rot", `${rot.toFixed(2)}deg`);
        el.style.setProperty("--od-lift", `${lift.toFixed(2)}px`);
        if (i > 0) el.style.setProperty("--od-overlap", `-${layout.OVERLAP}px`);
        row.appendChild(el);
      }
      hand.appendChild(row);
    }

    container.appendChild(hand);
    return Math.max(0, deck.length - perRow * visibleRows);
  }

  function renderList(container, deck, settings, hue) {
    const list = document.createElement("div");
    list.className = "od-list";
    if (expanded) list.dataset.expanded = "true";
    else if (deck.length > LIST_VISIBLE) list.dataset.scrollable = "true";

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

  function setPeek(next) {
    const changed = (peek?.text || null) !== (next?.text || null);
    peek = next;
    if (changed && !notice) refreshBar();
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

    const input = getChatInput();
    if (!input) return;
    currentInput = input;

    if (!rootEl || !rootEl.isConnected) {
      rootEl = mount(input);
      if (!rootEl) return log("Chat input found, but no place to mount.");
      log("Mounted.");
    }

    const data = await store.read();
    if (!data) return shutdown();
    settingsCache = data.settings;
    watcher.start(); // no-op once attached; retries while chat is still loading

    const channel = getChannel();
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
      rootEl.dataset.mode = data.settings.mode;
      rootEl.dataset.pool = String(poolOpen);

      const shown = poolOpen ? pool : deck;
      barContext = { channel, hue, count: shown.length };
      barEl = buildBar(channel, hue, shown.length);
      rootEl.appendChild(barEl);

      if (!shown.length) {
        const empty = document.createElement("div");
        empty.className = "od-empty";
        empty.textContent = poolOpen
          ? "プールに追加できる札がありません"
          : "コメントを入力して保存すると札になります";
        rootEl.appendChild(empty);
        if (!poolOpen) appendPoolToggle(pool.length);
        return;
      }

      const hidden =
        data.settings.mode === "list"
          ? renderList(rootEl, shown, data.settings, hue)
          : renderHand(rootEl, shown, data.settings, hue);

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
    watcher.stop();
    clearTimeout(refreshTimer);
    clearTimeout(noticeTimer);

    if (rootEl?.isConnected) {
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

  /* ---------- wiring ---------- */

  // Live chat mutates constantly, so keep the hot path to one cheap lookup.
  const observer = new MutationObserver(() => {
    const input = getChatInput();
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

  window.addEventListener("yt-navigate-finish", scheduleRender);
  window.addEventListener("load", scheduleRender);

  log("Loaded.", location.href);
  scheduleRender();
})();
