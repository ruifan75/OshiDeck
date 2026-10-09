// Cases from the fourth review.
globalThis.OshiDeck = {};
const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const B = "UCbbbbbbbbbbbbbbbbbbbbbb";
const stamp = (o) => [{ type: "youtubeEmoji", emojiId: o + "/x", alt: "" }];
const text  = (v) => [{ type: "text", value: v }];

let disk = {}, sets = [];
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => JSON.parse(JSON.stringify(disk)),
  set: async (p) => { sets.push(Object.keys(p).sort().join("+")); disk = { ...disk, ...JSON.parse(JSON.stringify(p)) }; }
} } };
await import(new URL("../../src/tokens.js", import.meta.url).href);
await import(new URL("../../src/backup.js", import.meta.url).href);
await import(new URL("../../src/store.js", import.meta.url).href);
const { store, backup } = globalThis.OshiDeck;

let fail = 0;
const check = (l, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + l); };
const reset = (d) => { disk = JSON.parse(JSON.stringify(d)); sets = []; };

console.log("--- a stored scope cannot outrank the emoji ---");
reset({ cards: [{ id: "s", tokens: stamp(A), scope: "global" }], decks: {}, channelMeta: {}, settings: {} });
const d = await store.read();
check("a member card marked global is still its channel's", store.scopeOf(d.cards[0]) === A);
check("and it is not offered to another channel", !store.poolFor(d, B).some((c) => c.id === "s"));

console.log("");
console.log("--- migration keeps what each old format meant ---");
reset({ cards: [{ id: "p", tokens: text("888"), scope: A }], decks: { [A]: ["p"] }, channelMeta: {}, settings: {} });
check("v0.3 channel scope survives", store.scopeOf((await store.read()).cards[0]) === A);
reset({ presets: { global: [{ id: "g", tokens: text("1") }], channels: { [A]: [{ id: "c", tokens: text("2") }] } } });
const legacy = await store.read();
const scope = (id) => store.scopeOf(legacy.cards.find((c) => c.id === id));
check("presets.channels meant channel-only", scope("c") === A);
check("presets.global meant universal", scope("g") === "global");

console.log("");
console.log("--- a deck cannot keep a card it can never send ---");
reset({ cards: [{ id: "s", tokens: stamp(A) }], decks: { [B]: ["s"] }, channelMeta: {}, settings: {} });
check("an impossible membership is dropped on read", ((await store.read()).decks[B] || []).length === 0);

console.log("");
console.log("--- undo does not rebuild impossible state ---");
reset({ cards: [{ id: "u", tokens: text("888"), scope: "global" }], decks: { [A]: ["u"], [B]: ["u"] }, channelMeta: {}, settings: {} });
let r = await store.runOp("setScope", { id: "u", scope: A, channelId: A });
r = await store.runOp("deleteCard", { id: "u" });
await store.runOp("restoreCard", { snapshot: r.value });
check("a restored card does not return to a deck that cannot send it",
  !(disk.decks[B] || []).includes("u"));

console.log("");
console.log("--- duplicates report what they are ---");
reset({ cards: [], decks: {}, channelMeta: {}, settings: {} });
await store.runOp("addCard", { card: { id: "one", tokens: text("888") }, channelId: A, scope: "global" });
r = await store.runOp("addCard", { card: { id: "two", tokens: text("888") }, channelId: A, scope: A });
check("it is reported as a duplicate", r.value.duplicate === true);
check("with the scope it actually has", r.value.scope === "global");
check("and the scope that was wanted", r.value.wanted === A);
check("without quietly re-scoping the existing card", store.scopeOf(disk.cards[0]) === "global");

console.log("");
console.log("--- settings ride the queue ---");
reset({ cards: [], decks: {}, channelMeta: {}, settings: { mode: "hand" } });
sets = [];
r = await store.runOp("setSettings", { patch: { mode: "list" } });
check("a settings change writes settings", sets[0].includes("settings"));
check("and returns the merged object", r.value.mode === "list");

console.log("");
console.log("--- a question does not write ---");
reset({ cards: [{ id: "u", tokens: text("1"), scope: "global" }], decks: { [A]: ["u"], [B]: ["u"] }, channelMeta: {}, settings: {} });
sets = [];
r = await store.runOp("decksHolding", { id: "u" });
check("both decks reported", r.value.length === 2);
check("nothing was written", sets.length === 0);

console.log("");
console.log("--- import ---");
const v1 = { format: 1, cards: [{ id: "p", tokens: text("888") }], decks: { [A]: ["p"] } };
check("format 1 is still accepted", backup.validate(v1) === null);
check("and its plain card stays universal", backup.replace(v1).cards[0].scope === "global");
check("a bad scope string is rejected",
  !!backup.validate({ cards: [{ id: "x", tokens: text("1"), scope: "nonsense" }] }));
check("a member card marked global is rejected",
  !!backup.validate({ cards: [{ id: "x", tokens: stamp(A), scope: "global" }] }));
check("a card filed against its own scope is rejected",
  !!backup.validate({ cards: [{ id: "x", tokens: text("1"), scope: A }], decks: { [B]: ["x"] } }));

console.log("");
console.log("--- merge cannot combine two valid files into an invalid one ---");
const mine = { cards: [{ id: "m", tokens: text("888"), scope: A }], decks: { [A]: ["m"] }, channelMeta: {} };
const theirs = { format: 2, cards: [{ id: "t", tokens: text("888"), scope: "global" }], decks: { [B]: ["t"] }, channelMeta: {} };
const merged = backup.merge(mine, theirs);
const inB = (merged.decks[B] || []).map((id) => merged.cards.find((c) => c.id === id));
console.log("  B のデッキ:", inB.map((c) => `${c.id}(${c.scope})`).join(" ") || "(なし)");
check("B's deck holds nothing scoped to A",
  inB.every((c) => c.scope === "global" || c.scope === B));
check("the two 888 cards stayed distinct", merged.cards.length === 2);
process.exit(fail);
