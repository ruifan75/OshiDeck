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

const src = process.env.OD_PRESETS
  ?? new URL("../../src/presets.js", import.meta.url).pathname;
// content.js is read rather than run: it wants a browser, and all that is
// wanted here is the one function that asks the store to load a preset.
const src2 = (await import("node:fs")).readFileSync(
  process.env.OD_SOURCE
  ?? new URL("../../content.js", import.meta.url).pathname, "utf8");
await import(new URL("../../src/tokens.js", import.meta.url).href);
await import(new URL("../../src/backup.js", import.meta.url).href);
await import(process.env.OD_STORE
  ? `file://${process.env.OD_STORE}`
  : new URL("../../src/store.js", import.meta.url).href);
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
// A validator that throws is not a validator. These ran straight into
// cardKey and requiredChannels, so a token that was not one came out as an
// exception — and background.js catches around the whole bundled file, so one
// bad preset discarded all 262 of them.
for (const [what, tokenList] of [
  ["a null token", [null]],
  ["a text token with no text", [{ type: "text", value: 123 }]],
  ["an emoji with no id", [{ type: "youtubeEmoji" }]],
  ["a type nobody defined", [{ type: "constructor", value: "hidden" }]]
]) {
  let said;
  try { said = presets.validate({ name: "x", cards: [{ tokens: tokenList, scope: "global" }] }); }
  catch (_) { said = "threw"; }
  check(`${what} is reported, not thrown`, Array.isArray(said));
}

// And a deck that holds the same wording twice — once for anyone, once tied
// to this channel — is an ordinary deck. loadPreset chooses between them by
// what can be sent, so the export has to be able to carry both: ignoring
// scope here meant fromDeck wrote a file its own validator refused.
{
  const both = presets.fromDeck(
    { cards: [{ id: "g", tokens: text("888"), scope: store.GLOBAL },
              { id: "c", tokens: text("888"), scope: CH }],
      decks: { [CH]: ["g", "c"] }, channelMeta: { [CH]: { name: "n" } } },
    CH, { name: "t" }
  );
  check("a deck with both kinds of the same words exports", presets.validate(both) === null);
  check("while the same card twice is still a duplicate",
    presets.validate({ ...both, cards: [both.cards[0], both.cards[0]] })?.[0]
      === "validation.presetCardDuplicate");
}

check(
  "nor can they ride in a preset that names nobody",
  presets.validate({ ...made, channel: undefined })?.[0] === "validation.presetChannelMissing"
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
check("an imported global declaration creates a channel card", fresh[0].scope === OTHER);
check("and channel-only means the channel it is loaded into", fresh[1].scope === OTHER);
check("a starting deck cannot make unbound cards without a channel", presets.cardsFor(plain, null).length === 0);

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

// Both copies are usable. The universal one must win in either storage
// order, keeping its id, contents and per-channel history intact.
for (const reversed of [false, true]) {
  const local = { id: "local", tokens: text("cheer"), scope: OTHER, createdAt: 1, by: {} };
  const global = { id: "global", tokens: text("cheer"), scope: "global", createdAt: 2,
    by: { [OTHER]: { uses: 7, heat: 3, lastUsedAt: 10 } } };
  disk = { cards: reversed ? [global, local] : [local, global],
    decks: { [OTHER]: [] }, channelMeta: {}, settings: {} };
  result = await store.runOp("loadPreset", { channelId: OTHER,
    cards: presets.cardsFor({ cards: [{ tokens: text("cheer"), scope: "channel" }] }, OTHER) });
  check(`an existing universal card wins in either storage order (${reversed})`,
    disk.decks[OTHER].join() === "global" && disk.cards.length === 2 && result.value.reused === 1);
  check(`reusing universal preserves its scope and history (${reversed})`,
    disk.cards.find((c) => c.id === "global").scope === "global" &&
    disk.cards.find((c) => c.id === "global").by[OTHER].uses === 7 &&
    disk.cards.find((c) => c.id === "local").scope === OTHER);
}
disk = { cards: [{ id: "local", tokens: text("cheer"), scope: OTHER, createdAt: 1, by: {} }],
  decks: { [OTHER]: [] }, channelMeta: {}, settings: {} };
result = await store.runOp("loadPreset", { channelId: OTHER,
  cards: presets.cardsFor({ cards: [{ tokens: text("cheer"), scope: "channel" }] }, OTHER) });
check("the current channel's copy is reused when no universal one exists",
  disk.decks[OTHER].join() === "local" && disk.cards.length === 1 && result.value.reused === 1);
disk = { cards: [{ id: "short", tokens: text("888"), scope: "global", createdAt: 1, by: {} }],
  decks: { [OTHER]: [] }, channelMeta: {}, settings: {} };
await store.runOp("loadPreset", { channelId: OTHER,
  cards: presets.cardsFor({ cards: [{ tokens: text("888888"), scope: "channel" }] }, OTHER) });
check("a similar reaction does not reuse different contents",
  disk.cards.length === 2 && !disk.decks[OTHER].includes("short") &&
  disk.cards.find((c) => c.id !== "short").scope === OTHER);
disk = { cards: [], decks: {}, channelMeta: {}, settings: {} };
await store.runOp("loadPreset", { channelId: OTHER,
  cards: [{ id: "old-page", tokens: text("from an old page"), scope: "global", createdAt: 1, by: {} }] });
check("the worker also binds an old page's global suggestion to this channel",
  disk.cards[0].scope === OTHER && disk.decks[OTHER].join() === "old-page");

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
  process.env.OD_OPTIONS
  ?? new URL("../../options.js", import.meta.url).pathname, "utf8");

