// Presets: a starting hand for a channel nobody has played yet.
//
// The thing to keep straight is that a preset is not a backup. A backup goes
// back to the person it came from and restores everything — ids, counts, which
// decks held what. A preset goes to someone else and carries content alone, so
// two people loading it cannot end up sharing a card id, and a card that only
// works on the channel it was made for cannot travel at all.
globalThis.OshiDeck = {};

const CH = "UCsakura0000000000000000";
const OTHER = "UCyumeno0000000000000000";

let disk = { cards: [], decks: {}, channelMeta: {}, settings: {} };
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => JSON.parse(JSON.stringify(disk)),
  set: async (patch) => { disk = { ...disk, ...JSON.parse(JSON.stringify(patch)) }; }
} } };
globalThis.crypto ??= (await import("node:crypto")).webcrypto;

const src = process.env.OD_PRESETS || "/Users/maintainer/OshiDeck/src/presets.js";
// content.js is read rather than run: it wants a browser, and all that is
// wanted here is the one function that asks the store to load a preset.
const src2 = (await import("node:fs")).readFileSync(
  process.env.OD_SOURCE || "/Users/maintainer/OshiDeck/content.js", "utf8");
await import("/Users/maintainer/OshiDeck/src/tokens.js");
await import("/Users/maintainer/OshiDeck/src/backup.js");
await import(`file://${process.env.OD_STORE || "/Users/maintainer/OshiDeck/src/store.js"}`);
await import(`file://${src}`);
const { store, presets, tokens } = globalThis.OshiDeck;

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

const text = (value) => [{ type: "text", value }];
const stamp = (owner) => [{ type: "youtubeEmoji", emojiId: `${owner}/heart`, alt: ":h:" }];
const card = (id, tokens, scope) =>
  ({ id, tokens, scope, uses: 7, heat: 7, lastUsedAt: 999, createdAt: 1 });

/* ---------- a deck, as something to hand over ---------- */

const data = {
  cards: [
    card("a", text("わこつ"), "global"),
    card("b", text("おかえり"), CH),
    card("c", stamp(CH), CH),
    card("x", stamp(OTHER), OTHER),      // only a hand-edited state can put this here
    card("d", text("使っていない"), "global")
  ],
  decks: { [CH]: ["a", "b", "c", "x"] },
  channelMeta: {},
  settings: {}
};

const made = presets.fromDeck(data, CH, { name: "さくらの定番" });

check("only what is in the deck travels", made.cards.length === 3);
check("in the order the deck had it", made.cards[0].tokens[0].value === "わこつ");

// The reason member emoji used to be dropped was that a preset could not say
// whose they were, so it could be offered anywhere. One that names a channel
// can — and the people it is handed to are watching the same streamer, so
// they may well be members too. Leaving them out threw away the part of a
// deck that takes longest to build.
check("this channel's member emoji travel", made.cards.some((c) => c.tokens.some((t) => t.emojiId)));
check("and the preset says whose they are", made.channel === CH);
check(
  "another channel's are still left behind, since nobody here can send them",
  !made.cards.some((c) => c.tokens.some((t) => (t.emojiId || "").startsWith(OTHER)))
);

// A deck with nothing channel-bound in it stays portable: naming a channel
// would mean it is offered nowhere else, for no reason.
const plain = presets.fromDeck(
  { ...data, decks: { [CH]: ["a", "b"] } }, CH, { name: "どこでも" }
);
check("a deck with no member emoji names no channel", plain.channel === undefined);
check("and still carries its cards", plain.cards.length === 2);

check("a universal card says so", made.cards[0].scope === "global");
check(
  "and a channel-only one says only that it is channel-only",
  made.cards[1].scope === "channel"
);
check(
  "no ids, no counts, no history",
  made.cards.every((c) => !("id" in c) && !("uses" in c) && !("lastUsedAt" in c))
);

/* ---------- where it is offered ---------- */

check("a preset that names a channel is offered there", presets.offeredOn(made, CH));
check("and nowhere else", !presets.offeredOn(made, OTHER));
check("a portable one is offered anywhere", presets.offeredOn(plain, OTHER));
check("even where the channel is not known yet", presets.offeredOn(plain, null));

/* ---------- what will not be handed over ---------- */

check("a good one passes", presets.validate(made) === null);

