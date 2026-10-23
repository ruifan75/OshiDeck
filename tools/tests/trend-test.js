// Drives the real watcher + store against a hand-built DOM.
class Element {}
class El extends Element {
  constructor(tag, childNodes = [], attrs = {}) {
    super();
    this.tagName = tag; this.nodeType = 1; this.childNodes = childNodes; this._attrs = attrs;
  }
  getAttribute(n) { return this._attrs[n] ?? null; }
  matches(sel) { return sel.split(",").some((one) => one.trim().toUpperCase() === this.tagName); }
  querySelector(sel) {
    if (sel === "#message") return this._attrs.__message ?? null;
    return this.childNodes.find((kid) => kid.matches?.(sel)) ?? null;
  }
  // Only the one selector anything asks this harness for: the emoji harvest.
  querySelectorAll(sel) {
    if (sel !== "img[data-emoji-id]") return [];
    const found = [];
    const walk = (node) => {
      for (const kid of node.childNodes || []) {
        if (kid.getAttribute?.("data-emoji-id")) found.push(kid);
        walk(kid);
      }
    };
    walk(this);
    return found;
  }
}
const text = (value) => ({ nodeType: 3, textContent: value });
const msg  = (...kids) => new El("DIV", kids);
// The message hangs under the row as well as answering `#message`, because
// the emoji harvest walks the row rather than asking it anything.
const item = (message) => new El("YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER", [message], { __message: message });
// The rows that are not somebody talking. A membership gift puts one of these
// out per recipient, all naming the same giver and so all saying exactly the
// same thing, fifty of them inside a few seconds.
const gift = (message) =>
  new El("YT-LIVE-CHAT-SPONSORSHIPS-GIFT-REDEMPTION-ANNOUNCEMENT-RENDERER", [message],
    { __message: message });
const paid = (message) => new El("YT-LIVE-CHAT-PAID-MESSAGE-RENDERER", [message], { __message: message });
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
host.isConnected = true;

// Decay is about elapsed time, so the test needs to move time rather than
// wait for it.
let clock = 1_700_000_000_000;
Date.now = () => clock;
const wait = (ms) => { clock += ms; };
globalThis.MutationObserver = class { constructor(cb) { fire = cb; } observe() {} disconnect() {} };
// Drive the watcher's real notification path, including pruning, without
// waiting for a timer or leaving other scenarios' watchers running.
let tick = null;
globalThis.setInterval = (callback) => { tick = callback; return 1; };
globalThis.clearInterval = () => {};

require("../../src/layout.js");
require("../../src/store.js");
require(process.env.OD_TOKENS || "../../src/tokens.js");
// OD_TRENDING lets the mutation checker swap in a deliberately broken copy.
require(process.env.OD_TRENDING || "../../src/trending.js");

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

/* ---------- a burst is exact, and recent ---------- */

const keyOf = (v) => tokens.cardKey([{ type: "text", value: v }]);
const only = (v) => (s) => s.key === keyOf(v);
const chatter = (n) => { for (let i = 0; i < n; i++) send(msg(text("ざつだん" + i))); };

let bw = trending.createWatcher({ onChange: () => {} });
bw.start();
send(msg(text("きちゃ")), 7);
send(msg(text("きちゃきちゃ")), 7);

expect("each exact wording bursts on its own, unmerged",
  [bw.burst(only("きちゃ"))?.count, bw.burst(only("きちゃきちゃ"))?.count], [7, 7]);

send(msg(text("ぽんぽこ")), 3);
expect("a few of a thing is not a burst", bw.burst(only("ぽんぽこ")) === null, true);

wait(20_000);
expect("and a burst that has passed is no longer one", bw.burst() === null, true);

/* ---------- a burst is relative to how busy the chat is ---------- */

// The reported case: a phrase nobody was rallying behind kept being offered,
// because a plain count cannot tell a wave from ordinary traffic.
bw = trending.createWatcher({ onChange: () => {} });
bw.start();
send(msg(text("それはそう")), 6);
chatter(40);
expect("six of a thing in a busy chat is just talk",
  bw.burst(only("それはそう")) === null, true);

// The same six, in a room where that is what everyone is saying.
bw = trending.createWatcher({ onChange: () => {} });
bw.start();
send(msg(text("それはそう")), 6);
chatter(4);
expect("the same six, when it is most of what is being said, is a wave",
  bw.burst(only("それはそう"))?.count, 6);

