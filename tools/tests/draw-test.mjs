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

const from = src.indexOf("  // A card is drawn when the chat bursts");
const to = src.indexOf("  function buildDrawnRow(", from);
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

// Exact wording, the way cardKey is: `きちゃ` and `きちゃきちゃ` are different
// things to say, even though the sort deliberately treats them as one.
const key = (tokenList) =>
  (tokenList || []).map((t) => (t.type === "text" ? t.value : "\u0001" + t.emojiId)).join("").trim();

const text = (value) => [{ type: "text", value }];
const stamp = (owner) => [{ type: "youtubeEmoji", emojiId: `${owner}/heart`, alt: ":h:" }];

const tokenStub = {
  cardKey: key,
  hasSubstance: (t) => (t || []).some((x) => x.type === "youtubeEmoji" || x.value?.trim()),
  requiredChannels: (t) =>
    [...new Set((t || []).filter((x) => x.emojiId).map((x) => x.emojiId.split("/")[0]))]
};

// One panel, kept across calls so the hold can be observed. `chat` is what the
// watcher would report as a burst right now; set it to null for a quiet chat.
function panel({ suggest = true, now = 1_000_000 } = {}) {
  const state = { chat: null, now };

  const api = new Function(
    "settingsCache", "watcher", "tokens", "Date",
    `${src.slice(from, to)}; return { drawFromChat, holdMs: HOLD_MS };`
  )(
    { suggest },
    {
      burst: (accept) => {
        const seen = state.chat && { key: key(state.chat.tokens), count: state.chat.count, tokens: state.chat.tokens };
        return seen && (!accept || accept(seen)) ? seen : null;
      }
    },
    tokenStub,
    { now: () => state.now }
  );

  return {
    holdMs: api.holdMs,
    chat(next) { state.chat = next; return this; },
    tick(ms) { state.now += ms; return this; },
    draw: (deck = []) => api.drawFromChat(deck)
  };
}

const draw = ({ suggest = true, chat = null, deck = [] } = {}) =>
  panel({ suggest }).chat(chat).draw(deck);

const wave = { tokens: text("かわいい"), count: 9 };

check("a burst is offered", draw({ chat: wave })?.tokens === wave.tokens);
check("and is marked as not yours", draw({ chat: wave })?.drawn === true);
check("carrying the count for the bar to show", draw({ chat: wave })?.hits === 9);

check("a quiet chat offers nothing", draw({ chat: null }) === null);
check("turned off, nothing is offered", draw({ suggest: false, chat: wave }) === null);

check(
  "member emoji are never offered, even this channel's",
  draw({ chat: { tokens: stamp("UCsakura0000000000000000"), count: 20 } }) === null
);

check(
  "nor is something with no substance",
  draw({ chat: { tokens: text("   "), count: 20 } }) === null
);

/* ---------- exact wording, not the sort's loose one ---------- */

check(
  "a reaction already in the deck is not offered again",
  draw({ chat: wave, deck: [{ id: "k", tokens: text("かわいい") }] }) === null
);

// The sort collapses repeats on purpose; offering must not.
check(
  "holding きちゃ does not cover きちゃきちゃ",
  draw({ chat: { tokens: text("きちゃきちゃ"), count: 6 }, deck: [{ id: "k", tokens: text("きちゃ") }] })
    ?.tokens[0].value === "きちゃきちゃ"
);

/* ---------- it stays put once drawn ---------- */

const p = panel();
const first = p.chat({ tokens: text("888"), count: 5 }).draw();
check("the first burst is drawn", first?.tokens[0].value === "888");

p.chat({ tokens: text("かわいい"), count: 9 }).tick(5_000);
check("a louder burst does not replace it while it is held", p.draw() === first);

p.tick(p.holdMs);
check("once the hold is over, the newer burst takes its place",
  p.draw()?.tokens[0].value === "かわいい");

// Taking it into the deck ends the offer even mid-hold.
const q = panel();
const offered = q.chat({ tokens: text("888"), count: 5 }).draw();
check("something is offered to begin with", !!offered);
q.chat(null);
check("keeping it ends the offer", q.draw([{ id: "own", tokens: text("888") }]) === null);

/* ---------- where the room comes from ---------- */

const { overlapFor, fitsSqueezed, besideDrawn, cardsPerRow, CARD_SIZE, OVERLAP, MAX_OVERLAP } = layout;
const SIDEBAR = 376;            // a 400px chat less the panel padding
const CARD = CARD_SIZE.small;
const GAP = 14;

// The width the row actually takes, composed the way the DOM composes it: the
// drawn card is a slot of its own with a margin, and only the hand overlaps.
// The first version of this asserted the formula against itself and so missed
// that the drawn card was being counted as one more overlapping card, which
// left every row an overlap too wide.
const rowWidth = (count, overlap, { withDrawn = false } = {}) =>
  (withDrawn ? CARD + GAP : 0) +
  (count > 0 ? CARD + (count - 1) * (CARD - overlap) : 0);

const resting = cardsPerRow(SIDEBAR, CARD);
check("a full row of a 400px sidebar is seven small cards", resting === 7);
check("which fills it at the resting overlap", rowWidth(resting, OVERLAP) <= SIDEBAR);

const handWidth = besideDrawn(SIDEBAR, CARD, GAP);
const squeezed = overlapFor(handWidth, CARD, resting);

check("that same row can still be dealt a card", fitsSqueezed(handWidth, CARD, resting));
check("by tightening the overlap", squeezed > OVERLAP);
check("and no tighter than the cap", squeezed <= MAX_OVERLAP);
check(
  "and the row, drawn card and all, still fits",
  rowWidth(resting, squeezed, { withDrawn: true }) <= SIDEBAR + 0.5
);

check(
  "a hand with room to spare is not squeezed at all",
  overlapFor(besideDrawn(SIDEBAR, CARD, GAP), CARD, 3) === OVERLAP
);

check(
  "an empty deck still has room for the card it is dealt",
  fitsSqueezed(besideDrawn(SIDEBAR, CARD, GAP), CARD, 0)
);

check(
  "a row too narrow to manage it says so",
  !fitsSqueezed(besideDrawn(150, CARD, GAP), CARD, 7)
);

process.exit(fail);