const broken = (over) => presets.validate({ ...made, ...over });
check("it needs a name", !!broken({ name: "" }));
check("and at least one card", !!broken({ cards: [] }));
check("a card needs tokens", !!broken({ cards: [{ scope: "global" }] }));
check("with something in them", !!broken({ cards: [{ tokens: text("  "), scope: "global" }] }));
check("and a scope it knows", !!broken({ cards: [{ tokens: text("x"), scope: "everywhere" }] }));
check(
  "member emoji from another channel cannot be smuggled in by hand",
  !!broken({ cards: [{ tokens: stamp(OTHER), scope: "channel" }] })
);
// The message matters as much as the refusal: "this needs a channel" is a
// thing the person editing the file can act on, where "someone else's emoji"
// sends them looking for an emoji that is not there. Checking only that it
// said *something* let the two guards cover for each other.
check(
  "nor can they ride in a preset that names nobody",
  (presets.validate({ ...made, channel: undefined }) || "").includes("channel が要ります")
);
check(
  "nor two channels' worth in one card",
  !!broken({ cards: [{ tokens: [...stamp(CH), ...stamp(OTHER)], scope: "channel" }] })
);
check("a channel that is not one is refused", !!broken({ channel: "not-a-channel" }));
check("and the portable kind still needs none", presets.validate(plain) === null);
check(
  "nor can the same card twice",
  !!broken({ cards: [{ tokens: text("x"), scope: "global" }, { tokens: text("x"), scope: "global" }] })
);
check("a newer format is refused rather than half-read", !!broken({ format: 99 }));

/* ---------- loading it ---------- */

const fresh = presets.cardsFor(plain, OTHER);
check("every card arrives with an id of its own", new Set(fresh.map((c) => c.id)).size === 2);
check("and no history on any channel",
  fresh.every((c) => Object.keys(c.by).length === 0));
check("universal stays universal", fresh[0].scope === store.GLOBAL);
check("and channel-only means the channel it is loaded into", fresh[1].scope === OTHER);

// The bound kind, loaded where it belongs.
disk = { cards: [], decks: {}, channelMeta: {}, settings: {} };
await store.runOp("loadPreset", { channelId: CH, cards: presets.cardsFor(made, CH) });
check("loaded on its own channel, the member emoji arrive", disk.cards.length === 3);
check("and are that channel's, since they can be nothing else",
  disk.cards.find((c) => c.tokens.some((t) => t.emojiId))?.scope === CH);

// And the guard behind the offer: hand it to the wrong channel and the part
// that cannot be sent there simply does not arrive.
disk = { cards: [], decks: {}, channelMeta: {}, settings: {} };
await store.runOp("loadPreset", { channelId: OTHER, cards: presets.cardsFor(made, OTHER) });
check("forced onto another channel, only what can be sent there loads",
  disk.cards.length === 2 && !disk.cards.some((c) => c.tokens.some((t) => t.emojiId)));

disk = { cards: [], decks: {}, channelMeta: {}, settings: {} };
let result = await store.runOp("loadPreset", { channelId: OTHER, cards: presets.cardsFor(plain, OTHER) });
check("loading fills the deck", disk.decks[OTHER].length === 2);
check("and the pool with it", disk.cards.length === 2);
check("reporting what it did", result.value.added === 2 && result.value.reused === 0);

// Someone who already says わこつ should not end up with two cards that do.
disk = {
  cards: [card("mine", text("わこつ"), "global")],
  decks: { [OTHER]: [] },
  channelMeta: {},
  settings: {}
};
result = await store.runOp("loadPreset", { channelId: OTHER, cards: presets.cardsFor(plain, OTHER) });
check("a card already in the pool is reused, not copied", disk.cards.length === 2);
check("and it is the one that was already there", disk.decks[OTHER].includes("mine"));
check("counted as reused", result.value.reused === 1 && result.value.added === 1);

// Same words, but tied to a channel this is not being loaded into. Reusing it
// put nothing in the deck while the operation reported the card as handled.
disk = {
  cards: [card("theirs", text("わこつ"), CH)],
  decks: { [OTHER]: [] },
  channelMeta: {},
  settings: {}
};
result = await store.runOp("loadPreset", { channelId: OTHER, cards: presets.cardsFor(plain, OTHER) });
check(
  "a card that only works on another channel is not treated as a match",
  disk.decks[OTHER].length === 2
);
check("so nothing is quietly dropped", result.value.added === 2 && result.value.reused === 0);

