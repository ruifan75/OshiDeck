// Drawing a card from the chat: which reaction is offered, and where the room
// for it comes from.
//
// The panel sits at the bottom of the chat, so a drawn card must not cost a
// row — the hand tightens instead. And a card that cannot be sent is worse
// than no card, so what is offered is filtered before it is ever shown.
import { readFileSync } from "node:fs";

const source = process.env.OD_SOURCE
  ? new URL(`file://${process.env.OD_SOURCE}`)
  : new URL("../../content.js", import.meta.url);
const src = readFileSync(source, "utf8");

const from = src.indexOf("  // What the chat is doing that this deck cannot already do.");
const to = src.indexOf("  // No tools, no dragging", from);
if (from < 0 || to < 0 || to <= from) {
  console.log("FAIL could not lift drawFromChat out of content.js");
  process.exit(1);
}

globalThis.OshiDeck = {};
// An IIFE, imported for its side effect. OD_LAYOUT lets the mutation checker
// swap in a broken copy.
await import(process.env.OD_LAYOUT ? `file://${process.env.OD_LAYOUT}` : "../../src/layout.js");
const { layout } = globalThis.OshiDeck;

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

/* ---------- which reaction is offered ---------- */

// Signatures stand in for the real normaliser: two wordings of one reaction
// share a signature, which is the only property this code depends on.
const sig = (tokenList) =>
  (tokenList || []).map((t) => (t.type === "text" ? t.value.replace(/(.)\1+/g, "$1") : t.emojiId)).join("|");

const text = (value) => [{ type: "text", value }];
const stamp = (owner) => [{ type: "youtubeEmoji", emojiId: `${owner}/heart`, alt: ":h:" }];

function draw({ suggest = true, chat = [], deck = [] } = {}) {
  const ranking = new Map(
    chat.map(({ tokens, count, score }) => [sig(tokens), { count, score, tokens }])
  );

  const api = new Function(
    "settingsCache", "watcher", "tokens", "trending",
    `${src.slice(from, to)}; return drawFromChat;`
  )(
    { suggest },
    { ranking: () => ranking },
    {
      hasSubstance: (t) => (t || []).some((x) => x.type === "youtubeEmoji" || x.value?.trim()),
      requiredChannels: (t) =>
        [...new Set((t || []).filter((x) => x.emojiId).map((x) => x.emojiId.split("/")[0]))]
    },
    { signature: sig }
  );

  return api(deck);
}

const wave = { tokens: text("かわいい"), count: 9, score: 9 };

check("a strong reaction is offered", draw({ chat: [wave] })?.tokens === wave.tokens);
check("and is marked as not yours", draw({ chat: [wave] })?.drawn === true);
check("carrying the count for the bar to show", draw({ chat: [wave] })?.hits === 9);

check("turned off, nothing is offered", draw({ suggest: false, chat: [wave] }) === null);

check(
  "too few messages is not a wave",
  draw({ chat: [{ tokens: text("かわいい"), count: 2, score: 2 }] }) === null
);

check(
  "an old burst is not a wave either, however many messages it was",
  draw({ chat: [{ tokens: text("8888"), count: 40, score: 1.2 }] }) === null
);

check(
  "a reaction already in the deck is not offered again",
  draw({ chat: [wave], deck: [{ id: "k", tokens: text("かわいいいい") }] }) === null
);

check(
  "member emoji are never offered, even this channel's",
  draw({ chat: [{ tokens: stamp("UCsakura0000000000000000"), count: 20, score: 20 }] }) === null
);

check(
  "nor is something with no substance",
  draw({ chat: [{ tokens: text("   "), count: 20, score: 20 }] }) === null
);

check(
  "the strongest of several is the one offered",
  draw({ chat: [
    { tokens: text("おつ"), count: 8, score: 8 },
    { tokens: text("かわいい"), count: 4, score: 12 },
    { tokens: text("888"), count: 30, score: 6 }
  ] })?.tokens[0].value === "かわいい"
);

/* ---------- where the room comes from ---------- */

const { overlapFor, fitsSqueezed, cardsPerRow, CARD_SIZE, OVERLAP, MAX_OVERLAP } = layout;
const SIDEBAR = 376;            // a 400px chat less the panel padding
const CARD = CARD_SIZE.small;
const GAP = 10;

const resting = cardsPerRow(SIDEBAR, CARD);
const squeezed = overlapFor(SIDEBAR, CARD, resting + 1, GAP);

check("a full row can still take one more", fitsSqueezed(SIDEBAR, CARD, resting + 1, GAP));
check("by tightening the overlap", squeezed > OVERLAP);
check("and no tighter than the cap", squeezed <= MAX_OVERLAP);

const used = CARD + resting * (CARD - squeezed) + GAP;
check("the row still fits the width", used <= SIDEBAR + 0.5);

check(
  "a hand with room to spare is not squeezed at all",
  overlapFor(SIDEBAR, CARD, 3, GAP) === OVERLAP
);

check(
  "a row that cannot fit even squeezed says so",
  !fitsSqueezed(200, CARD, 12, GAP)
);

check(
  "and one card alone needs no overlap",
  overlapFor(SIDEBAR, CARD, 1, GAP) === OVERLAP
);

process.exit(fail);
