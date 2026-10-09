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

  // Returns [message key, ...arguments], or null when the preset is usable.
  // i18n.t translates it at display time. Presets can also be hand-edited,
  // and a broken one must say so rather than half-load.
  // A card has to be a card before anything can be asked about it. These
  // checks ran straight into cardKey and requiredChannels, so a `tokens:
  // [null]` threw out of the validator instead of being reported — and
  // background.js catches around the whole bundled file, so one bad preset
  // discarded all 262.
  const shapedCard = (card) =>
    !!card && typeof card === "object" &&
    Array.isArray(card.tokens) && card.tokens.length > 0 &&
    card.tokens.every((token) =>
      !!token && typeof token === "object" &&
      (token.type === "text" ? typeof token.value === "string"
        : token.type === "youtubeEmoji" ? typeof token.emojiId === "string" && !!token.emojiId
          : false));

  function validate(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return ["validation.notObject"];
    }
    if (raw.format && raw.format > FORMAT) {
      return ["validation.newPresetFormat", raw.format];
    }
    if (typeof raw.name !== "string" || !raw.name.trim()) return ["validation.presetNameMissing"];
    if (!Array.isArray(raw.cards) || !raw.cards.length) return ["validation.presetCardsEmpty"];
    if (raw.channel !== undefined && !CHANNEL_ID.test(raw.channel)) {
      return ["validation.presetChannelInvalid", raw.channel];
    }

    const seen = new Set();
    for (const card of raw.cards) {
      if (!card || typeof card !== "object") return ["validation.cardInvalid"];
      if (!Array.isArray(card.tokens)) return ["validation.presetTokensMissing"];
      // Before anything reads them: a token that is not a token threw out of
      // this function rather than being reported, and one bad preset in the
      // bundled file discarded all of them.
      if (!shapedCard(card)) return ["validation.presetTokensMissing"];
      if (!OD.tokens.hasSubstance(card.tokens)) return ["validation.presetCardEmpty"];
      if (!SCOPES.has(card.scope)) return ["validation.presetScopeInvalid", card.scope];

      // Member emoji may travel, but only inside a preset that says whose
      // they are — otherwise it would be offered to decks that can never
      // send them.
      const required = OD.tokens.requiredChannels(card.tokens);
      if (required.length > 1) return ["validation.presetMixedChannels"];
      if (required.length && !raw.channel) {
        return ["validation.presetChannelMissing"];
      }
      if (required.length && required[0] !== raw.channel) {
        return ["validation.presetEmojiChannel", required[0]];
      }

      // Scope is part of what a card is, as it is everywhere else here: a
      // deck may legitimately hold the same wording twice, once for anyone
      // and once tied to this channel, and loadPreset chooses between them by
      // what can be sent. Ignoring it meant an ordinary deck could not be
      // exported at all — fromDeck wrote both and validate refused its own
      // output.
      const key = `${card.scope === "channel" ? "channel" : "global"}\u0000${OD.tokens.cardKey(card.tokens)}`;
      if (seen.has(key)) return ["validation.presetCardDuplicate"];
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
      by: {}
    }));
  }

  OD.presets = { FORMAT, SCOPES, CHANNEL_ID, offeredOn, fromDeck, validate, cardsFor };
})();
