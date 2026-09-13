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
import { page } from "./page.mjs";

globalThis.OshiDeck = {};
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => ({}), set: async () => {}
} } };
await import("../../src/tokens.js");
await import("../../src/backup.js");
await import(`file://${process.env.OD_STORE || "/Users/maintainer/OshiDeck/src/store.js"}`);
// The signature is what findDuplicate uses to spot a near-miss, so the real
// one comes along too rather than a stand-in that would agree with anything.
globalThis.document = { querySelector: () => null };
await import("../../src/trending.js");
const { store } = globalThis.OshiDeck;

const source = process.env.OD_SOURCE
  ? new URL(`file://${process.env.OD_SOURCE}`)
  : new URL("../../content.js", import.meta.url);
const src = readFileSync(source, "utf8");

// Wide enough to take the callers with it. A rule that is never applied is
// worth nothing, and the ways to not apply it are all at call sites: the deck
// that never asks, the order that never partitions, the save that never
// refuses.
const cut = (start, end) => {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from);
  if (from < 0 || to <= from) {
    console.log(`FAIL could not lift ${JSON.stringify(start.trim().slice(0, 40))} out of content.js`);
    process.exit(1);
  }
  return src.slice(from, to);
};

const lifted = [
  // buildDeck, the membership rule, markLocked, playableFirst, orderDeck
  cut("  // Nothing appears here unless it was put here", "  // A card is drawn when the chat bursts"),
  // saveTokens
  cut("  async function saveTokens(", "  function clearInput("),
  // reconcileChannel and findDuplicate, which saveTokens leans on
  cut("  function reconcileChannel(", "  function flashCard("),
  // what the panel does when the page changes under it
  cut("  let lastMembership = null;", "  const observer = new MutationObserver(")
].join("\n");

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

const HERE = "UCsakura0000000000000000";
const AWAY = "UCyumeno0000000000000000";

const text = (value) => [{ type: "text", value }];
const stamp = (owner) => [{ type: "youtubeEmoji", emojiId: `${owner}/heart`, alt: ":h:" }];

const { tokens, trending } = globalThis.OshiDeck;

// Everything the lifted code reaches for. `seen` is what came back out.
const input = { id: "the editor" };

function lift({ doc = page(), ranking = new Map(), channel = { id: HERE, name: "さくら" },
                disk = null } = {}) {
  const seen = { writes: [], toasts: [], renders: 0 };
  const api = new Function(
    "document", "tokens", "store", "watcher", "trending",
    "getChannel", "showToast", "shutdown", "render", "flashCard", "journal", "log", "editingId",
    "findChatInput", "currentInput", "rootEl", "scheduleRender",
    `${lifted}
     return { membership, whyNotSendable, markLocked, playableFirst, orderDeck,
              buildDeck, saveTokens, reconcileChannel, onPageChanged };`
  )(
    doc,
    tokens,
    {
      ...store,
      read: async () => disk,
      apply: async (op, args) => {
        seen.writes.push({ op, args });
        return { ok: true, value: { id: args.card?.id || "new", added: 1 } };
      }
    },
    { ranking: () => ranking },
    trending,
    () => channel,
    (message) => seen.toasts.push(message),
    () => seen.toasts.push("shutdown"),
    () => { seen.renders += 1; },
    () => {},
    { record: () => {} },
    () => {},
    null,
    () => input,             // the input is there and has not moved
    input,
    { isConnected: true },
    () => { seen.renders += 1; }
  );
  return { ...api, seen };
}

/* ---------- am I a member ---------- */

check("my own badge beside the input says yes", lift({ doc: page({ mine: true }) }).membership() === true);

check(
  "a chat full of other people's members is not me",
  lift({ doc: page({ mine: false, others: 57 }) }).membership() === false
);

check(
  "a hidden chip still answers, since a popped-out chat hides it either way",
  lift({ doc: page({ mine: true }) }).membership() === true
);

// Not knowing is its own answer. The alternative — reading a page that has
// not rendered yet as "not a member" — locks a card that is perfectly fine.
check("no chip at all is not a no", lift({ doc: page({ chip: false }) }).membership() === null);

/* ---------- what that buys ---------- */

const rule = lift().whyNotSendable;

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

const { markLocked, playableFirst } = lift();

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
  return lift().orderDeck(markLocked(cards, channelId, member), { sortBy: "uses" });
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
  const api = lift({ ranking: loud });
  return api.orderDeck(api.markLocked(cards, HERE, member), { sortBy: "trend" })
    .map((c) => c.id).join(",");
};

check("the loudest reaction in the chat leads while you can send it", trendy(true) === "ours,plain");
check("and goes to the back when you cannot", trendy(false) === "plain,ours");

