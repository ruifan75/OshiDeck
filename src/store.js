// Storage, migration, settings and deck membership.
(() => {
  const OD = (globalThis.OshiDeck ||= {});

  const KEYS = {
    SETTINGS: "settings",
    CARDS: "cards",      // the pool: every card, once
    DECKS: "decks",      // channelId -> ordered card ids
    CHANNELS: "channelMeta",
    LEGACY: "presets"    // v0.1/v0.2 shape, kept as a backup after migrating
  };

  const DEFAULT_SETTINGS = {
    autoSend: false,
    mode: "hand",      // hand | list
    cardSize: "small", // large | medium | small
    rows: 2,           // 1 | 2
    sortBy: "trend",   // manual | uses | heat | trend
    suggest: true,     // draw one card from what the chat is doing
    draw: "normal",    // shy | normal | eager — how much of a wave it takes
    hold: "normal",    // long | normal | short, or milliseconds
    pace: "normal",    // slow | normal | quick, or milliseconds
    language: ""       // "" follows the browser; otherwise a code from i18n.LANGUAGES
  };

  // The numbers behind those three. Offered as steps rather than as fields
  // because they are not independent: how many messages and what share of the
  // room together decide what counts as a wave, and picking them apart invites
  // combinations that mean nothing (two messages, half the room).
  //
  // Every value is here, so changing what a step means is one edit, and the
  // settings page can say plainly what it is about to do.
  const TUNING = {
    draw: {
      shy:    { min: 8, share: 0.40 },
      normal: { min: 6, share: 0.30 },
      eager:  { min: 4, share: 0.20 }
    },
    hold: {
      long: 60_000,
      normal: 30_000,
      short: 15_000
    },
    pace: {
      slow: 30_000,
      normal: 20_000,
      quick: 10_000
    }
  };

  // These two can also be given a number of milliseconds outright. Steps are
  // the honest default — they are a judgement about feel, not a measurement —
  // but somebody who has watched their own chat has a better number than any
  // of mine. `draw` stays steps only: it is two numbers that have to agree,
  // and picking them apart invites combinations that mean nothing.
  const BY_TIME = new Set(["hold", "pace"]);
  const SHORTEST = 1_000;
  const LONGEST = 600_000;
  const clampTime = (ms) => Math.min(LONGEST, Math.max(SHORTEST, Math.round(ms)));

  // Falls back to the middle step rather than to nothing: a settings file from
  // an older version has no opinion about these, and neither does a broken one.
  const tuning = (settings, group) => {
    const chosen = settings?.[group];
    if (BY_TIME.has(group) && typeof chosen === "number" && Number.isFinite(chosen)) {
      return clampTime(chosen);
    }
    return TUNING[group]?.[chosen] ?? TUNING[group]?.normal;
  };

  // What each setting may be, so that nothing downstream has to wonder.
  //
  // Not only the two time steps, and not only the settings page: a backup is
  // a file and a file can say anything. One with `mode: "not-a-mode"` passed
  // validation and then threw on the options page, which reads the matching
  // radio by value and set `.checked` on nothing.
  const ALLOWED = {
    autoSend: [true, false],
    mode: ["hand", "list"],
    cardSize: ["large", "medium", "small"],
    rows: [1, 2],
    sortBy: ["manual", "uses", "heat", "trend"],
    suggest: [true, false],
    draw: ["shy", "normal", "eager"],
    hold: ["long", "normal", "short"],
    pace: ["slow", "normal", "quick"]
  };

  function cleanSettings(patch) {
    const clean = {};
    for (const [key, value] of Object.entries(patch || {})) {
      // Anything that is not a setting is not one by being written down.
      if (!Object.hasOwn(DEFAULT_SETTINGS, key)) continue;

      // Any string: i18n falls back from one it does not know, and a code it
      // has never heard of is how "follow the browser" is written.
      if (key === "language") {
        if (typeof value === "string") clean[key] = value;
        continue;
      }

      // These two take a number of milliseconds as well as a step. An empty
      // field arrives as NaN, which is a number and not an answer.
      if (BY_TIME.has(key) && typeof value === "number") {
        if (Number.isFinite(value)) clean[key] = clampTime(value);
        continue;
      }

      // `includes`, not a lookup: `TUNING[group][value]` answered for
      // "toString", and tuning() then handed its callers a function.
      if (ALLOWED[key].includes(value)) clean[key] = value;
    }
    return clean;
  }

  const HALF_LIFE = 7 * 24 * 60 * 60 * 1000;
  const decay = (ms) => Math.pow(0.5, Math.max(0, ms) / HALF_LIFE);

  const HUES = [320, 145, 250, 85, 25, 195, 290, 60];

  // Hand-written, and consulted before the hash. A channel that is here gets
  // the colour it is actually known by; everyone else keeps whatever their id
  // happens to give them, which is stable but arbitrary. Either way the viewer
  // can change it, and that choice always wins — this only decides what a deck
  // looks like the first time it appears.
  //
  //   "UCPb47fygHcFbRp_y05mS0IA": 250,
  const OSHI_HUES = {};

  function defaultHue(channelId) {
    const known = OSHI_HUES[channelId];
    if (known != null) return known;

    let h = 0;
    for (const ch of String(channelId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return HUES[h % HUES.length];
  }

  // The hue of a colour someone picked. The stored value is a hue and nothing
  // else, because the palette fixes lightness and chroma — oklch(0.74 0.19 H)
  // — so every channel reads the same against a dark panel. Keeping a whole
  // colour would let one land unreadable, so a picked one is asked only what
  // hue it is.
  function hueOfColor(r, g, b) {
    const linear = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const R = linear(r), G = linear(g), B = linear(b);

    // sRGB to Oklab, via the cube roots of the LMS cone responses.
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);

    const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;

    // Grey has no hue to speak of; pick something rather than a random angle.
    if (Math.hypot(a, bb) < 1e-4) return 0;
    return Math.round((Math.atan2(bb, a) * 180 / Math.PI + 360) % 360);
  }

  // The other way, so a colour picker can open on the colour already chosen.
  // Out-of-gamut hues are clamped rather than refused: this is only ever the
  // starting swatch of a picker.
  function hexOfHue(hue, lightness = 0.72, chroma = 0.19) {
    const h = (hue * Math.PI) / 180;

    const rgb = (c) => {
      const a = Math.cos(h) * c;
      const b = Math.sin(h) * c;
      const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
      return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
      ];
    };

    // Some hues at this lightness and chroma are outside sRGB. Clipping the
    // channels would shift the hue by up to nine degrees, so the chroma comes
    // down instead and the hue survives — which is the part being chosen.
    let found = rgb(chroma);
    for (let c = chroma; c > 0.01 && found.some((v) => v < -0.0005 || v > 1.0005); c -= 0.005) {
      found = rgb(c);
    }

    const channel = (v) => {
      const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055;
      return Math.max(0, Math.min(255, Math.round(encoded * 255)));
    };

    return "#" + found.map((v) => channel(v).toString(16).padStart(2, "0")).join("");
  }

  const hueFromHex = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return hueOfColor((n >> 16) & 255, (n >> 8) & 255, n & 255);
  };

  const blank = () => ({ by: {}, createdAt: Date.now() });

  // How often a card is used is a fact about a chat, not about the card.
  //
  // 👏 pressed fifty times in one channel says nothing about the next one,
  // and one shared number put a card nobody there had ever pressed at the
  // front of the hand. So every card keeps a count per channel, under `by`.
  // A channel-only card has one channel to begin with, so for those this
  // changes nothing.
  const noCount = () => ({ uses: 0, heat: 0, lastUsedAt: 0 });
  const countOn = (card, channelId) => (channelId && card.by?.[channelId]) || noCount();

  // Scope survives every earlier format, because every earlier format recorded
  // the same distinction under a different name. Deriving it from the content
  // instead would quietly broaden a channel-only card to every pool.
  const withScope = (card, implied) => ({
    ...card,
    scope: forcedScope(card.tokens) || card.scope || implied || GLOBAL
  });

  // Counts used to be one number per card, shared by every channel. Where
  // they were earned cannot be recovered, so each deck holding the card keeps
  // what there was: for a card in one deck — which is most of them — that is
  // exactly right, and for a card in several it is the only answer that does
  // not throw the order away on upgrade. They go their own ways from the next
  // press onwards.
  function splitCounts(card, decks) {
    const was = { uses: card.uses || 0, heat: card.heat || 0, lastUsedAt: card.lastUsedAt || 0 };
    delete card.uses; delete card.heat; delete card.lastUsedAt;

    // `by` is empty, not missing: blank() puts one on every card before this
    // runs, so "has it been split already" is whether anything is in it.
    if (!was.uses && !was.heat && !was.lastUsedAt) return card;
    if (Object.keys(card.by || {}).length) return card;

    const held = Object.entries(decks || {})
      .filter(([, ids]) => (ids || []).includes(card.id))
      .map(([channelId]) => channelId);

    // A card in no deck is usually one that was ejected into the pool, and it
    // still says where it was used if it is tied to a channel: that is the
    // only channel it could ever have been used on. Dropping its counts threw
    // away a history that was right there in its scope.
    const scope = scopeOf(card);
    const where = held.length ? held : (scope === GLOBAL ? [] : [scope]);

    card.by = {};
    for (const channelId of where) card.by[channelId] = { ...was };
    return card;
  }

  // A card lives in the pool once. A deck is an ordered list of ids drawn from
  // it, so the same card can sit in several decks and hold a different place
  // in each — which a single shared ordering could never express.
  // Every shape goes through the same split, once the decks are known. It
  // used to be applied inside the first branch only, so anything arriving in
  // an older shape was given an empty `by` and its counts deleted unread: a
  // card with forty uses came back as one the first time it was pressed.
  function migrate(raw) {
    const { cards, decks } = shape(raw);
    for (const card of cards) splitCounts(card, decks);
    return { cards, decks };
  }

  function shape(raw) {
    if (Array.isArray(raw[KEYS.CARDS]) && raw[KEYS.DECKS]) {
      return {
        cards: raw[KEYS.CARDS].map((card) => withScope({ ...blank(), ...card })),
        decks: raw[KEYS.DECKS]
      };
    }

    const cards = [];
    const decks = {};
    const add = (channelId, id) => (decks[channelId] ||= []).push(id);

    // v0.3: one flat list, scope on the card.
    if (Array.isArray(raw[KEYS.CARDS])) {
      const commons = [];
      for (const card of raw[KEYS.CARDS]) {
        // v0.3 stored the same idea in the same field.
        cards.push(withScope({ ...blank(), ...card }));
        if (card.scope && card.scope !== GLOBAL) add(card.scope, card.id);
        else commons.push(card.id);
      }
      // Commons used to appear everywhere; keep them visible where they were.
      for (const channelId of Object.keys(decks)) {
        for (const id of commons) add(channelId, id);
      }
      return { cards, decks };
    }

    // v0.1/v0.2: presets.global plus presets.channels.
    const legacy = raw[KEYS.LEGACY];
    if (!legacy) return { cards, decks };

    for (const [channelId, list] of Object.entries(legacy.channels || {})) {
      for (const card of list || []) {
        // presets.channels[X] meant "this card is X's" — that is the scope.
        cards.push(withScope({ ...blank(), ...card }, channelId));
        add(channelId, card.id);
      }
    }
    const commons = [];
    for (const card of legacy.global || []) {
      cards.push(withScope({ ...blank(), ...card }));
      commons.push(card.id);
    }
    for (const channelId of Object.keys(decks)) {
      for (const id of commons) add(channelId, id);
    }
    return { cards, decks };
  }

  // A deck holding a card it cannot send is state the app has no way to show
  // and no way to act on. Older builds could produce it; drop it on the way in
  // rather than carrying it forward.
  function pruneImpossible(cards, decks) {
    const byId = new Map(cards.map((card) => [card.id, card]));
    for (const [channelId, ids] of Object.entries(decks)) {
      decks[channelId] = ids.filter((id) => {
        const card = byId.get(id);
        return card && usableOn(card, channelId);
      });
    }
  }

  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch (_) {
      return false;
    }
  };

  async function read() {
    if (!alive()) return null;

    let raw;
    try {
      raw = await chrome.storage.local.get(Object.values(KEYS));
    } catch (_) {
      return null;
    }

    // Read-only. Migration happens in memory and is persisted by the first
    // operation the worker runs — a page context writing here would bypass the
    // queue and could land after a worker mutation, erasing it.
    const { cards, decks } = migrate(raw);
    pruneImpossible(cards, decks);

    return {
      // On the way out as well as the way in. A replace import writes the
      // file's settings wholesale, and storage can also be edited by hand or
      // written by a build that allowed something this one does not.
      settings: { ...DEFAULT_SETTINGS, ...cleanSettings(raw[KEYS.SETTINGS]) },
      cards,
      decks,
      channelMeta: raw[KEYS.CHANNELS] || {}
    };
  }

  async function write(patch) {
    if (!alive()) return false;
    try {
      await chrome.storage.local.set(patch);
      return true;
    } catch (_) {
      return false;
    }
  }

  // Cards and decks refer to each other, so they are written in one operation.
  // Split across two, a failure between them leaves cards whose scope has been
  // stripped with no deck map to replace it — the next migration then reads
  // every card as global and persists an empty deck map, losing every
  // membership for good.
  const save = (data) => write({ [KEYS.CARDS]: data.cards, [KEYS.DECKS]: data.decks });

  const writeChannelMeta = (channelMeta) => write({ [KEYS.CHANNELS]: channelMeta });

  /* ---------- decks ---------- */

  const byId = (data) => new Map(data.cards.map((card) => [card.id, card]));

  // Ids that no longer resolve are dropped rather than rendered as blanks.
  function deckOf(data, channelId) {
    if (!channelId) return [];
    const lookup = byId(data);
    return (data.decks[channelId] || []).map((id) => lookup.get(id)).filter(Boolean);
  }

  const GLOBAL = "global";

  // Member emoji only send on the channel that hands them out, so a card
  // carrying them can only be that channel's. Everything else is the user's
  // choice, which is why scope is stored rather than read back off the tokens.
  // tokens.js loads after this file, so the lookup is deferred to call time.
  function forcedScope(tokenList) {
    const required = OD.tokens?.requiredChannels?.(tokenList) || [];
    return required.length === 1 ? required[0] : null;
  }

  // The forced scope wins. A stored value can be wrong — an old build, a
  // hand-edited backup — and a member-emoji card marked global would be
  // offered in every pool and sent nowhere.
  const scopeOf = (card) => forcedScope(card.tokens) || card.scope || GLOBAL;

  // A universal card belongs to every channel; a channel-only one to just its own.
  function usableOn(card, channelId) {
    const scope = scopeOf(card);
    return scope === GLOBAL || (!!channelId && scope === channelId);
  }

  // What a card may be set to: forced when it carries member emoji, otherwise
  // either.
  function allowedScope(tokenList, wanted, channelId) {
    const forced = forcedScope(tokenList);
    if (forced) return forced;
    return wanted && wanted !== GLOBAL ? channelId || GLOBAL : GLOBAL;
  }

  // Everything this channel could ever hold: universal cards plus its own
  // member cards. Stable whatever is in the deck, which is what makes it a
  // pool rather than a leftovers list.
  const compatibleWith = (data, channelId) =>
    data.cards.filter((card) => usableOn(card, channelId));

  // The subset it could still take — used where offering a card already in the
  // deck would be pointless.
  function poolFor(data, channelId) {
    const held = new Set(data.decks[channelId] || []);
    return compatibleWith(data, channelId).filter((card) => !held.has(card.id));
  }

  // Cards that work anywhere.
  const universal = (data) => data.cards.filter((card) => scopeOf(card) === GLOBAL);

  const inDeck = (data, channelId, cardId) =>
    (data.decks[channelId] || []).includes(cardId);

  // The caller is a UI that may have been looking at a stale list: the card can
  // have been deleted, or edited into something this channel cannot send.
  function addToDeck(data, channelId, cardId) {
    if (!channelId || inDeck(data, channelId, cardId)) return false;
    const card = data.cards.find((c) => c.id === cardId);
    if (!card || !usableOn(card, channelId)) return false;
    (data.decks[channelId] ||= []).push(cardId);
    return true;
  }

  // Leaving a deck is not deleting: the card stays in the pool.
  function removeFromDeck(data, channelId, cardId) {
    const list = data.decks[channelId];
    const index = list?.indexOf(cardId) ?? -1;
    if (index < 0) return -1;
    list.splice(index, 1);
    return index;
  }

  // Which decks hold this card — so deleting a universal card can say what
  // else it is about to vanish from.
  const decksHolding = (data, cardId) =>
    Object.entries(data.decks)
      .filter(([, ids]) => ids.includes(cardId))
      .map(([channelId]) => channelId);

  // Deleting is from the pool, so it leaves every deck at once.
  function deleteCard(data, cardId) {
    const index = data.cards.findIndex((card) => card.id === cardId);
    if (index < 0) return null;

    const [card] = data.cards.splice(index, 1);
    const memberships = {};
    for (const [channelId, ids] of Object.entries(data.decks)) {
      const at = ids.indexOf(cardId);
      if (at < 0) continue;
      memberships[channelId] = at;
      ids.splice(at, 1);
    }
    return { card, index, memberships };
  }

  function restoreCard(data, { card, index, memberships }) {
    data.cards.splice(Math.min(index, data.cards.length), 0, card);
    for (const [channelId, at] of Object.entries(memberships)) {
      // Undo restores what was deleted, not state that was already impossible.
      if (!usableOn(card, channelId)) continue;
      const list = (data.decks[channelId] ||= []);
      if (list.includes(card.id)) continue;
      list.splice(Math.min(at, list.length), 0, card.id);
    }
  }

  // Removing a deck is not removing its cards: they stay in the pool, and a
  // card that is only usable on that channel stays there too, ready if the
  // deck comes back.
  function deleteDeck(data, channelId) {
    const ids = data.decks[channelId];
    if (!ids) return null;
    delete data.decks[channelId];

    const meta = data.channelMeta[channelId];
    delete data.channelMeta[channelId];

    // Its member cards can belong to no other deck and appear in no other
    // pool, so leaving them behind would strand them: paid for, invisible,
    // impossible to delete. They go with the deck, and undo brings both back.
    const exclusive = [];
    for (let i = data.cards.length - 1; i >= 0; i--) {
      // Only cards scoped to this channel: they can belong nowhere else and
      // appear in no other pool.
      if (scopeOf(data.cards[i]) !== channelId) continue;

      const card = data.cards[i];
      // Older state — or an imported backup — can have filed this card under a
      // channel that cannot send it. Clearing only this deck would leave that
      // reference pointing at a card that no longer exists.
      const strays = {};
      for (const [other, list] of Object.entries(data.decks)) {
        const at = list.indexOf(card.id);
        if (at < 0) continue;
        strays[other] = at;
        list.splice(at, 1);
      }

      exclusive.unshift({ card, index: i, strays });
      data.cards.splice(i, 1);
    }

    return { channelId, ids, meta, exclusive };
  }

  function restoreDeck(data, { channelId, ids, meta, exclusive }) {
    // Only fill in metadata nobody has set since; the deck may have been
    // recreated and renamed or recoloured while undo was still on screen.
    if (data.channelMeta[channelId]) meta = null;
    for (const { card, index, strays } of exclusive || []) {
      data.cards.splice(Math.min(index, data.cards.length), 0, card);
      for (const [other, at] of Object.entries(strays || {})) {
        // These were references a deck could never send. Deleting the deck
        // cleared them; undo brings the cards back, not the broken references.
        if (!usableOn(card, other)) continue;
        const list = (data.decks[other] ||= []);
        if (!list.includes(card.id)) list.splice(Math.min(at, list.length), 0, card.id);
      }
    }
    data.decks[channelId] = ids;
    if (meta) data.channelMeta[channelId] = meta;
  }

  // Order lives per deck, so the same card can be first here and last there.
  function reorderDeck(data, channelId, movedId, targetId, side) {
    const list = data.decks[channelId];
    if (!list) return false;

    const from = list.indexOf(movedId);
    if (from < 0) return false;

    list.splice(from, 1);
    let to = list.indexOf(targetId);
    if (to < 0) to = list.length;
    list.splice(side === "after" ? to + 1 : to, 0, movedId);
    return true;
  }

  /* ---------- ordering for display ---------- */

  function score(card, channelId, now) {
    const count = countOn(card, channelId);
    return count.heat * decay(now - count.lastUsedAt);
  }

  function sortCards(cards, sortBy, channelId) {
    if (sortBy === "manual") return cards.slice();
    if (sortBy === "uses") {
      return cards.slice()
        .sort((a, b) => countOn(b, channelId).uses - countOn(a, channelId).uses);
    }
    const now = Date.now();
    return cards.slice().sort((a, b) => score(b, channelId, now) - score(a, channelId, now));
  }

  function markUsed(card, channelId) {
    if (!channelId) return card;
    const now = Date.now();
    const count = { ...countOn(card, channelId) };
    count.heat = count.heat * decay(now - (count.lastUsedAt || now)) + 1;
    count.lastUsedAt = now;
    count.uses += 1;
    card.by = { ...(card.by || {}), [channelId]: count };
    return card;
  }

  /* ---------- mutations ---------- */

  // Every change is a named operation applied to freshly-read state. Two
  // contexts can both finish read() before either writes, and the loser's
  // change is simply gone — so nobody writes directly. The service worker
  // runs these one at a time (background.js), which is the only place in the
  // extension where ordering can be guaranteed.
  const OPS = {
    addCard(data, { card, channelId, scope }) {
      // A card whose emoji come from two channels can be sent nowhere, and no
      // pool would ever show it.
      if (OD.tokens.requiredChannels(card.tokens).length > 1) return false;

      // The user picks universal or channel-only; member emoji override that,
      // because such a card physically cannot be sent elsewhere.
      card.scope = allowedScope(card.tokens, scope, channelId);
      if (card.scope !== GLOBAL && card.scope !== channelId) return false;

      // Two fast saves, or two tabs, can both decide there is no duplicate.
      // Only here is that decision made against settled state.
      //
      // The same wording is not the same card. One tied to another channel
      // cannot be sent here, so calling it a duplicate reported the save as
      // handled while putting nothing in this deck — the same mistake
      // loadPreset was fixed for, made again one function away.
      const key = OD.tokens.cardKey(card.tokens);
      const existing = data.cards.find(
        (c) => OD.tokens.cardKey(c.tokens) === key && usableOn(c, channelId));
      if (existing) {
        // The existing card keeps its own scope — silently re-scoping it would
        // change what every other deck holding it can do. Report what it is so
        // the caller can say why the chosen kind was not applied.
        const added = channelId ? addToDeck(data, channelId, existing.id) : false;
        return {
          id: existing.id,
          duplicate: true,
          added,
          scope: scopeOf(existing),
          wanted: allowedScope(card.tokens, scope, channelId)
        };
      }

      data.cards.push(card);
      if (channelId) addToDeck(data, channelId, card.id);
      return { id: card.id, duplicate: false };
    },

    // A preset is a starting hand, so it never replaces anything. A card
    // already in the pool is reused rather than copied — two cards with the
    // same words would both answer to the same reaction — and one already in
    // the deck is left where it is.
    loadPreset(data, { channelId, cards, name }) {
      if (!channelId || !Array.isArray(cards) || !cards.length) return false;

      // Several cards can share one wording — a universal one and a
      // channel-only one, say — so a key maps to all of them, and the one that
      // can be played here is chosen. Keeping only the last meant an
      // incompatible card could hide a perfectly good one behind it.
      const byKey = new Map();
      for (const card of data.cards) {
        const key = OD.tokens.cardKey(card.tokens);
        (byKey.get(key) || byKey.set(key, []).get(key)).push(card);
      }

      let added = 0;
      let reused = 0;

      for (const card of cards) {
        // A preset can carry this channel's member emoji — its readers watch
        // the same streamer — but nobody else's, and a hand-edited one might
        // try. Anything that cannot be sent here is not loaded here.
        const required = OD.tokens.requiredChannels(card.tokens);
        if (required.length && !required.every((id) => id === channelId)) continue;

        const key = OD.tokens.cardKey(card.tokens);
        const family = byKey.get(key) || [];

        // Same words is not the same card. One tied to another channel cannot
        // be played here, so reusing it put nothing in the deck while the
        // operation still reported the card as handled.
        const existing = family.find((held) => usableOn(held, channelId));
        if (existing) {
          reused += 1;
          addToDeck(data, channelId, existing.id);
          continue;
        }

        data.cards.push(card);
        family.push(card);
        byKey.set(key, family);
        added += 1;
        addToDeck(data, channelId, card.id);
      }

      // Saving a card is what usually teaches us a channel's name. A deck that
      // begins with a preset never saves one, and would be listed by raw id —
      // so the name rides along, and the two are one action rather than two
      // that can come apart.
      if (name) {
        const existing = data.channelMeta[channelId] || {};
        data.channelMeta[channelId] = {
          hue: existing.hue ?? defaultHue(channelId),
          name: existing.name || name
        };
      }

      return { added, reused };
    },

    editCard(data, { id, tokens }) {
      const card = data.cards.find((c) => c.id === id);
      if (!card) return false;
      if (OD.tokens.requiredChannels(tokens).length > 1) return false;
      card.tokens = tokens;
      // An edit can add member emoji, which pins a previously universal card.
      card.scope = allowedScope(tokens, card.scope, card.scope);
      // Editing can add member emoji, which pins the card to one channel.
      for (const channelId of Object.keys(data.decks)) {
        if (!usableOn(card, channelId)) removeFromDeck(data, channelId, id);
      }
      return true;
    },

    markUsed(data, { id, channelId }) {
      const card = data.cards.find((c) => c.id === id);
      if (card) markUsed(card, channelId);
      return !!card;
    },

    addToDeck: (data, { channelId, cardId }) => addToDeck(data, channelId, cardId),

    removeFromDeck: (data, { channelId, cardId }) =>
      removeFromDeck(data, channelId, cardId),

    // Put a card back where it was, tolerating whatever happened meanwhile:
    // the other surface may have re-added it, or deleted it outright.
    insertIntoDeck(data, { channelId, cardId, at }) {
      const card = data.cards.find((c) => c.id === cardId);
      // It may have been deleted, or edited into a card this channel cannot
      // send, while the undo button was still on screen.
      if (!card || !usableOn(card, channelId)) return false;

      const list = (data.decks[channelId] ||= []);
      if (list.includes(cardId)) return true;
      list.splice(Math.min(at ?? list.length, list.length), 0, cardId);
      return true;
    },

    // Add and position in one operation. Split across two messages, a failure
    // between them left the card appended while the caller reported success.
    addToDeckAt(data, { channelId, cardId, targetId, side }) {
      if (!addToDeck(data, channelId, cardId)) return false;
      if (targetId && targetId !== cardId) {
        reorderDeck(data, channelId, cardId, targetId, side || "before");
      }
      return true;
    },

    reorderDeck: (data, { channelId, movedId, targetId, side }) =>
      reorderDeck(data, channelId, movedId, targetId, side),

    deleteCard: (data, { id }) => deleteCard(data, id),

    // Answered by the worker, so the page cannot decide from a snapshot taken
    // before the other surface changed something.
    decksHolding: (data, { id }) => decksHolding(data, id),
    restoreCard: (data, { snapshot }) => (restoreCard(data, snapshot), true),

    deleteDeck: (data, { channelId }) => deleteDeck(data, channelId),

    // Merge rather than overwrite. The deck can have been recreated during the
    // undo window, and assigning the captured list back would silently drop
    // everything added since — so the current list is read first and folded in.
    restoreDeck(data, { snapshot }) {
      const since = [...(data.decks[snapshot.channelId] || [])];
      restoreDeck(data, snapshot);

      const byId = new Map(data.cards.map((c) => [c.id, c]));
      const seen = new Set();
      data.decks[snapshot.channelId] = [...snapshot.ids, ...since].filter((id) => {
        const card = byId.get(id);
        if (seen.has(id) || !card || !usableOn(card, snapshot.channelId)) return false;
        seen.add(id);
        return true;
      });
      return true;
    },

    // Changing scope can strand a card: made channel-only, it leaves every
    // other deck, since those decks could no longer send it.
    setScope(data, { id, scope, channelId }) {
      const card = data.cards.find((c) => c.id === id);
      if (!card) return false;

      const next = allowedScope(card.tokens, scope, channelId);
      if (next !== GLOBAL && next !== channelId) return false;

      const dropped = {};
      card.scope = next;
      for (const [deckId, list] of Object.entries(data.decks)) {
        if (usableOn(card, deckId)) continue;
        const at = list.indexOf(id);
        if (at < 0) continue;
        dropped[deckId] = at;
        list.splice(at, 1);
      }
      return { scope: next, dropped };
    },

    // Settings were the last thing writing storage from a page, which a
    // replace import could race.
    setSettings(data, { patch }) {
      data.settings = { ...data.settings, ...cleanSettings(patch) };
      return data.settings;
    },

    setChannel(data, { channelId, hue, name }) {
      const existing = data.channelMeta[channelId] || {};
      data.channelMeta[channelId] = {
        hue: hue ?? existing.hue ?? defaultHue(channelId),
        name: name || existing.name || ""
      };
      return true;
    },

    // Computed here, not by the caller. Merging against a snapshot read before
    // the queue and then writing the result wholesale would roll back anything
    // that committed in between.
    importBackup(data, { raw, mode }) {
      const next = mode === "replace"
        ? OD.backup.replace(raw)
        : OD.backup.merge(data, raw);

      data.cards = next.cards;
      data.decks = next.decks;
      data.channelMeta = next.channelMeta;
      if (mode === "replace" && next.settings) data.settings = next.settings;

      return { count: next.cards.length, added: next.added, linked: next.linked };
    }
  };

  // Operations that deliberately replace the settings object.
  const writesSettings = new Set(["importBackup", "setSettings"]);
  const readOnly = new Set(["decksHolding"]);

  // Runs inside the service worker only.
  async function runOp(name, args) {
    const op = OPS[name];
    if (!op) throw new Error(`unknown op: ${name}`);

    const data = await read();
    if (!data) return { ok: false };

    const value = op(data, args || {});
    if (value === false) return { ok: false, value };
    // A question, not a change: answering it should not rewrite storage.
    if (readOnly.has(name)) return { ok: true, value };

    const patch = {
      [KEYS.CARDS]: data.cards,
      [KEYS.DECKS]: data.decks,
      [KEYS.CHANNELS]: data.channelMeta
    };
    // read() always returns settings, so writing them unconditionally would
    // let any card operation roll back a setting changed in between. Only an
    // operation that deliberately replaces them says so — and then they ride
    // the same write, which is what makes a restore all-or-nothing.
    if (writesSettings.has(name)) patch[KEYS.SETTINGS] = data.settings;

    return { ok: await write(patch), value };
  }

  // Called from the page contexts.
  async function apply(name, args) {
    if (!alive()) return { ok: false };
    try {
      const reply = await chrome.runtime.sendMessage({ type: "mutate", op: name, args });
      return reply || { ok: false };
    } catch (_) {
      return { ok: false };
    }
  }

  OD.store = {
    OPS, runOp, apply,
    KEYS, GLOBAL, DEFAULT_SETTINGS, alive,
    HUES, OSHI_HUES, defaultHue, hueOfColor, hueFromHex, hexOfHue,
    TUNING, tuning,
    scopeOf, allowedScope,
    read,
    deckOf, poolFor, compatibleWith, universal, usableOn, inDeck, decksHolding,
    addToDeck, removeFromDeck,
    deleteCard, restoreCard, deleteDeck, restoreDeck, reorderDeck,
    sortCards, markUsed, countOn
  };
})();
