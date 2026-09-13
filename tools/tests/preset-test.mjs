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
await import("/Users/maintainer/OshiDeck/src/tokens.js");
await import("/Users/maintainer/OshiDeck/src/backup.js");
await import(`file://${process.env.OD_STORE || "/Users/maintainer/OshiDeck/src/store.js"}`);
await import(`file://${src}`);
const { store, presets } = globalThis.OshiDeck;

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
    card("d", text("使っていない"), "global")
  ],
  decks: { [CH]: ["a", "b", "c"] },
  channelMeta: {},
  settings: {}
};

const made = presets.fromDeck(data, CH, { name: "さくらの定番" });

check("only what is in the deck travels", made.cards.length === 2);
check("in the order the deck had it", made.cards[0].tokens[0].value === "わこつ");
check(
  "member emoji are left behind, since they send nowhere else",
  !made.cards.some((c) => c.tokens.some((t) => t.emojiId))
);
check("a universal card says so", made.cards[0].scope === "global");
check(
  "and a channel-only one says only that it is channel-only",
  made.cards[1].scope === "channel"
);
check(
  "no ids, no counts, no history",
  made.cards.every((c) => !("id" in c) && !("uses" in c) && !("lastUsedAt" in c))
);

/* ---------- what will not be handed over ---------- */

check("a good one passes", presets.validate(made) === null);

const broken = (over) => presets.validate({ ...made, ...over });
check("it needs a name", !!broken({ name: "" }));
check("and at least one card", !!broken({ cards: [] }));
check("a card needs tokens", !!broken({ cards: [{ scope: "global" }] }));
check("with something in them", !!broken({ cards: [{ tokens: text("  "), scope: "global" }] }));
check("and a scope it knows", !!broken({ cards: [{ tokens: text("x"), scope: "everywhere" }] }));
check(
  "member emoji cannot be smuggled in by hand",
  !!broken({ cards: [{ tokens: stamp(OTHER), scope: "channel" }] })
);
check(
  "nor can the same card twice",
  !!broken({ cards: [{ tokens: text("x"), scope: "global" }, { tokens: text("x"), scope: "global" }] })
);
check("a newer format is refused rather than half-read", !!broken({ format: 99 }));

/* ---------- loading it ---------- */

const fresh = presets.cardsFor(made, OTHER);
check("every card arrives with an id of its own", new Set(fresh.map((c) => c.id)).size === 2);
check("and no history", fresh.every((c) => c.uses === 0 && c.lastUsedAt === 0));
check("universal stays universal", fresh[0].scope === store.GLOBAL);
check("and channel-only means the channel it is loaded into", fresh[1].scope === OTHER);

disk = { cards: [], decks: {}, channelMeta: {}, settings: {} };
let result = await store.runOp("loadPreset", { channelId: OTHER, cards: presets.cardsFor(made, OTHER) });
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
result = await store.runOp("loadPreset", { channelId: OTHER, cards: presets.cardsFor(made, OTHER) });
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
result = await store.runOp("loadPreset", { channelId: OTHER, cards: presets.cardsFor(made, OTHER) });
check(
  "a card that only works on another channel is not treated as a match",
  disk.decks[OTHER].length === 2
);
check("so nothing is quietly dropped", result.value.added === 2 && result.value.reused === 0);

// Loading twice is not loading twice as much.
const before = disk.cards.length;
await store.runOp("loadPreset", { channelId: OTHER, cards: presets.cardsFor(made, OTHER) });
check("loading the same preset again adds nothing", disk.cards.length === before);
check("and does not repeat itself in the deck", new Set(disk.decks[OTHER]).size === disk.decks[OTHER].length);

process.exit(fail);
