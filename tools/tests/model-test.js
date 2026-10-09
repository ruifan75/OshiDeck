globalThis.OshiDeck = {};
const SAKURA = "UCsakura0000000000000000";
const YUMENO = "UCyumeno0000000000000000";
const stamp = (o) => [{ type: "youtubeEmoji", emojiId: o + "/x", alt: "" }];
const text  = (v) => [{ type: "text", value: v }];
const stored = {
  cards: [
    { id: "univ",    tokens: text("888") },
    { id: "univ2",   tokens: text("wakotsu") },
    { id: "sakuraS", tokens: stamp(SAKURA) },
    { id: "yumenoS", tokens: stamp(YUMENO) }
  ],
  decks: { [SAKURA]: ["univ", "sakuraS"], [YUMENO]: ["yumenoS"] }
};
globalThis.chrome = { runtime: { id: "x" }, storage: { local: { get: async () => stored, set: async () => {} } } };
require("../../src/store.js");
require("../../src/tokens.js");
const S = globalThis.OshiDeck.store;

(async () => {
  const d = await S.read();
  const ids = (l) => l.map((c) => c.id).join(" ") || "(none)";
  let fail = 0;
  const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };
  const pool = (ch) => S.poolFor(d, ch);

  console.log("さくらのプール:", ids(pool(SAKURA)));
  console.log("ゆめののプール:", ids(pool(YUMENO)));
  check("universal cards appear in every pool",
    pool(SAKURA).some(c => c.id === "univ2") && pool(YUMENO).some(c => c.id === "univ2"));
  check("sakura never sees yumeno's stamp", !pool(SAKURA).some(c => c.id === "yumenoS"));
  check("yumeno never sees sakura's stamp", !pool(YUMENO).some(c => c.id === "sakuraS"));

  console.log("");
  console.log("ejecting a channel-bound card:");
  S.removeFromDeck(d, SAKURA, "sakuraS");
  console.log("  さくらのプール:", ids(pool(SAKURA)), " ← 自分のプールに戻る");
  console.log("  ゆめののプール:", ids(pool(YUMENO)), " ← 他所には現れない");
  check("lands in its own pool", pool(SAKURA).some(c => c.id === "sakuraS"));
  check("stays invisible to other channels", !pool(YUMENO).some(c => c.id === "sakuraS"));
  check("can go back", (S.addToDeck(d, SAKURA, "sakuraS"),
    S.deckOf(d, SAKURA).some(c => c.id === "sakuraS")));

  console.log("");
  console.log("nothing can end up unreachable:");
  S.removeFromDeck(d, SAKURA, "sakuraS");
  S.removeFromDeck(d, SAKURA, "univ");
  const reach = new Set();
  for (const ch of Object.keys(d.decks)) {
    for (const c of pool(ch)) reach.add(c.id);
    for (const c of S.deckOf(d, ch)) reach.add(c.id);
  }
  check("every stored card is on screen somewhere", d.cards.every(c => reach.has(c.id)));
  process.exit(fail);
})();
