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
    sortBy: "heat"     // manual | uses | heat | trend
  };

  const HALF_LIFE = 7 * 24 * 60 * 60 * 1000;
  const decay = (ms) => Math.pow(0.5, Math.max(0, ms) / HALF_LIFE);

  const HUES = [320, 145, 250, 85, 25, 195, 290, 60];
  function defaultHue(channelId) {
    let h = 0;
    for (const ch of String(channelId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return HUES[h % HUES.length];
  }

  const blank = () => ({ uses: 0, heat: 0, lastUsedAt: 0, createdAt: Date.now() });

  // A card lives in the pool once. A deck is an ordered list of ids drawn from
  // it, so the same card can sit in several decks and hold a different place
  // in each — which a single shared ordering could never express.
  function migrate(raw) {
    if (Array.isArray(raw[KEYS.CARDS]) && raw[KEYS.DECKS]) {
      return {
        cards: raw[KEYS.CARDS].map((card) => ({ ...blank(), ...card })),
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
        const { scope, ...rest } = card;
        cards.push({ ...blank(), ...rest });
        if (scope && scope !== "global") add(scope, card.id);
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
        cards.push({ ...blank(), ...card });
        add(channelId, card.id);
      }
    }
    const commons = [];
    for (const card of legacy.global || []) {
      cards.push({ ...blank(), ...card });
      commons.push(card.id);
    }
    for (const channelId of Object.keys(decks)) {
      for (const id of commons) add(channelId, id);
    }
    return { cards, decks };
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

    const { cards, decks } = migrate(raw);
    const fresh = Array.isArray(raw[KEYS.CARDS]) && !!raw[KEYS.DECKS];
    // Legacy keys are left in place as a backup.
    if (!fresh && cards.length) await save({ cards, decks });

    return {
      settings: { ...DEFAULT_SETTINGS, ...(raw[KEYS.SETTINGS] || {}) },
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

  // A card carrying member emoji only sends on the channel that hands them
  // out, so offering it anywhere else is offering something that cannot work.
  // tokens.js loads after this file, so the lookup is deferred to call time.
  function usableOn(card, channelId) {
    const required = OD.tokens?.requiredChannels?.(card.tokens) || [];
    return !required.length || (!!channelId && required.every((id) => id === channelId));
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

  // Cards that work anywhere — the pool proper, with nothing channel-bound.
  const universal = (data) => data.cards.filter((card) => usableOn(card, null));

  const inDeck = (data, channelId, cardId) =>
    (data.decks[channelId] || []).includes(cardId);

  function addToDeck(data, channelId, cardId) {
    if (!channelId || inDeck(data, channelId, cardId)) return false;
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
      const list = (data.decks[channelId] ||= []);
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
      if (usableOn(data.cards[i], null)) continue;
      if (!usableOn(data.cards[i], channelId)) continue;

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
    for (const { card, index, strays } of exclusive || []) {
      data.cards.splice(Math.min(index, data.cards.length), 0, card);
      for (const [other, at] of Object.entries(strays || {})) {
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

  function score(card, now) {
    return (card.heat || 0) * decay(now - (card.lastUsedAt || 0));
  }

  function sortCards(cards, sortBy) {
    if (sortBy === "manual") return cards.slice();
    if (sortBy === "uses") {
      return cards.slice().sort((a, b) => (b.uses || 0) - (a.uses || 0));
    }
    const now = Date.now();
    return cards.slice().sort((a, b) => score(b, now) - score(a, now));
  }

  function markUsed(card) {
    const now = Date.now();
    card.heat = (card.heat || 0) * decay(now - (card.lastUsedAt || now)) + 1;
    card.lastUsedAt = now;
    card.uses = (card.uses || 0) + 1;
    return card;
  }

  /* ---------- mutations ---------- */

  // Every change is a named operation applied to freshly-read state. Two
  // contexts can both finish read() before either writes, and the loser's
  // change is simply gone — so nobody writes directly. The service worker
  // runs these one at a time (background.js), which is the only place in the
  // extension where ordering can be guaranteed.
  const OPS = {
    addCard(data, { card, channelId }) {
      data.cards.push(card);
      if (channelId) addToDeck(data, channelId, card.id);
      return card.id;
    },

    editCard(data, { id, tokens }) {
      const card = data.cards.find((c) => c.id === id);
      if (!card) return false;
      card.tokens = tokens;
      // Editing can add member emoji, which pins the card to one channel.
      for (const channelId of Object.keys(data.decks)) {
        if (!usableOn(card, channelId)) removeFromDeck(data, channelId, id);
      }
      return true;
    },

    markUsed(data, { id }) {
      const card = data.cards.find((c) => c.id === id);
      if (card) markUsed(card);
      return !!card;
    },

    addToDeck: (data, { channelId, cardId }) => addToDeck(data, channelId, cardId),

    removeFromDeck: (data, { channelId, cardId }) =>
      removeFromDeck(data, channelId, cardId),

    // Put a card back where it was, tolerating whatever happened meanwhile:
    // the other surface may have re-added it, or deleted it outright.
    insertIntoDeck(data, { channelId, cardId, at }) {
      if (!data.cards.some((c) => c.id === cardId)) return false;
      const list = (data.decks[channelId] ||= []);
      if (list.includes(cardId)) return true;
      list.splice(Math.min(at ?? list.length, list.length), 0, cardId);
      return true;
    },

    reorderDeck: (data, { channelId, movedId, targetId, side }) =>
      reorderDeck(data, channelId, movedId, targetId, side),

    deleteCard: (data, { id }) => deleteCard(data, id),
    restoreCard: (data, { snapshot }) => (restoreCard(data, snapshot), true),

    deleteDeck: (data, { channelId }) => deleteDeck(data, channelId),

    // Merge rather than overwrite. The deck can have been recreated during the
    // undo window, and assigning the captured list back would silently drop
    // everything added since — so the current list is read first and folded in.
    restoreDeck(data, { snapshot }) {
      const since = [...(data.decks[snapshot.channelId] || [])];
      restoreDeck(data, snapshot);

      const live = new Set(data.cards.map((c) => c.id));
      const seen = new Set();
      data.decks[snapshot.channelId] = [...snapshot.ids, ...since].filter((id) => {
        if (seen.has(id) || !live.has(id)) return false;
        seen.add(id);
        return true;
      });
      return true;
    },

    setChannel(data, { channelId, hue, name }) {
      const existing = data.channelMeta[channelId] || {};
      data.channelMeta[channelId] = {
        hue: hue ?? existing.hue ?? defaultHue(channelId),
        name: name || existing.name || ""
      };
      return true;
    },

    replaceAll(data, { cards, decks, channelMeta }) {
      data.cards = cards;
      data.decks = decks;
      data.channelMeta = channelMeta;
      return true;
    }
  };

  // Runs inside the service worker only.
  async function runOp(name, args) {
    const op = OPS[name];
    if (!op) throw new Error(`unknown op: ${name}`);

    const data = await read();
    if (!data) return { ok: false };

    const value = op(data, args || {});
    const written = await write({
      [KEYS.CARDS]: data.cards,
      [KEYS.DECKS]: data.decks,
      [KEYS.CHANNELS]: data.channelMeta
    });
    return { ok: written, value };
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
    KEYS, DEFAULT_SETTINGS, alive, defaultHue,
    read,
    deckOf, poolFor, compatibleWith, universal, usableOn, inDeck, addToDeck, removeFromDeck,
    deleteCard, restoreCard, deleteDeck, restoreDeck, reorderDeck,
    sortCards, markUsed
  };
})();
