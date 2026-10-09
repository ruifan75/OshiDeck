globalThis.OshiDeck = {};
const SAKURA = "UCsakura0000000000000000";
const YUMENO = "UCyumeno0000000000000000";
const stamp = (o) => [{ type: "youtubeEmoji", emojiId: o + "/x", alt: "" }];
const text  = (v) => [{ type: "text", value: v }];

let writes = [];
let stored = {
  cards: [
    { id: "univ",    tokens: text("888") },
    { id: "sakuraS", tokens: stamp(SAKURA) },
    { id: "yumenoS", tokens: stamp(YUMENO) }
  ],
  decks: { [SAKURA]: ["univ", "sakuraS"], [YUMENO]: ["yumenoS"] },
  channelMeta: { [SAKURA]: { name: "sakura", hue: 320 } }
};
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => stored,
  set: async (patch) => { writes.push(Object.keys(patch).sort().join("+")); }
} } };
require(process.env.OD_STORE || "/Users/maintainer/OshiDeck/src/store.js");
require("/Users/maintainer/OshiDeck/src/tokens.js");
const S = globalThis.OshiDeck.store;

(async () => {
  let fail = 0;
  const check = (l, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + l); };
  const ids = (l) => l.map((c) => c.id).join(" ") || "(none)";
  const d = await S.read();

  console.log("--- counts split per channel ---");

  // Counts used to be one number per card, shared by every channel. Where
  // they were earned cannot be recovered, so each deck holding the card keeps
  // what there was — exactly right for a card in one deck, which is most of
  // them, and the only answer for a card in several that does not throw the
  // order away on upgrade.
  {
    const before = stored;
    stored = {
      cards: [
        { id: "shared", tokens: text("888"), uses: 40, heat: 40, lastUsedAt: 111 },
        { id: "loose",  tokens: text("GG"),  uses: 7,  heat: 7,  lastUsedAt: 222 },
        // Both shapes at once, which a hand-edited file can carry: the split
        // one is the real answer and the flat one is what it replaced.
        { id: "fresh",  tokens: text("w"),   uses: 99, heat: 99, lastUsedAt: 99,
          by: { [YUMENO]: { uses: 3, heat: 3, lastUsedAt: 9 } } }
      ],
      decks: { [SAKURA]: ["shared"], [YUMENO]: ["shared"] },
      channelMeta: {}
    };
    const old = await S.read();
    const by = (id) => old.cards.find((c) => c.id === id).by;

    check("an old count goes to every deck that holds the card",
      by("shared")[SAKURA].uses === 40 && by("shared")[YUMENO].uses === 40);
    check("and the card stops carrying one of its own",
      old.cards.every((c) => c.uses === undefined && c.heat === undefined));
    check("a card in no deck has nowhere to put it",
      Object.keys(by("loose")).length === 0);
    check("and a card already counted per channel is left alone",
      by("fresh")?.[YUMENO]?.uses === 3 && Object.keys(by("fresh") || {}).length === 1);

    stored = before;
  }

  console.log("");
  console.log("--- atomicity ---");
  writes = [];
  await S.runOp("markUsed", { id: "univ", channelId: SAKURA });
  check("one operation writes every key once",
    writes.length === 1 && writes[0] === "cards+channelMeta+decks");

  console.log("");
  console.log("--- builder pool keeps in-deck cards ---");
  console.log("  compatibleWith(sakura):", ids(S.compatibleWith(d, SAKURA)));
  console.log("  poolFor(sakura)       :", ids(S.poolFor(d, SAKURA)));
  check("compatible set includes cards already in the deck",
    S.compatibleWith(d, SAKURA).some((c) => c.id === "sakuraS"));
  check("compatible set still hides other channels",
    !S.compatibleWith(d, SAKURA).some((c) => c.id === "yumenoS"));
  check("compatible set does not change when the deck does",
    (S.removeFromDeck(d, SAKURA, "univ"),
     S.compatibleWith(d, SAKURA).map((c) => c.id).join(" ") === "univ sakuraS"));
  S.addToDeck(d, SAKURA, "univ");
  const orderBefore = S.deckOf(d, SAKURA).map((c) => c.id).join(" ");

  console.log("");
  console.log("--- deleting a deck cannot strand its member cards ---");
  const removed = S.deleteDeck(d, SAKURA);
  console.log("  残った札:", ids(d.cards));
  check("its member card goes with it", !d.cards.some((c) => c.id === "sakuraS"));
  check("universal cards stay", d.cards.some((c) => c.id === "univ"));
  check("other channels untouched", d.cards.some((c) => c.id === "yumenoS"));
  S.restoreDeck(d, removed);
  console.log("  undo 後:", ids(d.cards), "| deck:", ids(S.deckOf(d, SAKURA)));
  check("undo restores the cards", d.cards.some((c) => c.id === "sakuraS"));
  check("undo restores the exact prior order and the name",
    S.deckOf(d, SAKURA).map((c) => c.id).join(" ") === orderBefore &&
    d.channelMeta[SAKURA].name === "sakura");
  process.exit(fail);
})();
