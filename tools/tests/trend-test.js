// Drives the real watcher + store against a hand-built DOM.
class Element {}
class El extends Element {
  constructor(tag, childNodes = [], attrs = {}) {
    super();
    this.tagName = tag; this.nodeType = 1; this.childNodes = childNodes; this._attrs = attrs;
  }
  getAttribute(n) { return this._attrs[n] ?? null; }
  querySelector(sel) { return sel === "#message" ? this._attrs.__message ?? null : null; }
  querySelectorAll() { return []; }
}
const text = (value) => ({ nodeType: 3, textContent: value });
const msg  = (...kids) => new El("DIV", kids);
const item = (message) => new El("YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER", [], { __message: message });
const emoji = (id) => new El("IMG", [], { "data-emoji-id": id, src: "https://yt3/" + id, alt: ":x:" });
// YouTube appends one of these inside the message the first time it is
// hovered, and its text is the emoji shortcode.
const tooltip = (t) => new El("TP-YT-PAPER-TOOLTIP", [text(t)]);

globalThis.Element = Element;
globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
globalThis.OshiDeck = {};
globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
globalThis.document = {
  createElement: () => ({ setAttribute() {}, appendChild() {}, set className(v) {}, innerHTML: "" }),
  createDocumentFragment: () => ({ appendChild() {} }),
  querySelector: (s) => (s.includes("#items") ? host : null)
};
let fire = null;
const host = new El("DIV");

// Decay is about elapsed time, so the test needs to move time rather than
// wait for it.
let clock = 1_700_000_000_000;
Date.now = () => clock;
const wait = (ms) => { clock += ms; };
globalThis.MutationObserver = class { constructor(cb) { fire = cb; } observe() {} disconnect() {} };

require("/Users/maintainer/OshiDeck/src/layout.js");
require("/Users/maintainer/OshiDeck/src/store.js");
require(process.env.OD_TOKENS || "/Users/maintainer/OshiDeck/src/tokens.js");
// OD_TRENDING lets the mutation checker swap in a deliberately broken copy.
require(process.env.OD_TRENDING || "/Users/maintainer/OshiDeck/src/trending.js");

const { trending, store, tokens } = globalThis.OshiDeck;
const CH = "UCsakura0000000000000000";
const OTHER = "UCyumeno0000000000000000";

let notified = 0;
const watcher = trending.createWatcher({ onChange: () => notified++ });
console.log("attach:", watcher.start() ? "ok" : "FAIL");

const send = (message, times = 1) => {
  for (let i = 0; i < times; i++) fire([{ addedNodes: [item(message)] }]);
};

// The chat is currently spamming claps, with a few member stamps mixed in.
send(msg(text("88888888")), 12);
send(msg(text("8888")), 5);
send(msg(emoji(CH + "/heart")), 7);
send(msg(text("わこつ")), 2);
send(msg(text("今日の歌よかったね")), 3);

const rank = watcher.ranking();
const sig = (t) => trending.signature(t);
console.log("\n--- ranking (90s window) ---");
const countOf = (t) => rank.get(sig(t))?.count ?? 0;
console.log("拍手 (8*)     :", countOf([{ type: "text", value: "888" }]), "  期待 17");
console.log("メン限ハート  :", countOf([{ type: "youtubeEmoji", emojiId: CH + "/heart" }]), "   期待 7");
console.log("わこつ        :", countOf([{ type: "text", value: "わこつ" }]), "   期待 2");

// My deck: the clap card should rise even though I rarely use it.
const day = 864e5, now = Date.now();
const deck = [
  { id: "onegai", tokens: [{ type: "text", value: "おねがい" }], uses: 40, heat: 40, lastUsedAt: now - day },
  { id: "clap",   tokens: [{ type: "text", value: "888" }],     uses: 1,  heat: 1,  lastUsedAt: now - 30 * day },
  { id: "heart",  tokens: [{ type: "youtubeEmoji", emojiId: CH + "/heart" }], uses: 3, heat: 3, lastUsedAt: now - 2 * day },
  { id: "far",    tokens: [{ type: "youtubeEmoji", emojiId: OTHER + "/star" }], uses: 9, heat: 9, lastUsedAt: now - day }
];

