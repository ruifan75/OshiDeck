globalThis.OshiDeck = { tokens: {
  cardKey: (list) => (list || [])
    .map((x) => (x.type === "youtubeEmoji" ? "emoji:" + x.emojiId : x.value || ""))
    .join("").replace(/\s+/g, " ").trim(),
  requiredChannels: (list) => [...new Set((list || [])
    .map((x) => /^(UC[A-Za-z0-9_-]{22})\//.exec(x.emojiId || "")?.[1])
    .filter(Boolean))]
} };
require("../../src/backup.js");
const B = globalThis.OshiDeck.backup;
const t = (v) => [{ type: "text", value: v }];

const mine = {
  cards: [
    { id: "a", tokens: t("888"), by: { UCsakura: { uses: 40, heat: 40, lastUsedAt: 111 } } },
    { id: "b", tokens: t("wakotsu"), by: { UCsakura: { uses: 5, heat: 5, lastUsedAt: 222 } } }
  ],
  decks: { UCsakura: ["a", "b"] },
  channelMeta: { UCsakura: { name: "sakura", hue: 320 } }
};
const theirs = {
  format: 1,
  cards: [
    { id: "zzz", tokens: t("888"),  uses: 999, heat: 999, lastUsedAt: 999 },
    { id: "a",   tokens: t("GG!"),  uses: 7,   heat: 7,   lastUsedAt: 333 },
    { id: "new", tokens: t("otsu"), uses: 3,   heat: 3,   lastUsedAt: 444 }
  ],
  decks: { UCsakura: ["zzz", "a"], UCyumeno: ["new", "a"] },
  channelMeta: { UCsakura: { name: "SAKURA", hue: 25 }, UCyumeno: { name: "yumeno", hue: 145 } }
};

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

console.log("--- validate ---");
check("valid file accepted", B.validate(theirs) === null);
console.log("     broken card   ->", B.validate({ cards: [{ id: "x" }] }));
console.log("     dangling ref  ->", B.validate({ cards: [{ id: "x", tokens: [] }], decks: { C: ["nope"] } }));
console.log("     not an object ->", B.validate([]));
console.log("     future format ->", B.validate({ format: 99, cards: [] }));
check("broken card rejected", B.validate({ cards: [{ id: "x" }] }) !== null);
check("dangling deck ref rejected", B.validate({ cards: [{ id: "x", tokens: [] }], decks: { C: ["nope"] } }) !== null);

console.log("");
console.log("--- merge ---");
const m = B.merge(mine, theirs);
console.log("     added " + m.added + " card(s), linked " + m.linked + " deck entries");
console.log("     pool  :", m.cards.map((c) => c.id.slice(0, 4) + "=" + c.tokens[0].value + "(" + c.uses + ")").join("  "));
console.log("     sakura:", m.decks.UCsakura.map((id) => id.slice(0, 4)).join(" "));
console.log("     yumeno:", m.decks.UCyumeno.map((id) => id.slice(0, 4)).join(" "));

check("same content is not duplicated", m.cards.filter((c) => c.tokens[0].value === "888").length === 1);
check("my own usage counts survive", m.cards.find((c) => c.id === "a").by.UCsakura.uses === 40);
check("id collision gets a fresh id", m.cards.find((c) => c.tokens[0].value === "GG!").id !== "a");
check("someone elses counts start cold",
  Object.keys(m.cards.find((c) => c.tokens[0].value === "otsu").by || {}).length === 0);
check("my channel name wins", m.channelMeta.UCsakura.name === "sakura");
check("unknown channel is adopted", m.channelMeta.UCyumeno.name === "yumeno");
check("original deck order kept", m.decks.UCsakura.slice(0, 2).join(" ") === "a b");

console.log("");
console.log("--- merging the same file twice must change nothing ---");
const again = B.merge(m, theirs);
console.log("     added " + again.added + ", linked " + again.linked);
check("idempotent", again.added === 0 && again.linked === 0);

console.log("");
console.log("--- replace ---");
const r = B.replace(theirs);
check("replace keeps the file's history", r.cards.find((c) => c.id === "zzz").uses === 999);
check("replace is a deep copy", r.cards[0].tokens !== theirs.cards[0].tokens);

process.exit(fail);