const from = optionsSrc.indexOf("async function importDeck(file) {");
const to = optionsSrc.indexOf("\n}", from) + 2;
if (from < 0 || to <= from) {
  console.log("FAIL could not lift importDeck out of options.js");
  process.exit(1);
}

const importing = (raw, into) => {
  const seen = { writes: [], said: [] };
  const run = new Function(
    "t", "presets", "selected", "status", "mutate", "nameOf", "loadDecks", "journal",
    `${optionsSrc.slice(from, to)} return importDeck;`
  )(
    (key, ...args) => [key, ...args].join("|"),
    presets,
    into,
    (message) => seen.said.push(message),
    async (op, args) => { seen.writes.push({ op, args }); return store.runOp(op, args); },
    () => "さくら",
    async () => {}, { record() {} }
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

/* ---------- one file per channel, and an index naming them ---------- */

// A single file holding every preset is fetched and parsed whole on every
// cold start of the worker, and it grows with the number of channels anyone
// has mined while what a viewer needs stays at one. What the index promises
// has to be true of the files, or a channel is offered something that is not
// there.
{
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../../presets/", import.meta.url).pathname;
  const index = JSON.parse(readFileSync(`${dir}index.json`, "utf8"));

  check("the index says which format it is", index.format === 2);
  check("and lists something", Array.isArray(index.presets) && index.presets.length > 0);

  const named = new Set(index.presets.map((e) => e.file));
  const onDisk = new Set(readdirSync(dir).filter((f) => f !== "index.json"));

  check("everything it names is there",
    index.presets.every((e) => onDisk.has(e.file)));
  check("and everything there is named",
    [...onDisk].every((f) => named.has(f)));
  check("a file is a name, not a path",
    index.presets.every((e) => /^[A-Za-z0-9_-]+\.json$/.test(e.file)));

  let wrong = 0, universal = 0;
  for (const entry of index.presets) {
    const preset = JSON.parse(readFileSync(`${dir}${entry.file}`, "utf8"));
    if (presets.validate(preset)) wrong += 1;
    if (preset.channel !== entry.channel) wrong += 1;
    universal += preset.cards.filter((card) => card.scope !== "channel").length;
  }
  check("every bundled preset passes the reader that will load it", wrong === 0);
  check("bundled starting decks never introduce universal cards", universal === 0);

  // Two entries for one channel would both be offered to the same deck.
  const channels = index.presets.map((e) => e.channel);
  check("and no channel is named twice", new Set(channels).size === channels.length);
}

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
    "document", "store", "tokens", "t", "hueOf", "colorOf", "selected", "wireDrag", "cardAction", "nameOf",
    `${optionsSrc.slice(cardFrom, cardTo)} return buildCard;`
  )(
    { createElement: node },
    store, tokens,
    (key) => key,
    () => 42, () => null, CH, () => {}, () => ({}), (id) => id
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

/* ---------- asking the worker for them ---------- */

// The page asks once per channel and keeps the answer. It used to keep a
// *failure* just as long: the worker can be asleep, or torn down between the
// question and the reply, and one such ask settled the matter for the life of
// the page — the bar never offered that channel's preset again, while the
// builder, which keeps its own cache and asks much later, went on offering it.
{
  const from = src2.indexOf("  const presetsByChannel = new Map();");
  const to = src2.indexOf("  // Offered only where it means something", from);
  if (from < 0 || to <= from) {
    console.log("FAIL could not lift presetsOnHand out of content.js");
    process.exit(1);
  }

  const THEIRS = { format: 2, name: "さくら", channel: CH, cards: [{ tokens: text("わこつ"), scope: "global" }] };

  // `answer` is what the worker does with this ask, decided per call.
  const asking = (answer) => {
    const seen = { asks: 0, renders: 0 };
    const api = new Function(
      "chrome", "presets", "scheduleRender", "seen",
      `${src2.slice(from, to)} return presetsOnHand;`
    )(
      { runtime: { sendMessage: () => { seen.asks += 1; return answer(seen.asks); } } },
      presets,
      () => { seen.renders += 1; },
      seen
    );
    return { ask: api, seen };
  };

  const settle = () => new Promise((done) => setTimeout(done, 0));

  // Nothing came back at all: the worker was gone, or the port closed first.
  let a = asking(() => Promise.reject(new Error("message port closed")));
  a.ask(CH);
  await settle();
  a.ask(CH);
  check("an ask nothing answered is asked again", a.seen.asks === 2);

  // The extension was reloaded under the page: sendMessage throws outright.
  a = asking(() => { throw new Error("Extension context invalidated"); });
  a.ask(CH);
  await settle();
  a.ask(CH);
  check("and so is one that could not be sent", a.seen.asks === 2);

  // The worker answered, so there is nothing left to ask.
  a = asking(() => Promise.resolve({ ok: true, value: [THEIRS] }));
  a.ask(CH);
  await settle();
  check("an answer arriving redraws the panel", a.seen.renders === 1);
  check("and is what the channel is offered", a.ask(CH).length === 1);
  check("and is not asked for twice", a.seen.asks === 1);

  // No preset for this channel is a real answer too, and asking again every
  // render would not produce one.
  a = asking(() => Promise.resolve({ ok: true, value: [] }));
  a.ask(CH);
  await settle();
  a.ask(CH);
  check("a channel with no preset is asked about once", a.seen.asks === 1);
  check("and offers nothing", a.ask(CH).length === 0);

  // The failure is per channel: one unanswered ask must not make the page
  // ask about every other channel again.
  a = asking((n) => (n === 1 ? Promise.reject(new Error("gone")) : Promise.resolve({ ok: true, value: [THEIRS] })));
  a.ask(CH);
  await settle();
  a.ask(OTHER);
  await settle();
  a.ask(OTHER);
  check("a channel that did answer stays answered", a.seen.asks === 2);
}

// The builder asks the same question from its own cache, and had the same
// hole in it — found only once both were looked at together. Two caches is
// itself the reason: the page kept offering a preset the bar had given up on.
{
  const begin = optionsSrc.indexOf("async function loadBundled(channelId) {");
  const stop = optionsSrc.indexOf("\n}", begin) + 2;
  if (begin < 0 || stop <= begin) {
    console.log("FAIL could not lift loadBundled out of options.js");
    process.exit(1);
  }

  const asking = (answer) => {
    const seen = { asks: 0 };
    const api = new Function(
      "chrome", "seen",
      `const bundled = new Map();
       ${optionsSrc.slice(begin, stop)} return loadBundled;`
    )(
      { runtime: { sendMessage: () => { seen.asks += 1; return answer(seen.asks); } } },
      seen
    );
    return { ask: api, seen };
  };

  let b = asking(() => Promise.reject(new Error("message port closed")));
  await b.ask(CH);
  await b.ask(CH);
  check("the builder asks again after an ask nothing answered", b.seen.asks === 2);

  b = asking(() => { throw new Error("Extension context invalidated"); });
  await b.ask(CH);
  await b.ask(CH);
  check("and after one that could not be sent", b.seen.asks === 2);

  // The worker answered, and what it said was no: the files could not be
  // read. That is not "this channel has no preset" either.
  b = asking(() => Promise.resolve({ ok: false, error: "presets unreadable" }));
  await b.ask(CH);
  await b.ask(CH);
  check("and after one the worker itself could not answer", b.seen.asks === 2);

  b = asking(() => Promise.resolve({ ok: true, value: [] }));
  check("while a channel with no preset is asked about once there too",
    (await b.ask(CH)).length === 0 && (await b.ask(CH)).length === 0 && b.seen.asks === 1);
}

/* ---------- the script that puts one in the repository ---------- */

// Not shipped, but it writes into what is. Run in a copy of the tree: the
// real presets/ is the thing being protected, and a test that writes there to
// prove it writes there has already lost.
{
  const { mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync, readdirSync } =
    await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");

  const here = new URL("../../", import.meta.url).pathname;
  const lab = mkdtempSync(`${tmpdir()}/oshideck-preset-`);
  cpSync(`${here}src`, `${lab}/src`, { recursive: true });
  mkdirSync(`${lab}/tools`);
  mkdirSync(`${lab}/presets`);
  cpSync(`${here}tools/add-preset.mjs`, `${lab}/tools/add-preset.mjs`);
  writeFileSync(`${lab}/presets/index.json`, `${JSON.stringify({ format: 2, presets: [] }, null, 2)}\n`);

  const file = (name, body) => {
    writeFileSync(`${lab}/${name}`, JSON.stringify(body));
    return `${lab}/${name}`;
  };
  const run = (...args) => {
    try {
      return { code: 0, said: execFileSync(process.execPath,
        [`${lab}/tools/add-preset.mjs`, ...args], { stdio: "pipe" }).toString() };
    } catch (error) {
      return { code: error.status, said: `${error.stdout}${error.stderr}` };
    }
  };
  const inPresets = () => readdirSync(`${lab}/presets`).sort().join();

  const good = file("good.json",
    { format: 2, name: "さくら", channel: CH, cards: [{ tokens: text("わこつ"), scope: "global" }] });
  const broken = file("broken.json", { format: 2, name: "こわれ", channel: OTHER, cards: "いいえ" });

  // One good file and one that cannot be used. The write happened as it went,
  // so the good one landed in presets/ while the index — written only at the
  // end — never heard about it: a file nothing names and nothing loads.
  let got = run(good, broken);
  check("a batch with an unusable file in it fails", got.code === 1);
  check("and leaves nothing behind it", inPresets() === "index.json");

  got = run(good);
  check("while the good one on its own is written", inPresets() === `${CH}.json,index.json`);
  check("and named in the index",
    JSON.parse(readFileSync(`${lab}/presets/index.json`, "utf8")).presets[0].channel === CH);
  check("bundling an exported global card makes it channel-only",
    JSON.parse(readFileSync(`${lab}/presets/${CH}.json`, "utf8")).cards[0].scope === "channel");
  const pair = file("pair.json", { format: 2, name: "さくら", channel: CH,
    cards: ["global", "channel"].map((scope) => ({ tokens: text("わこつ"), scope })) });
  got = run(pair);
  const paired = JSON.parse(readFileSync(`${lab}/presets/${CH}.json`, "utf8"));
  check("bundling both original scopes keeps one valid channel card",
    got.code === 0 && paired.cards.length === 1 && paired.cards[0].scope === "channel" &&
    presets.validate(paired) === null);

  // The second check, the one --channel makes necessary, printed the key and
  // its arguments joined by a comma — the thing i18n was added here to stop.
  const unnamed = file("unnamed.json",
    { format: 2, name: "だれか", cards: [{ tokens: text("わこつ"), scope: "global" }] });
  got = run(unnamed, "--channel", "not-a-channel");
  check("a channel named on the command line is checked too", got.code === 1);
  check("and the reason is said, not keyed", !got.said.includes("validation."));
}

process.exit(fail);