// Two cards can say the same words — one universal, one tied to a channel —
// and only the shape of the pool decides which comes last. Keeping only the
// last of them hid a perfectly usable card behind one that could not be
// played here, and made a third card nobody asked for.
disk = {
  cards: [card("mine", text("わこつ"), "global"), card("theirs", text("わこつ"), CH)],
  decks: { [OTHER]: [] },
  channelMeta: {},
  settings: {}
};
result = await store.runOp("loadPreset", { channelId: OTHER, cards: presets.cardsFor(plain, OTHER) });
check(
  "a usable card is found even behind one that is not",
  disk.cards.length === 3 && disk.decks[OTHER].includes("mine")
);

// A deck that begins with a preset never saves a card, and saving a card is
// what usually teaches us a channel's name — so the builder listed it by raw
// id. The name travels with the load rather than in an op of its own, which
// could be interrupted between the two.
disk = { cards: [], decks: {}, channelMeta: {}, settings: {} };
await store.runOp("loadPreset", {
  channelId: OTHER, name: "ゆめの", cards: presets.cardsFor(plain, OTHER)
});
check("loading a preset also names the channel", disk.channelMeta[OTHER]?.name === "ゆめの");
check("and gives it a colour to be shown in", typeof disk.channelMeta[OTHER]?.hue === "number");

// What the panel actually asks for. Everything above drives the op directly,
// so the op could be right while the call that reaches it left something out —
// which is exactly what happened to the name.
const useFrom = src2.indexOf("  async function usePreset(preset, channel) {");
const useTo = src2.indexOf("  /* ---------- wiring ---------- */", useFrom);
if (useFrom < 0 || useTo < 0 || useTo <= useFrom) {
  console.log("FAIL could not lift usePreset out of content.js");
  process.exit(1);
}

disk = { cards: [], decks: {}, channelMeta: {}, settings: {} };
const said = [];
// "key|arg|arg": which message was chosen and what went into it, rather than
// how it happens to be worded in one language.
const t = (key, ...args) => [key, ...args].join("|");

await new Function(
  "t", "store", "presets", "showToast", "render",
  `${src2.slice(useFrom, useTo)} return usePreset;`
)(
  t,
  { apply: (op, args) => store.runOp(op, args) },
  presets,
  (message) => said.push(message),
  () => {}
)(made, { id: OTHER, name: "ゆめの" });

check("the panel's own load fills the deck", disk.decks[OTHER]?.length === 2);
check("and names the channel while it is there", disk.channelMeta[OTHER]?.name === "ゆめの");
// Ten cards arriving is its own announcement; what it does not account for
// is a pool that grew by less, so that is the only thing left to say.
check("a load with nothing reused says nothing", said.length === 0);

// Loading twice is not loading twice as much.
const before = disk.cards.length;
await store.runOp("loadPreset", { channelId: OTHER, cards: presets.cardsFor(plain, OTHER) });
check("loading the same preset again adds nothing", disk.cards.length === before);
check("and does not repeat itself in the deck", new Set(disk.decks[OTHER]).size === disk.decks[OTHER].length);

/* ---------- and the way back in, from the builder ---------- */

// The file can only be handed to someone if they can take it. Everything that
// decides is already written — validate, offeredOn, loadPreset — so what is
// left to get wrong is the line that calls them, which is the part nothing
// was watching.
const optionsSrc = (await import("node:fs")).readFileSync(
  process.env.OD_OPTIONS || "/Users/maintainer/OshiDeck/options.js", "utf8");

const from = optionsSrc.indexOf("async function importDeck(file) {");
const to = optionsSrc.indexOf("\n}", from) + 2;
if (from < 0 || to <= from) {
  console.log("FAIL could not lift importDeck out of options.js");
  process.exit(1);
}

const importing = (raw, into) => {
  const seen = { writes: [], said: [] };
  const run = new Function(
    "t", "presets", "selected", "status", "mutate", "nameOf", "loadDecks",
    `${optionsSrc.slice(from, to)} return importDeck;`
  )(
    (key, ...args) => [key, ...args].join("|"),
    presets,
    into,
    (message) => seen.said.push(message),
    async (op, args) => { seen.writes.push({ op, args }); return store.runOp(op, args); },
    () => "さくら",
    async () => {}
  );
  return run({ text: async () => JSON.stringify(raw) }).then(() => seen);
};