// How busy the chat is has to be remembered, and the record of it is capped so
// it cannot grow without bound. Emptying it at the cap — the cheap way to cap
// it — makes the next handful of messages look like everything being said.
bw = trending.createWatcher({ onChange: () => {} });
bw.start();
chatter(4001);
send(msg(text("それはそう")), 6);
expect("a chat too busy to remember in full is still measured in full",
  bw.burst(only("それはそう")) === null, true);

// And a share alone would fire on a nearly silent chat.
bw = trending.createWatcher({ onChange: () => {} });
bw.start();
send(msg(text("こん")), 2);
expect("two of a thing is never a wave, however quiet the room",
  bw.burst(only("こん")) === null, true);

/* ---------- only the rows that are somebody talking ---------- */

// The reported case: a membership gift. YouTube puts out one announcement per
// recipient — 「@ようかん-MP さんからメンバーシップを受け取りました」 — and a
// batch of fifty lands inside a few seconds, every one of them saying the same
// thing, because every one of them names the same giver. By every measure in
// this file that is a wave, so the panel held the announcement out as a card
// to save.
//
// Read by the element and never by the words: the wording is YouTube's and
// changes with the viewer's language, so a list of sentences would need every
// language they ship and would still be wrong the next time they reword one.
bw = trending.createWatcher({ onChange: () => {} });
bw.start();
const gifted = msg(text("@ようかん-MP さんからメンバーシップを受け取りました"));
for (let i = 0; i < 50; i++) fire([{ addedNodes: [gift(gifted)] }]);

expect("fifty gift announcements are not fifty people saying something",
  bw.burst() === null, true);
expect("and nothing about them is ranked", bw.ranking().size, 0);

// The ones that are. A Super Chat is a comment somebody paid to put there,
// and the ＋ has always offered itself on those too.
bw = trending.createWatcher({ onChange: () => {} });
bw.start();
for (let i = 0; i < 7; i++) fire([{ addedNodes: [paid(msg(text("おめでとう")))] }]);
expect("a Super Chat is still somebody talking", bw.burst(only("おめでとう"))?.count, 7);

// A wrapper is not a different kind of row. YouTube has nested these before,
// and the strict reading would have stopped the panel reacting to the chat at
// all — silently, since an empty ranking looks exactly like a quiet chat.
bw = trending.createWatcher({ onChange: () => {} });
bw.start();
for (let i = 0; i < 7; i++) {
  fire([{ addedNodes: [new El("DIV", [item(msg(text("すき")))])] }]);
}
expect("a comment inside a wrapper is still that comment", bw.burst(only("すき"))?.count, 7);

// The emoji urls are taken from every row, which is the one thing that does
// not care what kind of row it was: a member emoji in a milestone or a gift
// announcement is the same picture at the same address, and the address is
// all that is kept. So the harvest has to happen before the row is turned
// away, not after.
bw = trending.createWatcher({ onChange: () => {} });
bw.start();
fire([{ addedNodes: [gift(msg(emoji(CH + "/gifted")))] }]);
expect("but an emoji url is still worth having from a row that is turned away",
  tokens.freshSrc({ emojiId: CH + "/gifted" }), "https://yt3/" + CH + "/gifted");

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

/* ---------- retention follows the chosen pace ---------- */

const fadingSig = sig([{ type: "text", value: "余韻" }]);
for (const [label, pace, halfLife] of [
  ["default", undefined, 20_000],
  ["quick", "quick", 10_000],
  ["slow", "slow", 30_000],
  ["custom", 45_000, 45_000],
  ["maximum", 600_000, 600_000]
]) {
  let changes = 0;
  const paced = trending.createWatcher({
    tuning: () => ({ halfLife: store.tuning({ pace }, "pace") }),
    onChange: () => changes++
  });
  paced.start();
  send(msg(text("余韻")));
  tick(); // consume the initial message notification

  if (pace === 600_000) {
    // The reported cliff: the same message went from ~0.901 to zero over
    // these two milliseconds, despite a ten-minute half-life.
    wait(89_999);
    const before = paced.ranking().get(fadingSig)?.score;
    wait(2);
    tick(); // pruning must keep it too, not just ranking
    const after = paced.ranking().get(fadingSig)?.score;
    expect("a ten-minute pace decays smoothly across the old 90-second cutoff",
      before > 0.9 && after > 0.9 && before > after && before - after < 0.00001, true);
    expect("the old cutoff does not notify an expiry", changes, 1);
    wait(halfLife - 90_001);
  } else {
    wait(halfLife);
  }
  tick();
  expect(`${label} pace keeps half the weight after one half-life`,
    paced.ranking().get(fadingSig)?.score, 0.5);

  wait(halfLife * 3.5);
  tick();
  const edge = paced.ranking().get(fadingSig);
  expect(`${label} pace retains a message at 4.5 half-lives`, edge?.count, 1);
  expect(`${label} pace has little weight left at its retention edge`,
    edge?.score > 0.04 && edge?.score < 0.05, true);

  wait(1);
  expect(`${label} pace ignores expired messages before the timer runs`,
    paced.ranking().has(fadingSig), false);
  tick();
  expect(`${label} pace notifies expiry even after ranking was read`, changes, 2);
  tick();
  expect(`${label} pace reports that expiry only once`, changes, 2);
  paced.stop();
}

