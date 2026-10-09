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
require(process.env.OD_STORE || "../../src/store.js");
require("../../src/tokens.js");
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
      by("shared")?.[SAKURA]?.uses === 40 && by("shared")?.[YUMENO]?.uses === 40);
    check("and the card stops carrying one of its own",
      old.cards.every((c) => c.uses === undefined && c.heat === undefined));
    check("a card in no deck has nowhere to put it",
      Object.keys(by("loose")).length === 0);
    check("and a card already counted per channel is left alone",
      by("fresh")?.[YUMENO]?.uses === 3 && Object.keys(by("fresh") || {}).length === 1);

    stored = before;
  }

  // Every shape, not only the current one. The split used to live inside the
  // branch that reads today's storage, so anything arriving in an older shape
  // was handed an empty `by` and had its counts deleted unread — a card with
  // forty uses came back as one the first time it was pressed.
  {
    const before = stored;

    stored = { cards: [{ id: "old", tokens: text("888"), scope: SAKURA,
                         uses: 40, heat: 40, lastUsedAt: 111 }] };
    let d = await S.read();
    check("a v0.3 card keeps the count it arrived with",
      d.cards[0].by?.[SAKURA]?.uses === 40);

    stored = { presets: { channels: { [YUMENO]: [{ id: "older", tokens: text("GG"),
                                                   uses: 7, heat: 7, lastUsedAt: 5 }] } } };
    d = await S.read();
    check("and so does a v0.1 one", d.cards[0].by?.[YUMENO]?.uses === 7);

    // A card nobody's deck holds is usually one that was ejected into the
    // pool. If it is tied to a channel it still says where it was used.
    stored = { cards: [{ id: "shelved", tokens: text("おかえり"), scope: SAKURA,
                         uses: 12, heat: 12, lastUsedAt: 9 }], decks: { [SAKURA]: [] } };
    d = await S.read();
    check("a channel-only card in no deck keeps its count anyway",
      d.cards[0].by?.[SAKURA]?.uses === 12);

    // A universal one genuinely has nowhere to put it.
    stored = { cards: [{ id: "loose", tokens: text("w"), uses: 3, heat: 3, lastUsedAt: 1 }],
               decks: { [SAKURA]: [] } };
    d = await S.read();
    check("while a universal one in no deck has nowhere to put it",
      Object.keys((await S.read()).cards[0].by || {}).length === 0);

    stored = before;
  }

  console.log("");
  console.log("--- settings settled on the way in ---");

  // An empty number field reads as NaN, and a step name that was never
  // offered would quietly become the middle one on every read instead of
  // being refused once, here.
  // The fake storage does not keep what is written, so each of these starts
  // from the defaults — which is what makes a refused key visible: it comes
  // back as the default rather than as what was asked for.
  {
    const set = async (patch) => (await S.runOp("setSettings", { patch })).value;
    check("a number of milliseconds is kept", (await set({ hold: 7_000 })).hold === 7_000);
    check("too short is pulled up to a second", (await set({ hold: 5 })).hold === 1_000);
    check("too long is pulled down to ten minutes", (await set({ pace: 9e9 })).pace === 600_000);
    check("nothing at all is refused", (await set({ hold: NaN })).hold === "normal");
    check("a step that was never offered is refused too",
      (await set({ pace: "blazing" })).pace === "normal");
    check("while a step that was offered is taken",
      (await set({ pace: "quick" })).pace === "quick");
    check("and a setting that is not one of these is left alone",
      (await set({ cardSize: "large" })).cardSize === "large");

    // Not only the two times, and not only this page. A backup is a file and
    // a file can say anything; one with `mode: "not-a-mode"` passed and then
    // threw on the options page, which reads the matching radio by value.
    check("a mode nobody offers is refused", (await set({ mode: "not-a-mode" })).mode === "hand");
    check("and a row count nobody offers", (await set({ rows: 99 })).rows === 2);
    check("and a sort nobody offers", (await set({ sortBy: "whatever" })).sortBy === "trend");
    check("something that is not a setting at all does not become one",
      !("hack" in await set({ hack: "x" })));

    // `TUNING[group][value]` answered for "toString", and tuning() then
    // handed its callers a function.
    const borrowed = await set({ hold: "toString" });
    check("a step borrowed from Object.prototype is not a step", borrowed.hold === "normal");
    check("and the time it buys is a number", typeof S.tuning(borrowed, "hold") === "number");
  }

  console.log("");
  console.log("--- what a file says about settings is checked too ---");

  // The same gate on the way out. A replace import writes the file's settings
  // wholesale, and storage can be edited by hand.
  {
    const before = stored;
    stored = { cards: [], decks: {}, settings: { mode: "not-a-mode", rows: 99, hold: "toString" } };
    const d = await S.read();
    check("a file's settings are cleaned when they are read",
      d.settings.mode === "hand" && d.settings.rows === 2 && d.settings.hold === "normal");
    stored = before;
  }

  console.log("");
  console.log("--- the same wording is not the same card ---");

  // One tied to another channel cannot be sent here, so calling it a
  // duplicate reported the save as handled while putting nothing in the deck.
  {
    const before = stored;
    stored = { cards: [{ id: "theirs", tokens: text("おかえり"), scope: SAKURA, by: {} }],
               decks: { [SAKURA]: ["theirs"], [YUMENO]: [] }, channelMeta: {}, settings: {} };
    // The fake storage above only records which keys were written, so this
    // block keeps what was written as well — the point is where the card
    // landed, not that a write happened.
    const kept = {};
    const set = globalThis.chrome.storage.local.set;
    globalThis.chrome.storage.local.set = async (patch) => { Object.assign(kept, patch); };

    const made = (await S.runOp("addCard", {
      card: { id: "mine", tokens: text("おかえり"), by: {} },
      channelId: YUMENO, scope: "global"
    })).value;

    globalThis.chrome.storage.local.set = set;

    check("saving it on another channel is not a duplicate", made.duplicate === false);
    check("and it actually arrives in that deck", (kept.decks[YUMENO] || []).includes("mine"));
    check("while the one that was there is left alone",
      kept.cards.find((c) => c.id === "theirs").scope === SAKURA);
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
