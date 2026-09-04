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
    if (!fresh && cards.length) {
      await write(KEYS.CARDS, cards); // legacy keys are left as a backup
      await write(KEYS.DECKS, decks);
    }

    return {
      settings: { ...DEFAULT_SETTINGS, ...(raw[KEYS.SETTINGS] || {}) },
      cards,
      decks,
      channelMeta: raw[KEYS.CHANNELS] || {}
    };
  }

  async function write(key, value) {
    if (!alive()) return false;
    try {
      await chrome.storage.local.set({ [key]: value });
      return true;
    } catch (_) {
      return false;
    }
  }

  const save = async (data) =>
    (await write(KEYS.CARDS, data.cards)) && (await write(KEYS.DECKS, data.decks));

  const writeChannelMeta = (channelMeta) => write(KEYS.CHANNELS, channelMeta);

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

  // Cards this deck could still take: not already in it, and actually sendable
  // on this channel.
  function poolFor(data, channelId) {
    const held = new Set(data.decks[channelId] || []);
    return data.cards.filter((card) => !held.has(card.id) && usableOn(card, channelId));
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

  OD.store = {
    KEYS, DEFAULT_SETTINGS, alive, defaultHue,
    read, save, writeChannelMeta,
    deckOf, poolFor, universal, usableOn, inDeck, addToDeck, removeFromDeck,
    deleteCard, restoreCard, reorderDeck,
    sortCards, markUsed
  };
})();