disk = { cards: [], decks: { [CH]: [] }, channelMeta: {}, settings: {} };
let got = await importing(made, CH);
check("a file made here loads back in", disk.cards.length === 3);
check("and says what it did", got.said.join("").includes("opt.presetLoaded"));

// The one the offer already knows: a file carrying somebody's member emoji is
// no use on another channel, and loading it would quietly drop exactly the
// part that took the longest to build.
disk = { cards: [], decks: { [OTHER]: [] }, channelMeta: {}, settings: {} };
got = await importing(made, OTHER);
check("a file for another channel is refused, not half-loaded", disk.cards.length === 0);
check("and says which kind of no it is", got.said.join("").includes("opt.importNotForHere"));

/* ---------- and what the builder says a card is ---------- */

// The stripe means scope, and the two pages were answering that differently.
// Reading the member emoji only says "forced to a channel"; a card set to
// this channel in plain words is tied to it just as much — and a preset
// carries those. `はのは〜` is Palette Project's and has no stamps in it, so
// it was coloured in the panel and grey in the builder.
{
  const cardFrom = optionsSrc.indexOf("function buildCard(card, where) {");
  const cardTo = optionsSrc.indexOf("\n}", cardFrom) + 2;
  if (cardFrom < 0 || cardTo <= cardFrom) {
    console.log("FAIL could not lift buildCard out of options.js");
    process.exit(1);
  }

  // tokens.toFragment reaches for the global document, not the injected one.
  const node = () => {
    const vars = {};
    return {
      dataset: {}, vars,
      style: { setProperty: (key, value) => { vars[key] = value; } },
      append() {}, appendChild() {}, setAttribute() {}, addEventListener() {},
      set className(v) {}, set textContent(v) {}, set draggable(v) {}
    };
  };
  const was = globalThis.document;
  globalThis.document = {
    createElement: node,
    createTextNode: () => node(),
    createDocumentFragment: node
  };

  const build = new Function(
    "document", "store", "tokens", "t", "hueOf", "selected", "wireDrag", "cardAction",
    `${optionsSrc.slice(cardFrom, cardTo)} return buildCard;`
  )(
    { createElement: node },
    store, tokens,
    (key) => key,
    () => 42, CH, () => {}, () => ({})
  );

  const scoped = (scope, tokenList, where = "pool") =>
    build({ tokens: tokenList, scope, uses: 0 }, where);

  check("a card tied to a channel by its words is not universal here",
    scoped(CH, [{ type: "text", value: "はのは〜" }]).dataset.universal === undefined);
  check("while one that works anywhere is",
    scoped(store.GLOBAL, [{ type: "text", value: "888" }]).dataset.universal === "true");
  check("and a card forced by its stamps is still not",
    scoped(store.GLOBAL, [{ type: "youtubeEmoji", emojiId: `${CH}/x`,
      sharedTooltipText: ":_hai:" }]).dataset.universal === undefined);

  // And the stripe's colour, which was set on the deck's side only — so a
  // card in the pool fell back to the stylesheet's 320, pink on every
  // channel. poolFor has already narrowed the pool to what this deck can
  // send, so there is nothing else it could be.
  const words = [{ type: "text", value: "はのは〜" }];
  check("a card in the pool wears the deck's colour",
    scoped(CH, words).vars["--hue"] === 42);
  check("the same one in the deck wears it too",
    scoped(CH, words, "deck").vars["--hue"] === 42);

  globalThis.document = was;
}

// The portable kind has nobody to belong to, so it goes anywhere.
disk = { cards: [], decks: { [OTHER]: [] }, channelMeta: {}, settings: {} };
got = await importing(plain, OTHER);
check("a portable file loads anywhere", disk.cards.length === 2);

// Hand-edited, or from a newer build. A file that is merely *empty* would be
// refused by the operation anyway, which proves nothing about the reading —
// so this one has a card in it that only the reading can object to.
disk = { cards: [], decks: { [CH]: [] }, channelMeta: {}, settings: {} };
got = await importing({ name: "あやしい", cards: [{ tokens: text("x"), scope: "everywhere" }] }, CH);
check("a file that is not a preset is refused", disk.cards.length === 0);
check("with the reason it gave", got.said.join("").includes("opt.cannotRead"));

process.exit(fail);
