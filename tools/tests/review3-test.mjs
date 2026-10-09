// Cases from the third review.
globalThis.OshiDeck = {};
const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const B = "UCbbbbbbbbbbbbbbbbbbbbbb";
const stamp = (o) => [{ type: "youtubeEmoji", emojiId: o + "/x", alt: "" }];
const text  = (v) => [{ type: "text", value: v }];

let disk = {};
let sets = [];
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => JSON.parse(JSON.stringify(disk)),
  set: async (p) => { sets.push(Object.keys(p).sort().join("+")); disk = { ...disk, ...JSON.parse(JSON.stringify(p)) }; }
} } };
await import(new URL("../../src/tokens.js", import.meta.url).href);
await import(new URL("../../src/backup.js", import.meta.url).href);
await import(new URL("../../src/store.js", import.meta.url).href);
const { store } = globalThis.OshiDeck;

let fail = 0;
const check = (l, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + l); };
const reset = (d) => { disk = JSON.parse(JSON.stringify(d)); sets = []; };
const base = () => ({ cards: [{ id: "u", tokens: text("888") }, { id: "a", tokens: stamp(A) }],
                      decks: { [A]: ["u", "a"] }, channelMeta: {}, settings: { mode: "hand" } });

console.log("--- read() no longer writes ---");
reset({ presets: { global: [{ id: "g", tokens: text("1") }], channels: {} } });
await store.read();
check("a legacy read persists nothing", sets.length === 0);

console.log("");
console.log("--- operations refuse what the model cannot hold ---");
reset(base());
check("a card cannot join a channel it cannot be sent on",
  (await store.runOp("addToDeck", { channelId: B, cardId: "a" })).ok === false);
check("a card that no longer exists cannot join",
  (await store.runOp("addToDeck", { channelId: A, cardId: "gone" })).ok === false);
check("a card mixing two issuers is refused",
  (await store.runOp("addCard", { card: { id: "m", tokens: [...stamp(A), ...stamp(B)] } })).ok === false);
check("editing into two issuers is refused",
  (await store.runOp("editCard", { id: "u", tokens: [...stamp(A), ...stamp(B)] })).ok === false);

console.log("");
console.log("--- undo cannot reintroduce something invalid ---");
reset(base());
let r = await store.runOp("removeFromDeck", { channelId: A, cardId: "u" });
await store.runOp("editCard", { id: "u", tokens: stamp(B) });   // now a B-only card
await store.runOp("insertIntoDeck", { channelId: A, cardId: "u", at: r.value });
check("undo does not put a B card into A's deck", !(disk.decks[A] || []).includes("u"));

console.log("");
console.log("--- duplicates are settled in one place ---");
reset({ cards: [], decks: {}, channelMeta: {}, settings: {} });
await Promise.all([
  store.runOp("addCard", { card: { id: "x1", tokens: text("888") }, channelId: A }),
  store.runOp("addCard", { card: { id: "x2", tokens: text("888") }, channelId: A })
].map((p, i) => p));
const uniq = new Set(disk.cards.map((c) => JSON.stringify(c.tokens))).size;
console.log("  保存された札:", disk.cards.length, "/ 内容の種類:", uniq);
check("two saves of the same content leave one card", disk.cards.length === 1);

console.log("");
console.log("--- one drag is one operation ---");
reset(base());
await store.runOp("removeFromDeck", { channelId: A, cardId: "u" });
sets = [];
r = await store.runOp("addToDeckAt", { channelId: A, cardId: "u", targetId: "a", side: "before" });
check("add and position commit together", r.ok && sets.length === 1);
check("it landed at the drop target", disk.decks[A].join(" ") === "u a");

console.log("");
console.log("--- settings are not collateral ---");
reset(base());
sets = [];
await store.runOp("markUsed", { id: "u" });
check("an ordinary operation does not write settings", sets[0] === "cards+channelMeta+decks");
const raw = { format: 1, cards: [{ id: "n", tokens: text("9") }], decks: {}, channelMeta: {}, settings: { mode: "list" } };
sets = [];
await store.runOp("importBackup", { raw, mode: "replace" });
check("a restore writes settings in the same set()",
  sets.length === 1 && sets[0] === "cards+channelMeta+decks+settings");
check("and the settings actually applied", disk.settings.mode === "list");

console.log("");
console.log("--- deck undo keeps newer metadata ---");
reset(base());
r = await store.runOp("deleteDeck", { channelId: A });
await store.runOp("setChannel", { channelId: A, name: "renamed", hue: 25 });
await store.runOp("restoreDeck", { snapshot: r.value });
check("a name chosen after the deletion survives undo", disk.channelMeta[A].name === "renamed");
process.exit(fail);