const ranking = watcher.ranking();
const fallback = new Map(store.sortCards(deck, "heat").map((c, i) => [c.id, i]));
const score = (c, rank) => {
  c.signature ||= trending.signature(c.tokens);
  const seen = rank.get(c.signature);
  c.hits = seen?.count || 0;
  c.trend = seen?.score || 0;
  return c;
};
const ordered = deck
  .map((c) => score(c, ranking))
  .sort((a, b) => b.trend - a.trend || fallback.get(a.id) - fallback.get(b.id));

console.log("\n--- deck order ---");
console.log("chat-driven :", ordered.map((c) => `${c.id}(${c.hits})`).join(" > "));
console.log("my habit    :", store.sortCards(deck, "heat").map((c) => c.id).join(" > "));

console.log("\n--- member emoji scope ---");
for (const card of deck) {
  const required = tokens.requiredChannels(card.tokens);
  const locked = required.length > 0 && !required.every((id) => id === CH);
  console.log(`  ${card.id.padEnd(7)} required=${required.length ? required[0].slice(0, 10) + "..." : "-"} locked=${locked}`);
}

let fail = 0;
const expect = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "\nok  " : "\nFAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : " != " + JSON.stringify(want)}`);
};
expect("clap rises to front on chat wave", ordered[0].id, "clap");

/* ---------- a tooltip is not part of the comment ---------- */

// Reaching the ＋ button means hovering the comment, which is exactly when
// YouTube adds the tooltip — so every comment taken that way used to arrive
// with `:musical_notes:` stuck on the end, and any hovered message quietly
// changed its own trend signature.
const plain = msg(text("かわいい"), emoji(CH + "/heart"));
const hovered = msg(text("かわいい"), emoji(CH + "/heart"), tooltip("\n  :musical_notes:"));

expect("a hovered comment reads the same as an unhovered one",
  trending.signature(tokens.collectTokens(hovered)),
  trending.signature(tokens.collectTokens(plain)));

expect("and carries no shortcode text",
  tokens.collectTokens(hovered).some((t) => t.type === "text" && t.value.includes(":")),
  false);

/* ---------- a wave that ended does not hold the front ---------- */

// The reported case: a long burst of applause, then the next song starts and
// a different reaction begins — the applause was still first, because a flat
// window counted every message in it the same.
const later = trending.createWatcher({ onChange: () => {} });
later.start();

const burst = msg(text("8888"));
const fresh = msg(text("かわいい"));

for (let i = 0; i < 40; i++) fire([{ addedNodes: [item(burst)] }]);
wait(80_000);
for (let i = 0; i < 5; i++) fire([{ addedNodes: [item(fresh)] }]);

const late = later.ranking();
const clapSig = sig([{ type: "text", value: "8" }]);
const freshSig = sig([{ type: "text", value: "かわいい" }]);

console.log("\n--- 80 秒前の拍手 40 回 vs いまの 5 回 ---");
console.log("拍手   count:", late.get(clapSig).count, " score:", late.get(clapSig).score.toFixed(2));
console.log("かわいい count:", late.get(freshSig).count, " score:", late.get(freshSig).score.toFixed(2));

expect("the old burst still counts 40 for the viewer", late.get(clapSig).count, 40);
expect("but scores below a small fresh wave", late.get(clapSig).score < late.get(freshSig).score, true);

const two = [
  { id: "clap",  tokens: [{ type: "text", value: "8888" }],   uses: 9, heat: 9, lastUsedAt: clock },
  { id: "kawaii", tokens: [{ type: "text", value: "かわいい" }], uses: 0, heat: 0, lastUsedAt: 0 }
];
const order2 = two
  .map((c) => score(c, late))
  .sort((a, b) => b.trend - a.trend);
expect("so the new reaction takes the front", order2[0].id, "kawaii");
expect("other channel's stamp is locked", deck.find((c) => c.id === "far").tokens.length && true, true);
process.exit(fail);
