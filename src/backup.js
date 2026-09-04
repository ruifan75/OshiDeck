// Reading and writing backup files.
(() => {
  const OD = (globalThis.OshiDeck ||= {});
  const { cardKey } = OD.tokens;

  const FORMAT = 1;

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
    const owners = OD.tokens.requiredChannels;
    const byId = new Map(raw.cards.map((card) => [card.id, card]));
    for (const [channelId, list] of Object.entries(raw.decks || {})) {
      for (const id of list) {
        const required = owners(byId.get(id).tokens);
        if (!required.length) continue;
        if (required.length > 1) return `札 ${id} が複数チャンネルのメン限スタンプを含んでいます`;
        if (required[0] !== channelId) {
          return `札 ${id} は ${required[0]} のメン限スタンプですが ${channelId} のデッキにあります`;
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
  function replace(incoming) {
    return {
      cards: clone(incoming.cards),
      decks: clone(incoming.decks || {}),
      channelMeta: clone(incoming.channelMeta || {}),
      settings: incoming.settings ? clone(incoming.settings) : null
    };
  }

  // Merge is for a file that may be someone else's. Cards are matched by
  // content, not id: the same comment saved on two installs has two different
  // uuids, and importing it twice would otherwise leave you a duplicate.
  function merge(current, incoming) {
    const cards = clone(current.cards);
    const decks = clone(current.decks);
    const channelMeta = { ...current.channelMeta };

    const byKey = new Map(cards.map((card) => [cardKey(card.tokens), card.id]));
    const taken = new Set(cards.map((card) => card.id));
    const idMap = new Map();

    let added = 0;
    for (const card of incoming.cards) {
      const key = cardKey(card.tokens);
      const existing = byKey.get(key);
      if (existing) {
        idMap.set(card.id, existing);
        continue;
      }

      // Someone else's counts are not yours, so an arriving card starts cold.
      const id = taken.has(card.id) ? newId() : card.id;
      cards.push({ ...clone(card), id, uses: 0, heat: 0, lastUsedAt: 0 });
      taken.add(id);
      byKey.set(key, id);
      idMap.set(card.id, id);
      added++;
    }

    let linked = 0;
    for (const [channelId, list] of Object.entries(incoming.decks || {})) {
      const target = (decks[channelId] ||= []);
      for (const id of list) {
        const local = idMap.get(id);
        if (!local || target.includes(local)) continue;
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
