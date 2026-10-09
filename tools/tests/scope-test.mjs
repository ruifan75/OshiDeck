// Requirement: scope is the card's own property, chosen when saving.
globalThis.OshiDeck = {};
const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const B = "UCbbbbbbbbbbbbbbbbbbbbbb";
const stamp = (o) => [{ type: "youtubeEmoji", emojiId: o + "/x", alt: "" }];
const text  = (v) => [{ type: "text", value: v }];

let disk = { cards: [], decks: {}, channelMeta: {}, settings: {} };
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => JSON.parse(JSON.stringify(disk)),
  set: async (p) => { disk = { ...disk, ...JSON.parse(JSON.stringify(p)) }; }
} } };
await import(new URL("../../src/tokens.js", import.meta.url).href);
await import(new URL("../../src/backup.js", import.meta.url).href);
await import(new URL("../../src/store.js", import.meta.url).href);
const { store } = globalThis.OshiDeck;

let fail = 0;
const check = (l, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + l); };
const reset = () => { disk = { cards: [], decks: {}, channelMeta: {}, settings: {} }; };
const scopeOf = (id) => store.scopeOf(disk.cards.find((c) => c.id === id));

console.log("--- a plain card can be either ---");
reset();
await store.runOp("addCard", { card: { id: "u", tokens: text("888") }, channelId: A, scope: "global" });
await store.runOp("addCard", { card: { id: "o", tokens: text("わこつ") }, channelId: A, scope: A });
check("saved as universal", scopeOf("u") === "global");
check("saved as channel-only, even though it is plain text", scopeOf("o") === A);
check("both went into the deck", (disk.decks[A] || []).length === 2);

console.log("");
console.log("--- pools follow scope, not content ---");
const pool = (ch) => store.poolFor({ ...disk }, ch).map((c) => c.id);
await store.runOp("removeFromDeck", { channelId: A, cardId: "u" });
await store.runOp("removeFromDeck", { channelId: A, cardId: "o" });
console.log("  A のプール:", pool(A).join(" ") || "(なし)");
console.log("  B のプール:", pool(B).join(" ") || "(なし)");
check("universal shows in every pool", pool(A).includes("u") && pool(B).includes("u"));
check("channel-only shows in its own pool", pool(A).includes("o"));
check("and nowhere else", !pool(B).includes("o"));

console.log("");
console.log("--- member emoji force the scope ---");
reset();
let r = await store.runOp("addCard", { card: { id: "s", tokens: stamp(A) }, channelId: A, scope: "global" });
check("a stamp card cannot be saved as universal", scopeOf("s") === A);
r = await store.runOp("addCard", { card: { id: "s2", tokens: stamp(B) }, channelId: A, scope: "global" });
check("nor filed under a channel that did not issue it", r.ok === false);

console.log("");
console.log("--- scope can be changed later ---");
reset();
await store.runOp("addCard", { card: { id: "u", tokens: text("888") }, channelId: A, scope: "global" });
await store.runOp("addToDeck", { channelId: B, cardId: "u" });
check("universal card sits in both decks",
  (disk.decks[A] || []).includes("u") && (disk.decks[B] || []).includes("u"));
r = await store.runOp("setScope", { id: "u", scope: A, channelId: A });
console.log("  A 専用にした後  A=[" + (disk.decks[A]||[]) + "]  B=[" + (disk.decks[B]||[]) + "]");
check("made channel-only, it leaves the decks that cannot send it",
  (disk.decks[A] || []).includes("u") && !(disk.decks[B] || []).includes("u"));
check("and it reports what it dropped", Object.keys(r.value.dropped).join() === B);

console.log("");
console.log("--- deleting a deck follows scope ---");
reset();
await store.runOp("addCard", { card: { id: "u", tokens: text("888") }, channelId: A, scope: "global" });
await store.runOp("addCard", { card: { id: "o", tokens: text("おつ") }, channelId: A, scope: A });
await store.runOp("deleteDeck", { channelId: A });
console.log("  残った札:", disk.cards.map((c) => c.id).join(" ") || "(なし)");
check("the universal card survives", disk.cards.some((c) => c.id === "u"));
check("the channel-only card goes with the deck", !disk.cards.some((c) => c.id === "o"));

console.log("");
console.log("--- deleting a shared card can be warned about ---");
reset();
await store.runOp("addCard", { card: { id: "u", tokens: text("888") }, channelId: A, scope: "global" });
await store.runOp("addToDeck", { channelId: B, cardId: "u" });
const held = store.decksHolding(disk, "u");
console.log("  この札を持つデッキ:", held.join(" "));
check("both decks are reported", held.length === 2);
process.exit(fail);
