// Membership: whether the member emoji on a card can actually be sent.
//
// Everything here was measured on a real stream rather than worked out, and
// the measurements are what make it worth testing. The signal is my own badge
// in the author chip beside the chat input — the only place in the page that
// answers for *me*. The message list is full of other people's badges (57 on
// a stream I was not a member of), so the scope of the query is the whole
// guarantee: unscoped, any chat with members at all says I am one.
//
// The other measured facts, both of which would have made a plausible signal
// and are both wrong:
//
//   * the chip carries `hidden` in a popped-out chat while the badge is right
//     there, so its visibility says nothing
//   * `isSponsor` / `loyaltyBadges` / `sponsorOnly` appear nowhere in the
//     page's HTML — the DOM is the only route
import { readFileSync } from "node:fs";

globalThis.OshiDeck = {};
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => ({}), set: async () => {}
} } };
await import("../../src/tokens.js");
await import("../../src/backup.js");
await import(`file://${process.env.OD_STORE || "/Users/maintainer/OshiDeck/src/store.js"}`);
const { store } = globalThis.OshiDeck;

const source = process.env.OD_SOURCE
  ? new URL(`file://${process.env.OD_SOURCE}`)
  : new URL("../../content.js", import.meta.url);
const src = readFileSync(source, "utf8");

const from = src.indexOf("  // Am I a member of the channel running this chat?");
// Far enough to take orderDeck with it: where a locked card ends up is
// decided there, and a rule that is never applied is worth nothing.
const to = src.indexOf("  // A card is drawn when the chat bursts", from);
if (from < 0 || to < 0 || to <= from) {
  console.log("FAIL could not lift the membership rule out of content.js");
  process.exit(1);
}

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

const HERE = "UCsakura0000000000000000";
const AWAY = "UCyumeno0000000000000000";

const text = (value) => [{ type: "text", value }];
const stamp = (owner) => [{ type: "youtubeEmoji", emojiId: `${owner}/heart`, alt: ":h:" }];

// A stand-in for the chat page. `mine` is the badge in the chip beside the
// input; `others` is the crowd — every one of whose badges matches an
// unscoped query.
function page({ chip = true, mine = false, others = 57 } = {}) {
  const badge = { who: "a badge" };
  const chipEl = {
    hidden: true,   // a popped-out chat hides the chip and is still a member
    querySelector: (sel) => (mine && /author-badge-renderer/.test(sel) ? badge : null)
  };
  return {
    querySelector(sel) {
      const scoped = /message-input-renderer/.test(sel);
      if (scoped && /author-chip/.test(sel)) return chip ? chipEl : null;
      if (scoped && /author-badge-renderer/.test(sel)) return mine ? badge : null;
      // Unscoped: the message list answers, and it is not answering about me.
      if (/author-badge-renderer/.test(sel)) return others > 0 ? badge : null;
      return null;
    }
  };
}

const lift = (doc, ranking = new Map()) => new Function(
  "document", "tokens", "store", "watcher", "trending",
  `${src.slice(from, to)}
   return { membership, whyNotSendable, markLocked, playableFirst, orderDeck };`
)(
  doc,
  {
    requiredChannels: (list) =>
      [...new Set((list || []).filter((t) => t.emojiId).map((t) => t.emojiId.split("/")[0]))]
  },
  store,                                    // the real sort, not a stand-in
  { ranking: () => ranking },
  { signature: (list) => JSON.stringify(list) }
);

/* ---------- am I a member ---------- */

check("my own badge beside the input says yes", lift(page({ mine: true })).membership() === true);

check(
  "a chat full of other people's members is not me",
  lift(page({ mine: false, others: 57 })).membership() === false
);

check(
  "a hidden chip still answers, since a popped-out chat hides it either way",
  lift(page({ mine: true })).membership() === true
);

// Not knowing is its own answer. The alternative — reading a page that has
// not rendered yet as "not a member" — locks a card that is perfectly fine.
check("no chip at all is not a no", lift(page({ chip: false })).membership() === null);

/* ---------- what that buys ---------- */

const rule = lift(page()).whyNotSendable;

check("plain words send anywhere", rule(text("わこつ"), HERE, false) === "");
check("this channel's emoji send while you are a member", rule(stamp(HERE), HERE, true) === "");
check("and stop the moment the membership does", rule(stamp(HERE), HERE, false) === "membership");
check("another channel's never send here", rule(stamp(AWAY), HERE, true) === "elsewhere");

