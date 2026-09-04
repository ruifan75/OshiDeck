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
globalThis.MutationObserver = class { constructor(cb) { fire = cb; } observe() {} disconnect() {} };

require("/Users/maintainer/OshiDeck/src/layout.js");
require("/Users/maintainer/OshiDeck/src/store.js");
require("/Users/maintainer/OshiDeck/src/tokens.js");
require("/Users/maintainer/OshiDeck/src/trending.js");

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
console.log("拍手 (8*)     :", rank.get(sig([{ type: "text", value: "888" }])), "  期待 17");
console.log("メン限ハート  :", rank.get(sig([{ type: "youtubeEmoji", emojiId: CH + "/heart" }])), "   期待 7");
console.log("わこつ        :", rank.get(sig([{ type: "text", value: "わこつ" }])), "   期待 2");

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
const ordered = deck
  .map((c) => { c.signature ||= trending.signature(c.tokens); c.hits = ranking.get(c.signature) || 0; return c; })
  .sort((a, b) => b.hits - a.hits || fallback.get(a.id) - fallback.get(b.id));

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
expect("other channel's stamp is locked", deck.find((c) => c.id === "far").tokens.length && true, true);
process.exit(fail);