/* ---------- the deck that has to ask ---------- */

// The rule can be perfectly right and never consulted. Removing the question
// from buildDeck leaves every card in a real deck unlocked, and nothing above
// this line would notice.
const shelf = (channelId) => ({
  cards: [
    { id: "plain", tokens: text("888"), scope: store.GLOBAL, uses: 1, heat: 1, lastUsedAt: 1 },
    { id: "ours", tokens: stamp(HERE), scope: HERE, uses: 9, heat: 9, lastUsedAt: 9 }
  ],
  decks: { [channelId]: ["plain", "ours"] },
  channelMeta: {},
  settings: { sortBy: "uses", mode: "hand", cardSize: "small", rows: 2 }
});

let built = lift({ doc: page({ mine: false }) }).buildDeck(shelf(HERE), HERE);
check("a deck built for someone who is not a member locks the card",
  built.find((c) => c.id === "ours")?.locked === true);
check("and puts it last, even though it is the most used", built.at(-1).id === "ours");

built = lift({ doc: page({ mine: true }) }).buildDeck(shelf(HERE), HERE);
check("a member's deck leaves it playable", built.find((c) => c.id === "ours")?.locked === false);
check("and where the sort put it", built[0].id === "ours");

/* ---------- saving one you cannot send ---------- */

// Checking that the question is asked is not checking that the answer is
// obeyed: `if (false && why)` kept both of those true while every refused
// save went through. So the save runs, and what matters is whether anything
// was written.
const empty = (channelId) =>
  ({ cards: [], decks: { [channelId]: [] }, channelMeta: {}, settings: shelf(channelId).settings });

const saving = (doc, captured) => {
  const api = lift({ doc, disk: empty(HERE) });
  return api.saveTokens(captured, "channel").then(() => api.seen);
};

let after = await saving(page({ mine: false }), stamp(HERE));
check("a member emoji you cannot send is not saved", after.writes.length === 0);
check("and you are told why", after.toasts.join("").includes("メンバー"));

after = await saving(page({ mine: true }), stamp(HERE));
check("the same card saves once you are a member", after.writes.some((w) => w.op === "addCard"));

after = await saving(page({ mine: false }), text("わこつ"));
check("and plain words were never in question", after.writes.some((w) => w.op === "addCard"));

// The one the review found: the page can move to another chat while storage
// is being read, and the emoji being saved then belong to the channel we just
// left. The badge on screen is about the new one, so it answers nothing about
// them — and the way to show that it is no longer being used as the answer is
// that both badges now give the same result.
const moved = async (mine) => {
  const api = lift({
    doc: page({ mine }),                        // this chat, wherever we are
    channel: { id: AWAY, name: "ゆめの" },
    disk: empty(AWAY)
  });
  await api.saveTokens(stamp(HERE), "channel");
  return api.seen.writes.filter((w) => w.op === "addCard").length;
};

check("a badge from this chat is not the answer for another channel's emoji",
  (await moved(true)) === (await moved(false)));

// Which way it falls is the same choice made everywhere else here: not
// knowing is not a no. The card is scoped to the channel the emoji came from,
// so the next time that deck is built, on the page that can actually answer,
// it locks if the membership is not there.
check("and not knowing lets the save through", (await moved(false)) === 1);

/* ---------- and hearing about it at all ---------- */

// A membership can start or end while the panel is sitting there. Nothing
// else will notice: the observer used to ask only whether the editor had
// moved, and with suggestions off and a plain sort a quiet chat never renders
// on its own — so the locks stayed as they were until something unrelated
// happened along.
{
  const joining = lift({ doc: page({ mine: false }) });
  joining.onPageChanged();
  const settled = joining.seen.renders;
  joining.onPageChanged();
  check("an unchanged page is not repainted", joining.seen.renders === settled);
}

{
  // The same panel, watching a page that changes answer under it.
  const doc = page({ mine: false });
  const chip = doc.querySelector("yt-live-chat-message-input-renderer yt-live-chat-author-chip");
  const badges = chip.querySelector("span#chat-badges");
  const api = lift({ doc });

  api.onPageChanged();
  const settled = api.seen.renders;

  badges.kids.push({ tag: "YT-LIVE-CHAT-AUTHOR-BADGE-RENDERER", id: null,
                     attrs: { type: "member" }, kids: [], parent: badges });
  api.onPageChanged();
  check("joining repaints the panel", api.seen.renders === settled + 1);

  badges.kids.pop();
  api.onPageChanged();
  check("and so does the membership running out", api.seen.renders === settled + 2);
}

process.exit(fail);
