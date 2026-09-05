globalThis.OshiDeck = {};
const SAKURA = "UCsakura0000000000000000";
const YUMENO = "UCyumeno0000000000000000";
const stamp = (o) => [{ type: "youtubeEmoji", emojiId: o + "/x", alt: "" }];
const text  = (v) => [{ type: "text", value: v }];

let disk = {};
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => JSON.parse(JSON.stringify(disk)),
  set: async (p) => { disk = { ...disk, ...JSON.parse(JSON.stringify(p)) }; }
} } };
await import("/Users/maintainer/OshiDeck/src/tokens.js");
await import("/Users/maintainer/OshiDeck/src/store.js");
await import("/Users/maintainer/OshiDeck/src/backup.js");
const { store, backup } = globalThis.OshiDeck;

let fail = 0;
const check = (l, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + l); };
const reset = (d) => { disk = JSON.parse(JSON.stringify(d)); };

console.log("--- deck deletion clears stray references ---");
reset({
  cards: [{ id: "s", tokens: stamp(SAKURA) }, { id: "u", tokens: text("888") }],
  // 's' wrongly filed under yumeno too, as older buggy state could produce
  decks: { [SAKURA]: ["s", "u"], [YUMENO]: ["s", "u"] }, channelMeta: {}
});
let r = await store.runOp("deleteDeck", { channelId: SAKURA });
check("write succeeded", r.ok);
check("card gone from the pool", !disk.cards.some((c) => c.id === "s"));
check("stray reference cleared from the other deck", !disk.decks[YUMENO].includes("s"));
check("universal card untouched", disk.decks[YUMENO].includes("u"));
await store.runOp("restoreDeck", { snapshot: r.value });
check("undo restores the card", disk.cards.some((c) => c.id === "s"));
// The stray was a reference yumeno could never send. Undo restores what was
// deleted, not state that was already impossible.
check("undo does not restore the impossible reference", !disk.decks[YUMENO].includes("s"));

console.log("");
console.log("--- undo after the other surface moved on ---");
reset({ cards: [{ id: "a", tokens: text("1") }], decks: { [SAKURA]: ["a"] }, channelMeta: {} });
r = await store.runOp("removeFromDeck", { channelId: SAKURA, cardId: "a" });
await store.runOp("addToDeck", { channelId: SAKURA, cardId: "a" });   // chat re-adds it
await store.runOp("insertIntoDeck", { channelId: SAKURA, cardId: "a", at: r.value });
check("undo does not duplicate a re-added card", disk.decks[SAKURA].join("") === "a");
reset({ cards: [{ id: "a", tokens: text("1") }], decks: { [SAKURA]: ["a"] }, channelMeta: {} });
r = await store.runOp("removeFromDeck", { channelId: SAKURA, cardId: "a" });
await store.runOp("deleteCard", { id: "a" });                          // chat deletes it
await store.runOp("insertIntoDeck", { channelId: SAKURA, cardId: "a", at: r.value });
check("undo does not resurrect a dangling id", !(disk.decks[SAKURA] || []).includes("a"));

console.log("");
console.log("--- deck undo merges rather than overwrites ---");
reset({ cards: [{ id: "a", tokens: text("1") }, { id: "b", tokens: text("2") }],
        decks: { [SAKURA]: ["a"] }, channelMeta: {} });
r = await store.runOp("deleteDeck", { channelId: SAKURA });
await store.runOp("addToDeck", { channelId: SAKURA, cardId: "b" });   // chat recreates it
await store.runOp("restoreDeck", { snapshot: r.value });
check("memberships added since deletion survive", disk.decks[SAKURA].includes("b"));
check("restored deck holds no dangling ids",
  disk.decks[SAKURA].every((id) => disk.cards.some((c) => c.id === id)));

console.log("");
console.log("--- editing into member emoji drops invalid memberships ---");
reset({ cards: [{ id: "a", tokens: text("1") }],
        decks: { [SAKURA]: ["a"], [YUMENO]: ["a"] }, channelMeta: {} });
await store.runOp("editCard", { id: "a", tokens: stamp(SAKURA) });
check("stays where it can be sent", disk.decks[SAKURA].includes("a"));
check("leaves where it cannot", !disk.decks[YUMENO].includes("a"));

console.log("");
console.log("--- import rejects impossible ownership ---");
const bad = { cards: [{ id: "s", tokens: stamp(SAKURA) }], decks: { [YUMENO]: ["s"] } };
const mixed = { cards: [{ id: "m", tokens: [...stamp(SAKURA), ...stamp(YUMENO)] }], decks: { [SAKURA]: ["m"] } };
const good = { cards: [{ id: "s", tokens: stamp(SAKURA) }], decks: { [SAKURA]: ["s"] } };
console.log("  wrong channel ->", backup.validate(bad));
console.log("  two issuers   ->", backup.validate(mixed));
check("wrong-channel membership rejected", !!backup.validate(bad));
check("multi-issuer card rejected", !!backup.validate(mixed));
check("correct file accepted", backup.validate(good) === null);
process.exit(fail);
