// Two contexts racing: without serialisation the second write clobbers the first.
globalThis.OshiDeck = {};
const CH = "UCsakura0000000000000000";

let disk = { cards: [{ id: "a", tokens: [], uses: 0 }, { id: "b", tokens: [], uses: 0 }],
             decks: { [CH]: ["a", "b"] }, channelMeta: {} };
let reads = 0, writes = 0;
const slow = (ms) => new Promise((r) => setTimeout(r, ms));

globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => { reads++; await slow(5); return JSON.parse(JSON.stringify(disk)); },
  set: async (patch) => { writes++; await slow(5); disk = { ...disk, ...JSON.parse(JSON.stringify(patch)) }; }
} } };

await import("/Users/maintainer/OshiDeck/src/tokens.js");
await import("/Users/maintainer/OshiDeck/src/store.js");
const { store } = globalThis.OshiDeck;

let queue = Promise.resolve();
const enqueue = (work) => { const r = queue.then(work, work); queue = r.then(() => {}, () => {}); return r; };

let fail = 0;
const check = (l, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + l); };

// unserialised: both read the same state, one write wins
disk = { cards: [{ id: "a", tokens: [], uses: 0 }, { id: "b", tokens: [], uses: 0 }],
         decks: { [CH]: ["a", "b"] }, channelMeta: {} };
await Promise.all([store.runOp("markUsed", { id: "a" }), store.runOp("reorderDeck", { channelId: CH, movedId: "a", targetId: "b", side: "after" })]);
const racedUses = disk.cards.find((c) => c.id === "a").uses;
const racedOrder = disk.decks[CH].join("");
console.log(`  直列化なし: uses=${racedUses} order=${racedOrder}`);
check("unserialised really does lose one of the two", racedUses === 0 || racedOrder === "ab");

// serialised through the queue
disk = { cards: [{ id: "a", tokens: [], uses: 0 }, { id: "b", tokens: [], uses: 0 }],
         decks: { [CH]: ["a", "b"] }, channelMeta: {} };
await Promise.all([
  enqueue(() => store.runOp("markUsed", { id: "a" })),
  enqueue(() => store.runOp("reorderDeck", { channelId: CH, movedId: "a", targetId: "b", side: "after" }))
]);
const uses = disk.cards.find((c) => c.id === "a").uses;
const order = disk.decks[CH].join("");
console.log(`  直列化あり: uses=${uses} order=${order}`);
check("both survive when serialised", uses === 1 && order === "ba");

// a failing op must not wedge the queue
const boom = enqueue(() => { throw new Error("boom"); }).catch(() => "handled");
check("a thrown op is contained", (await boom) === "handled");
const after = await enqueue(() => store.runOp("markUsed", { id: "b" }));
check("the queue keeps running afterwards", after.ok === true);
process.exit(fail);
