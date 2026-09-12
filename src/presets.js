// A preset deck: a starting hand for a channel nobody has played yet.
//
// Not a backup. A backup restores one person's whole state — ids, use counts,
// which decks hold what, settings — and is meant to go back to the person it
// came from. A preset is content alone: what to say, and whether it belongs
// anywhere or only to the channel it is loaded into. Ids and counts are made
// fresh on load, because two people loading the same preset must not end up
// sharing a card id.
//
// Making one is the same gesture as using one: export a deck you like, drop
// the file into presets/, and it is a preset. `tools/add-preset.mjs` does the
// dropping-in, so the whole trip is one command.
(() => {
  const OD = (globalThis.OshiDeck ||= {});

  const FORMAT = 1;

  // Where a preset card belongs. "channel" means whichever channel it is
  // loaded into — a preset cannot know, and must not guess.
  const SCOPES = new Set(["global", "channel"]);

  // A deck, as content. Member emoji are left out: they belong to the channel
  // that issues them and are unusable anywhere else, so carrying one into a
  // preset would ship a card that can never be played.
  function fromDeck(data, channelId, { name, note } = {}) {
    const held = data.decks[channelId] || [];
    const byId = new Map(data.cards.map((card) => [card.id, card]));

    const cards = [];
    for (const id of held) {
      const card = byId.get(id);
      if (!card) continue;
      if (OD.tokens.requiredChannels(card.tokens).length) continue;
      cards.push({
        tokens: card.tokens,
        scope: OD.store.scopeOf(card) === OD.store.GLOBAL ? "global" : "channel"
      });
    }

    return {
      format: FORMAT,
      name: name || "",
      note: note || "",
      cards
    };
  }

  // Returns an error string, or null when the preset is usable. A preset is
  // read from the extension's own files, but it is also hand-edited, and a
  // broken one must say so rather than half-load.
  function validate(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return "JSONオブジェクトではありません";
    }
    if (raw.format && raw.format > FORMAT) {
      return `新しい形式（format ${raw.format}）です`;
    }
    if (typeof raw.name !== "string" || !raw.name.trim()) return "name がありません";
    if (!Array.isArray(raw.cards) || !raw.cards.length) return "cards が空です";

    const seen = new Set();
    for (const card of raw.cards) {
      if (!card || typeof card !== "object") return "札のデータが壊れています";
      if (!Array.isArray(card.tokens)) return "札に tokens がありません";
      if (!OD.tokens.hasSubstance(card.tokens)) return "中身のない札があります";
      if (!SCOPES.has(card.scope)) return `scope が不正です: ${card.scope}`;
      if (OD.tokens.requiredChannels(card.tokens).length) {
        return "メン限スタンプはプリセットに入れられません";
      }

      const key = OD.tokens.cardKey(card.tokens);
      if (seen.has(key)) return "同じ内容の札が二度入っています";
      seen.add(key);
    }
    return null;
  }

  // Ready for the worker to add: fresh ids, no history, and the scope resolved
  // against the channel this is being loaded into.
  function cardsFor(preset, channelId) {
    return (preset.cards || []).map((card) => ({
      id: crypto.randomUUID(),
      tokens: card.tokens,
      scope: card.scope === "channel" && channelId ? channelId : OD.store.GLOBAL,
      createdAt: Date.now(),
      uses: 0,
      heat: 0,
      lastUsedAt: 0
    }));
  }

  OD.presets = { FORMAT, SCOPES, fromDeck, validate, cardsFor };
})();