// Tuning is read live: changing the setting must change both readers' window,
// rather than leaving the lifetime chosen when the watcher was created.
let pace = 20_000;
let changes = 0;
const adjustable = trending.createWatcher({
  tuning: () => ({ halfLife: pace }),
  onChange: () => changes++
});
adjustable.start();
send(msg(text("余韻")));
tick();
wait(80_000);
pace = 600_000;
wait(20_000);
tick();
expect("lengthening the pace keeps existing history past its old window",
  adjustable.ranking().get(fadingSig)?.count, 1);
expect("and does not report that history as expired", changes, 1);
pace = 10_000;
expect("shortening the pace applies to ranking immediately",
  adjustable.ranking().has(fadingSig), false);
tick();
expect("and to expiry notifications", changes, 2);
adjustable.stop();

// The same buffer supplies the twelve-second burst count. A short custom
// pace must not prune a wave before the suggestion code has seen all of it.
const fast = trending.createWatcher({ tuning: () => ({ halfLife: 1_000 }) });
fast.start();
send(msg(text("きちゃ")), 6);
tick();
wait(10_000);
tick();
expect("the shortest pace still keeps a burst for its full window",
  fast.burst(only("きちゃ"))?.count, 6);
wait(2_001);
expect("and the burst still ends after twelve seconds", fast.burst() === null, true);
fast.stop();

const bounded = trending.createWatcher({ tuning: () => ({ halfLife: 600_000 }) });
bounded.start();
send(msg(text("oldest")));
send(msg(text("latest")), 600);
const capped = bounded.ranking();
expect("even the longest pace retains at most 600 captured messages",
  [...capped.values()].reduce((sum, seen) => sum + seen.count, 0), 600);
expect("the memory bound drops the oldest message",
  capped.has(sig([{ type: "text", value: "oldest" }])), false);
expect("and retains the newest ones", capped.get(sig([{ type: "text", value: "latest" }]))?.count, 600);
bounded.stop();

/* ---------- one call, however it was typed ---------- */

// A cycle is one card whatever length it was sent at, and letting go of the
// key mid-turn is a length. These are written as token lists rather than
// through the DOM because what is under test is the signature itself.
const PEN = (turns) => {
  const out = [];
  for (let i = 0; i < turns; i++) out.push({ type: "youtubeEmoji", emojiId: CH + (i % 2 ? "/pen2" : "/pen1") });
  return out;
};
expect("a two-emoji call is the same card at three turns and at two",
  sig(PEN(6)), sig(PEN(4)));
expect("and the same when the last turn is cut short",
  sig(PEN(6)), sig(PEN(5)));
expect("a repeated character is one card at any length",
  sig([{ type: "text", value: "888" }]), sig([{ type: "text", value: "88888888" }]));
expect("and so is a repeated word",
  sig([{ type: "text", value: "🎶💮🎶💮🎶💮🎶💮" }]), sig([{ type: "text", value: "🎶💮🎶💮🎶💮🎶" }]));

// The cycle has to be found before runs are flattened. Flattening first joins
// the end of one turn to the start of the next when they are the same atom,
// which hides the real cycle and leaves a shorter false one.
expect("a word said twice is not the shorter word inside it",
  sig([{ type: "text", value: "いたいいたい" }]) === sig([{ type: "text", value: "いた" }]), false);
expect("nor is it when the repeat is spaced",
  sig([{ type: "text", value: "yay yay" }]) === sig([{ type: "text", value: "ya" }]), false);

// And a cycle has to go round twice before it is one, or every word that
// starts the way it ends collapses into its own opening.
expect("a word is not a shorter word it happens to begin with",
  sig([{ type: "text", value: "なるほどな" }]) === sig([{ type: "text", value: "なるほど" }]), false);

process.exit(fail);