// Two guesses that would both be wrong, and both used to be made.
check("with no channel known, nothing is refused", rule(stamp(AWAY), null, false) === "");
check("and a page that has not said yet refuses nothing", rule(stamp(HERE), HERE, null) === "");

/* ---------- the deck, once it knows ---------- */

const card = (id, tokenList) => ({ id, tokens: tokenList });
const hand = () => [
  card("plain", text("888")),
  card("ours", stamp(HERE)),
  card("theirs", stamp(AWAY))
];

const { markLocked, playableFirst } = lift(page());

let cards = markLocked(hand(), HERE, true);
check("a member keeps this channel's emoji playable", cards[1].locked === false);
check("and still cannot send another channel's", cards[2].locked === true);
check("which is not something becoming a member would fix", cards[2].lapsed === false);

cards = markLocked(hand(), HERE, false);
check("an expired membership locks the card", cards[1].locked === true);
check("and says that is what happened", cards[1].lapsed === true);
check("without touching the plain card", cards[0].locked === false);

cards = markLocked(hand(), null, false);
check("no channel, no locks", cards.every((c) => !c.locked));

/* ---------- and where they end up ---------- */

// Whatever the order is. A card that cannot be played sitting mid-hand is
// exactly where the eye looks for the next thing to send — and it stays in
// the deck, because a membership can come back and the place it had is worth
// keeping.
const order = (cards, channelId, member) =>
  playableFirst(markLocked(cards, channelId, member)).map((c) => c.id).join(",");

// A locked card first in the order has to move all the way past the rest.
check(
  "a locked card is moved to the end, wherever the order put it",
  order([card("theirs", stamp(AWAY)), card("plain", text("888")), card("ours", stamp(HERE))], HERE, true)
    === "plain,ours,theirs"
);

check(
  "and an expired membership moves that card too",
  order([card("ours", stamp(HERE)), card("plain", text("888"))], HERE, false) === "plain,ours"
);

check(
  "the ones that can be played keep the order they were given",
  order([card("b", text("2")), card("a", text("1")), card("theirs", stamp(AWAY))], HERE, true)
    === "b,a,theirs"
);

check("and nothing is dropped on the way", playableFirst(markLocked(hand(), HERE, false)).length === 3);

check(
  "with nothing locked the order is left exactly as it was",
  order(hand(), HERE, true) === "plain,ours,theirs"
);

/* ---------- and that the order actually applies it ---------- */

// Sorting and locking are two rules, and the second is only worth anything
// where the first one hands over. Every sort goes through the same door.
const deck = (channelId, member) => {
  const cards = [
    { id: "ours", tokens: stamp(HERE), uses: 99, heat: 99, lastUsedAt: Date.now() },
    { id: "plain", tokens: text("888"), uses: 1, heat: 1, lastUsedAt: 1 }
  ];
  return lift(page()).orderDeck(markLocked(cards, channelId, member), { sortBy: "uses" });
};

check(
  "the most-used card still goes last once it cannot be sent",
  deck(HERE, false).map((c) => c.id).join(",") === "plain,ours"
);
check("and comes back to the front when it can", deck(HERE, true).map((c) => c.id).join(",") === "ours,plain");

// Chat-driven is a second sort with its own exit, and it was a second place
// to forget.
const loud = new Map([[JSON.stringify(stamp(HERE)), { score: 100, count: 30 }]]);
const trendy = (member) => {
  const cards = [
    { id: "ours", tokens: stamp(HERE), heat: 1, lastUsedAt: 1 },
    { id: "plain", tokens: text("888"), heat: 1, lastUsedAt: 1 }
  ];
  const api = lift(page(), loud);
  return api.orderDeck(api.markLocked(cards, HERE, member), { sortBy: "trend" })
    .map((c) => c.id).join(",");
};

check("the loudest reaction in the chat leads while you can send it", trendy(true) === "ours,plain");
check("and goes to the back when you cannot", trendy(false) === "plain,ours");

/* ---------- saving one you cannot send ---------- */

// Nothing above can see this: the rule can be right while the code that saves
// a card never asks it. Position is the only thing that says so.
{
  const saveAt = src.indexOf("  async function saveTokens(");
  const askAt = src.indexOf("whyNotSendable(captured", saveAt);
  const writeAt = src.indexOf("store.apply(", saveAt);
  check("saving asks whether the card can be sent", saveAt >= 0 && askAt > saveAt);
  check("and asks before it writes anything", askAt > 0 && writeAt > 0 && askAt < writeAt);
}

process.exit(fail);
