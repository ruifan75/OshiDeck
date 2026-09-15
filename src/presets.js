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

  const FORMAT = 2;

  // Where a preset card belongs. "channel" means whichever channel it is
  // loaded into — a preset cannot know, and must not guess.
  const SCOPES = new Set(["global", "channel"]);

  const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

  // Two kinds of preset, and the difference is whether it names a channel.
  //
  // Without one it is portable: anyone's empty deck can take it, so it can
  // carry nothing that only works in one place.
  //
  // With one it is that channel's — and then its member emoji can travel,
  // because the people it is being handed to are watching the same streamer
  // and may well be members too. Leaving them out was reasoning from the
  // portable kind alone: it dropped exactly the part of a deck that took the
  // longest to build.
  const offeredOn = (preset, channelId) => !preset?.channel || preset.channel === channelId;

  function fromDeck(data, channelId, { name, note } = {}) {
    const held = data.decks[channelId] || [];
    const byId = new Map(data.cards.map((card) => [card.id, card]));

    const cards = [];
    let bound = false;
    for (const id of held) {
      const card = byId.get(id);
      if (!card) continue;
      // Someone else's member emoji cannot be sent on this channel either, so
      // they are not this deck's to hand on.
      const required = OD.tokens.requiredChannels(card.tokens);
      if (required.length && !required.every((id) => id === channelId)) continue;
      if (required.length) bound = true;
      cards.push({
        tokens: card.tokens,
        scope: OD.store.scopeOf(card) === OD.store.GLOBAL ? "global" : "channel"
      });
    }

    return {
      format: FORMAT,
      name: name || "",
      note: note || "",
      // Only when it has to be. A preset that names a channel is offered
      // nowhere else, and most decks have no reason to be that narrow.
      ...(bound ? { channel: channelId } : {}),
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
    if (raw.channel !== undefined && !CHANNEL_ID.test(raw.channel)) {
      return `channel が不正です: ${raw.channel}`;
    }

    const seen = new Set();
    for (const card of raw.cards) {
      if (!card || typeof card !== "object") return "札のデータが壊れています";
      if (!Array.isArray(card.tokens)) return "札に tokens がありません";
      if (!OD.tokens.hasSubstance(card.tokens)) return "中身のない札があります";
      if (!SCOPES.has(card.scope)) return `scope が不正です: ${card.scope}`;

      // Member emoji may travel, but only inside a preset that says whose
      // they are — otherwise it would be offered to decks that can never
      // send them.
      const required = OD.tokens.requiredChannels(card.tokens);
      if (required.length > 1) return "複数のチャンネルのメン限スタンプが混ざっています";
      if (required.length && !raw.channel) {
        return "メン限スタンプを入れるには channel が要ります";
      }
      if (required.length && required[0] !== raw.channel) {
        return `よそのチャンネルのメン限スタンプが入っています: ${required[0]}`;
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

  OD.presets = { FORMAT, SCOPES, CHANNEL_ID, offeredOn, fromDeck, validate, cardsFor };
})();
