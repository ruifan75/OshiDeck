// Reading and writing backup files.
(() => {
  const OD = (globalThis.OshiDeck ||= {});
  const { cardKey } = OD.tokens;

  // 1: cards had no scope; a reader inferred it from the emoji.
  // 2: scope is authoritative, and a plain card can be channel-only.
  const FORMAT = 2;
  const OLDEST = 1;

  function toPayload(data, appVersion) {
    return {
      format: FORMAT,
      app: "OshiDeck",
      version: appVersion || "",
      exportedAt: new Date().toISOString(),
      cards: data.cards,
      decks: data.decks,
      channelMeta: data.channelMeta,
      settings: data.settings
    };
  }

  // Returns an error string, or null when the file is usable. Nothing is
  // applied unless the whole file passes.
  function validate(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return "JSONオブジェクトではありません";
    }
    if (raw.format && raw.format > FORMAT) {
      return `新しい形式（format ${raw.format}）です。拡張機能を更新してください`;
    }
    if (!Array.isArray(raw.cards)) return "cards が配列ではありません";
    if (raw.decks && (typeof raw.decks !== "object" || Array.isArray(raw.decks))) {
      return "decks の形式が不正です";
    }

    for (const card of raw.cards) {
      if (!card || typeof card !== "object") return "札のデータが壊れています";
      if (typeof card.id !== "string" || !card.id) return "札にidがありません";
      if (!Array.isArray(card.tokens)) return "札に中身がありません";

      // Anything reading these dereferences token.type; a null slips past an
      // Array.isArray check and throws during the merge instead.
      for (const token of card.tokens) {
        if (!token || typeof token !== "object") return `札 ${card.id} に壊れた中身があります`;
        if (token.type === "text") {
          if (typeof token.value !== "string") return `札 ${card.id} のテキストが不正です`;
        } else if (token.type === "youtubeEmoji") {
          if (typeof token.emojiId !== "string" || !token.emojiId) {
            return `札 ${card.id} のスタンプにidがありません`;
          }
        } else {
          return `札 ${card.id} に未知の種類 (${token.type}) があります`;
        }
      }
    }

    // Two cards sharing an id collapse into one on lookup, and a repeated id
    // inside a deck makes every removal ambiguous. Reject rather than import
    // something that cannot be reasoned about afterwards.
    const ids = new Set();
    for (const card of raw.cards) {
      if (ids.has(card.id)) return `同じidの札が2枚あります: ${card.id}`;
      ids.add(card.id);
    }

    for (const [channelId, list] of Object.entries(raw.decks || {})) {
      if (!Array.isArray(list)) return `デッキ ${channelId} が配列ではありません`;
      if (list.some((id) => typeof id !== "string")) return `デッキ ${channelId} に不正なidがあります`;
      if (list.some((id) => !ids.has(id))) return `デッキ ${channelId} が存在しない札を指しています`;
      if (new Set(list).size !== list.length) return `デッキ ${channelId} に同じ札が重複しています`;
    }

    // A card carrying member emoji can only be sent on the channel that issues
    // them. Filed anywhere else it would import as a card that is permanently
    // locked, or that no pool can show — so the file is rejected rather than
    // quietly producing state the app cannot represent.
    // A scope must be "global" or a channel id, and it must not contradict the
    // emoji: a member card marked global would be offered in every pool and
    // sent from none of them.
    const owners = OD.tokens.requiredChannels;
    for (const card of raw.cards) {
      if (card.scope === undefined) continue;
      if (typeof card.scope !== "string" || !card.scope) return `札 ${card.id} の scope が不正です`;
      if (card.scope !== "global" && !/^UC[A-Za-z0-9_-]{22}$/.test(card.scope)) {
        return `札 ${card.id} の scope (${card.scope}) がチャンネルIDではありません`;
      }
      const required = owners(card.tokens);
      if (required.length && card.scope !== required[0]) {
        return `札 ${card.id} は ${required[0]} のメン限スタンプですが scope が ${card.scope} です`;
      }
    }


    // Every card, not just the ones a deck happens to point at: a card mixing
    // two issuers can be sent nowhere and appears in no pool, so importing it
    // would add something invisible and undeletable.
    for (const card of raw.cards) {
      if (owners(card.tokens).length > 1) {
        return `札 ${card.id} が複数チャンネルのメン限スタンプを含んでいます`;
      }
    }

    const byId = new Map(raw.cards.map((card) => [card.id, card]));
    for (const [channelId, list] of Object.entries(raw.decks || {})) {
      for (const id of list) {
        const card = byId.get(id);
        const required = owners(card.tokens);
        if (required.length && required[0] !== channelId) {
          return `札 ${id} は ${required[0]} のメン限スタンプですが ${channelId} のデッキにあります`;
        }
        if (card.scope && card.scope !== "global" && card.scope !== channelId) {
          return `札 ${id} は ${card.scope} 専用ですが ${channelId} のデッキにあります`;
        }
      }
    }
    return null;
  }

  const newId = () =>
    globalThis.crypto?.randomUUID?.() ||
    `card-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

  const clone = (value) => JSON.parse(JSON.stringify(value));

  // Replace is for restoring your own backup, so the usage history comes back
  // with it.
  // Format 1 had no scope field: a card counted as channel-only when it
  // carried member emoji, and as universal otherwise. Deck membership was not
  // ownership — a plain card in one deck still showed in every pool — so it
  // must not be read as ownership now.
  function withScope(raw) {
    return raw.cards.map((card) =>
      card.scope
        ? card
        : { ...card, scope: OD.tokens.requiredChannels(card.tokens)[0] || "global" }
    );
  }

  function replace(incoming) {
    return {
      cards: clone(withScope(incoming)),
      decks: clone(incoming.decks || {}),
      channelMeta: clone(incoming.channelMeta || {}),
      settings: incoming.settings ? clone(incoming.settings) : null
    };
  }

  // Merge is for a file that may be someone else's. Cards are matched by
  // content, not id: the same comment saved on two installs has two different
  // uuids, and importing it twice would otherwise leave you a duplicate.
  const scopeOf = (card) => OD.tokens.requiredChannels(card.tokens)[0] || card.scope || "global";

  function merge(current, incoming) {
    const cards = clone(current.cards);
    const decks = clone(current.decks);
    const channelMeta = { ...current.channelMeta };
    const arriving = withScope(incoming);

    // Keyed by content *and* scope. On content alone, a local "888" scoped to
    // A would absorb an imported global "888", and the imported card's place
    // in B's deck would then point at a card B cannot send.
    const keyOf = (card) => `${scopeOf(card)}\u0000${cardKey(card.tokens)}`;
    const byKey = new Map(cards.map((card) => [keyOf(card), card.id]));
    const taken = new Set(cards.map((card) => card.id));
    const idMap = new Map();

    let added = 0;
    for (const card of arriving) {
      const key = keyOf(card);
      const existing = byKey.get(key);
      if (existing) {
        idMap.set(card.id, existing);
        continue;
      }

      // Someone else's counts are not yours, so an arriving card starts cold.
      const id = taken.has(card.id) ? newId() : card.id;
      // A file written before counts were split still carries the flat ones.
      const { uses, heat, lastUsedAt, ...rest } = clone(card);
      cards.push({ ...rest, id, by: {} });
      taken.add(id);
      byKey.set(key, id);
      idMap.set(card.id, id);
      added++;
    }

    const byId = new Map(cards.map((card) => [card.id, card]));

    let linked = 0;
    for (const [channelId, list] of Object.entries(incoming.decks || {})) {
      const target = (decks[channelId] ||= []);
      for (const id of list) {
        const local = idMap.get(id);
        if (!local || target.includes(local)) continue;

        // Two individually valid states can still combine into an invalid one.
        const card = byId.get(local);
        const scope = card && scopeOf(card);
        if (!card || (scope !== "global" && scope !== channelId)) continue;

        target.push(local);
        linked++;
      }
    }

    // Names and colours you already chose win over the ones in the file.
    for (const [channelId, meta] of Object.entries(incoming.channelMeta || {})) {
      if (!channelMeta[channelId]) channelMeta[channelId] = clone(meta);
    }

    return { cards, decks, channelMeta, added, linked };
  }

  const summarise = (raw) => ({
    cards: raw.cards.length,
    decks: Object.keys(raw.decks || {}).length,
    exportedAt: raw.exportedAt || null
  });

  OD.backup = { FORMAT, toPayload, validate, replace, merge, summarise };
})();
