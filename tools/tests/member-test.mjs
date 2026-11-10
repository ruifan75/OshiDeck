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
// Real storage, so the real operations can be run against it. Counting calls
// to a stub that always says "saved" proves a call happened, not that a card
// was saved — a save addressed to the wrong channel is rejected by the op and
// looked identical from outside.
let disk = { cards: [], decks: {}, channelMeta: {}, settings: {} };
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => JSON.parse(JSON.stringify(disk)),
  set: async (patch) => { disk = { ...disk, ...JSON.parse(JSON.stringify(patch)) }; }
} } };
globalThis.crypto ??= (await import("node:crypto")).webcrypto;
await import("../../src/tokens.js");
await import("../../src/backup.js");
await import(process.env.OD_STORE
  ? `file://${process.env.OD_STORE}`
  : new URL("../../src/store.js", import.meta.url).href);
// The signature is what findDuplicate uses to spot a near-miss, so the real
// one comes along too rather than a stand-in that would agree with anything.
globalThis.document = { querySelector: () => null };
await import("../../src/trending.js");
// What a preset's card becomes when it is offered is part of what is being
// asked here, so the real one comes along rather than a copy that would only
// agree with itself.
await import(process.env.OD_PRESETS
  ? `file://${process.env.OD_PRESETS}`
  : new URL("../../src/presets.js", import.meta.url).href);
const { store, presets } = globalThis.OshiDeck;

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
  // what the panel does when the page changes under it, and what it watches
  cut("  let lastMembership = null;", "  const observer = watchPage("),
  // pressing what either half of the pool is offering
  cut("  async function addToDeck(card) {", "  /* ---------- arranging by hand ---------- */"),
  // pressing a card
  cut("  let sending = false;", "  // The renderer enables the button a beat after")
].join("\n");

let fail = 0;

// Given a function, it is called here: production can hand the page a selector
// the engine refuses to guess at, and that has to read as a failed assertion
// rather than a crashed file — a file that dies reports no FAIL line at all,
// and the mutation checker would count that as nothing happening.
const check = (label, ok) => {
  let passed = false;
  let why = "";
  try { passed = typeof ok === "function" ? ok() : ok; }
  catch (error) { why = ` — ${error.message}`; }
  if (!passed) fail++;
  console.log((passed ? "ok   " : "FAIL ") + label + (passed ? "" : why));
};

const HERE = "UCsakura0000000000000000";
const AWAY = "UCyumeno0000000000000000";

const text = (value) => [{ type: "text", value }];
const stamp = (owner) => [{ type: "youtubeEmoji", emojiId: `${owner}/heart`, alt: ":h:" }];

const { tokens, trending } = globalThis.OshiDeck;

// Everything the lifted code reaches for. `seen` is what came back out.
// Messages come back as "key|arg|arg" in these tests: an assertion cares
// which message was chosen and what went into it, not how it is worded — and
// the wording is now a thing that changes with the language.
const t = (key, ...args) => [key, ...args].join("|");

const input = { id: "the editor" };

function lift({ doc = page(), ranking = new Map(), channel = { id: HERE, name: "さくら" },
                held = null, moves = null, autoSend = true, staged = [] } = {}) {
  const seen = { writes: [], toasts: [], renders: 0, sent: 0, observer: null, flashed: [] };

  // What is actually in the editor. ⇧＋click can leave something there that
  // the next card then carries out with it.
  let editor = staged;

  // What the page is showing, and which channel that is — both able to change
  // while storage is being read, which is the case the pairing exists for.
  let showing = doc;
  let where = channel;

  const api = new Function(
    "document", "tokens", "store", "watcher", "trending",
    "t", "getChannel", "showToast", "shutdown", "render", "flashCard", "journal", "log", "editingId",
    "findChatInput", "currentInput", "rootEl", "scheduleRender",
    "getChatInput", "settingsCache", "submitChat", "MutationObserver",
    "presets", "presetsOnHand",
    `const saveMenu = null;
     ${lifted}
     return { membership, whyNotSendable, markLocked, playableFirst, orderDeck,
              buildDeck, buildPool, buildOffered, addToDeck,
              saveTokens, reconcileChannel, onPageChanged,
              findDuplicate,
              watchPage, playCard };`
  )(
    { querySelector: (selector) => showing.querySelector(selector) },
    // The real rules; only the editor is modelled. writeToInput appends
    // unless told to replace, which is the behaviour that lets a staged
    // reaction ride out with the next card.
    {
      ...tokens,
      writeToInput: (_, list) => { editor = [...editor, ...list]; },
      collectTokens: () => editor
    },
    {
      ...store,
      read: async () => {
        const data = held === null ? await store.read() : held;
        // The page moves here: after the read has been asked for, before the
        // answer is used.
        if (moves) ({ showing, where } = moves());
        return data;
      },
      // The real operation, against real storage. A stub that answers "saved"
      // to anything cannot tell a save from one the store rejects.
      apply: async (op, args) => {
        seen.writes.push({ op, args });
        return store.runOp(op, args);
      }
    },
    { ranking: () => ranking },
    trending,
    t,
    () => (where ? { ...where } : where),
    (message) => seen.toasts.push(message),
    () => seen.toasts.push("shutdown"),
    () => { seen.renders += 1; },
    (id, how) => seen.flashed.push(`${id}:${how}`),
    { record: () => {} },
    () => {},
    null,
    () => input,             // the input is there and has not moved
    input,
    { isConnected: true },
    () => { seen.renders += 1; },
    () => editor,
    { autoSend },
    (done) => { seen.sent += 1; done?.(); },
    class { constructor(fn) { seen.observer = { fn }; }
            observe(root, options) { Object.assign(seen.observer, { root, options }); } },
    // The real cardsFor: what a preset's card becomes is the thing being
    // asked about, and a copy here would only agree with itself.
    presets,
    () => offering
  );
  return { ...api, seen };
}

// What presetsOnHand answers with, for the cases that care.
let offering = [];

/* ---------- am I a member ---------- */

// Lazily, all of them: production hands the page its selector, and one the
// engine will not guess at has to read as a failed assertion here rather than
// take the file down with it.
const asked = (over) => () => lift({ doc: page(over) }).membership();

check("my own badge beside the input says yes", () => asked({ mine: true })() === true);

check(
  "a chat full of other people's members is not me",
  () => asked({ mine: false, others: 57 })() === false
);

check(
  "a hidden chip still answers, since a popped-out chat hides it either way",
  () => asked({ mine: true, hidden: true })() === true
);

// And the other way round. Every fixture used to hide the chip, which let a
// selector that *required* hidden pass everything — on a page that shows the
// chip that selector finds nothing, and a definite no is read as "cannot
// tell", which leaves the cards unlocked.
check("a chip on show answers the same way", () => asked({ mine: true, hidden: false })() === true);
check("and says no just as plainly", () => asked({ mine: false, hidden: false })() === false);

// Not knowing is its own answer. The alternative — reading a page that has
// not rendered yet as "not a member" — locks a card that is perfectly fine.
check("no chip at all is not a no", () => asked({ chip: false })() === null);

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
// Keyed with the real signature. It was JSON.stringify here while the lift
// supplied the real trending, so every lookup missed and the assertion was
// passing on the fallback order — which that card already led.
const loud = new Map([[trending.signature(stamp(HERE)), { score: 100, count: 30 }]]);
// Deliberately the other way round: "plain" is the card habit would put
// first, so if the ranking is never consulted this falls back to heat and the
// assertion passes on that instead. (It did. Twice — the first fix was
// written and then lost before it reached the file.)
const trendy = (member) => {
  const cards = [
    { id: "ours", tokens: stamp(HERE), heat: 1, lastUsedAt: 1 },
    { id: "plain", tokens: text("888"), heat: 99, lastUsedAt: Date.now() }
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
    { id: "plain", tokens: text("888"), scope: store.GLOBAL,
      by: { [channelId]: { uses: 1, heat: 1, lastUsedAt: 1 } } },
    { id: "ours", tokens: stamp(HERE), scope: HERE,
      by: { [channelId]: { uses: 9, heat: 9, lastUsedAt: 9 } } }
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

// The pool asks the same question from its own line, which is its own way to
// forget: dropping the question there, or the partition, changed nothing any
// test could see.
// The locked card comes first, so the partition has to actually move it —
// with it already last, dropping playableFirst here changed nothing visible.
const shelved = (channelId) => ({
  ...shelf(channelId),
  cards: [...shelf(channelId).cards].reverse(),
  decks: { [channelId]: [] }
});

let pool = lift({ doc: page({ mine: false }) }).buildPool(shelved(HERE), HERE);
check("the pool locks what cannot be sent", pool.find((c) => c.id === "ours")?.locked === true);
check("and puts it last there too", pool.at(-1).id === "ours");

pool = lift({ doc: page({ mine: true }) }).buildPool(shelved(HERE), HERE);
check("a member's pool leaves it playable", pool.find((c) => c.id === "ours")?.locked === false);

check("and with no channel there is no pool at all",
  lift().buildPool(shelved(HERE), null).length === 0);

/* ---------- whose habit it is ---------- */

// How often a card is used is a fact about a chat, not about the card. 👏
// pressed fifty times in one channel says nothing about the next one, and
// one shared number put a card nobody there had ever pressed at the front
// of the hand.
{
  const AWAY_CH = "UCbbbbbbbbbbbbbbbbbbbbbb";
  const worn = {
    cards: [
      { id: "plain", tokens: text("888"), scope: store.GLOBAL,
        by: { [AWAY_CH]: { uses: 50, heat: 50, lastUsedAt: Date.now() } } },
      { id: "here", tokens: text("わこつ"), scope: store.GLOBAL,
        by: { [HERE]: { uses: 2, heat: 2, lastUsedAt: Date.now() } } }
    ],
    decks: { [HERE]: ["plain", "here"] },
    channelMeta: {},
    settings: { sortBy: "uses", mode: "hand", cardSize: "small", rows: 2 }
  };

  const api = lift({ doc: page({ mine: true }) });
  check("a habit on one channel does not order another",
    api.buildDeck(worn, HERE)[0].id === "here");

  // And the sort still works where the habit was earned.
  check("while on the channel it was earned on it leads",
    api.buildDeck({ ...worn, decks: { [AWAY_CH]: ["plain", "here"] } }, AWAY_CH)[0].id === "plain");

  // Pressing it only counts where it was pressed.
  const card = { id: "plain", tokens: text("888"), by: {} };
  store.markUsed(card, HERE);
  check("pressing a card counts on the channel it was pressed on",
    card.by[HERE].uses === 1);
  check("and nowhere else", Object.keys(card.by).join() === HERE);
}

/* ---------- and what the channel's regulars use ---------- */

// A preset was all-or-nothing, and only while the deck was empty: ten cards
// or none, and the moment the deck had one card of its own the offer was
// gone for good. Nothing about that follows from what a preset is — it is a
// list of cards, the pool is where cards come from, and a card you do not
// own yet is still one you could put in here.
{
  const fresh = { tokens: text("おかえり"), scope: "global" };
  // A preset's channel-only card need not have a stamp in it: `はのは〜` is
  // this channel's and is nothing but words. Reading the stamps to decide
  // the stripe drew it grey.
  const theirs = { tokens: text("はのは〜"), scope: "channel" };
  const alreadyMine = { tokens: stamp(HERE), scope: "channel" };
  offering = [{ name: "稀羽すう", channel: HERE, cards: [fresh, theirs, alreadyMine] }];

  const api = lift({ doc: page({ mine: true }) });
  const offered = api.buildOffered(shelved(HERE), HERE);

  // All of it, not the remainder. Owning a card used to take it out of here,
  // so a preset of ten read as a preset of three the moment you had saved
  // seven of them yourself — a list with holes punched in it wherever you
  // happened to agree with it.
  check("the whole preset is offered, not what is left of it", offered.length === 3);
  check("and they are kept apart from what you already have",
    api.buildPool(shelved(HERE), HERE).every((c) => !c.offered));
  check("including the ones you have none of",
    offered.filter((c) => c.offered).map((c) => tokens.toPlainText(c.tokens)).sort().join("|")
      === "おかえり|はのは〜");
  check("an offered card set to this channel wears its colour",
    offered.find((c) => tokens.toPlainText(c.tokens) === "はのは〜")?.bound === true);
  check("while a universal one does not",
    offered.find((c) => tokens.toPlainText(c.tokens) === "おかえり")?.bound === false);
  check("an offered card carries what it was offered from",
    !!offered.find((c) => tokens.toPlainText(c.tokens) === "おかえり")?.offered);

  // The one you already have is offered as *your* card, so pressing it adds
  // the card that has been earning a count here rather than a second one
  // saying the same thing.
  const both = offered.find((c) => tokens.cardKey(c.tokens) === tokens.cardKey(stamp(HERE)));
  check("one you already own is offered too", !!both);
  check("as the card you own, not a copy of it", both?.id === "ours");
  check("so pressing it is not loading a preset", !both?.offered);
  check("and it is in the pool as well", 
    api.buildPool(shelved(HERE), HERE).some((c) => c.id === "ours"));

  // The viewer's own route to the same mistake, and the one they could see:
  // the input cleared, the bar said the card already existed on this channel,
  // and nothing had been saved. findDuplicate matched on wording alone, so
  // saveTokens never reached the addCard that had already learned better.
  {
    const theirs = { id: "theirs", tokens: text("わこつ"), scope: AWAY, by: {} };
    const here = { id: "here", tokens: text("わこつ"), scope: HERE, by: {} };
    const api3 = lift({ doc: page({ mine: true }) });
    const data = (cards) => ({ cards, decks: { [HERE]: [] }, channelMeta: {}, settings: {} });

    check("a card of the same words tied elsewhere is not a duplicate here",
      api3.findDuplicate(data([theirs]), HERE, text("わこつ")) === null);
    check("while one that can be sent here is",
      api3.findDuplicate(data([here]), HERE, text("わこつ"))?.exact === true);
  }

  // Owning the words is not owning a card you can send. A copy tied to
  // another channel cannot be played here, so counting it as owned left both
  // halves empty: the pool excludes it because it is not compatible, and the
  // offer excluded it because it existed.
  {
    const elsewhere = {
      ...shelved(HERE),
      cards: [{ id: "theirs", tokens: text("おかえり"), scope: AWAY, by: {} }],
      decks: { [HERE]: [] }
    };
    const api2 = lift({ doc: page({ mine: true }) });
    check("a card of the same words tied elsewhere is not in this pool",
      api2.buildPool(elsewhere, HERE).length === 0);
    // As the preset's card, not as the one that cannot be sent: the same
    // words read the same, so an offer that handed back the incompatible
    // card looked right from here and added nothing when pressed.
    check("so the preset still offers it here",
      api2.buildOffered(elsewhere, HERE)
        .some((c) => tokens.toPlainText(c.tokens) === "おかえり" && !!c.offered));
  }

  // cardsFor hands out a fresh uuid every time it is asked, and the panel's
  // signature is built from card ids: an offered card that is a new card on
  // every render makes the panel redraw forever.
  const again = lift({ doc: page({ mine: true }) }).buildOffered(shelved(HERE), HERE);
  check("and the same offer has the same id every time",
    again.map((c) => c.id).join() === offered.map((c) => c.id).join());

  // Same rules on the half you already own: without it every card in the
  // pool was drawn grey, including the ones tied to this channel.
  check("and a card of your own in the pool shows its scope too",
    api.buildPool(shelved(HERE), HERE).find((c) => c.id === "ours")?.bound === true);

  const locked = lift({ doc: page({ mine: false }) }).buildOffered(shelved(HERE), HERE);
  check("an offered card of plain words is never locked",
    locked.filter((c) => !tokens.requiredChannels(c.tokens).length)
      .every((c) => c.locked === false));
  // The other half of the same rule: the offer is judged the same way the
  // pool is, so a stamp you cannot send sits at the back here too.
  check("while an offered member stamp is, for someone who is not one",
    locked.at(-1)?.lapsed === true);

  // The whole trip, because this is what a viewer actually does: take the
  // preset, decide one of its cards is not for you, drop it out of the deck,
  // then delete it from the pool. The preset still carries it, you no longer
  // own it, so it is on offer again — the pool is where a card you do not
  // have comes from, and that is the only way back to one you threw away.
  {
    const whole = presets.cardsFor({ cards: [fresh, theirs, alreadyMine] }, HERE);
    const loaded = { cards: whole, decks: { [HERE]: whole.map((c) => c.id) },
                     channelMeta: {}, settings: {} };
    const api4 = lift({ doc: page({ mine: true }) });

    check("the whole preset in the deck leaves nothing on offer",
      api4.buildOffered(loaded, HERE).length === 0);

    // Out of the deck, still owned: it is in the pool, and the preset still
    // says this channel uses it — so it is in both halves, as your card.
    const mine = whole.find((c) => tokens.cardKey(c.tokens) === tokens.cardKey(stamp(HERE)));
    const ejected = { ...loaded, decks: { [HERE]: loaded.decks[HERE].filter((id) => id !== mine.id) } };
    check("one taken out of the deck is in both halves",
      api4.buildPool(ejected, HERE).length === 1 &&
      api4.buildOffered(ejected, HERE).map((c) => c.id).join() === mine.id);

    // Deleted from the pool: nobody owns it now, and the preset is where it
    // came from.
    const deleted = { ...ejected, cards: whole.filter((c) => c.id !== mine.id) };
    check("and deleted from the pool it is on offer again",
      api4.buildOffered(deleted, HERE)
        .some((c) => tokens.cardKey(c.tokens) === tokens.cardKey(stamp(HERE))));
    check("with nothing of yours left to add",
      api4.buildPool(deleted, HERE).length === 0);
  }

  // The same words under two ids: saved here for this channel, and saved
  // again as a card that works anywhere while watching somebody else. One of
  // them is in the deck. Asked by id, the preset went on offering the other
  // copy of something the hand already said, and pressing it put the same
  // words in twice.
  {
    const twice = {
      cards: [
        { id: "bound", tokens: text("おかえり"), scope: HERE, by: {} },
        { id: "free", tokens: text("おかえり"), scope: store.GLOBAL, by: {} }
      ],
      decks: { [HERE]: ["bound"] }, channelMeta: {}, settings: {}
    };
    const api5 = lift({ doc: page({ mine: true }) });
    check("a preset does not offer what the hand already says",
      !api5.buildOffered(twice, HERE).some((c) => tokens.toPlainText(c.tokens) === "おかえり"));
    // Which is not the same as the card being gone: it is still a card you
    // own and have not put in this deck.
    check("while the other copy is still yours to add",
      api5.buildPool(twice, HERE).some((c) => c.id === "free"));
  }

  // Pressing one, rather than reading what it would be. Everything above
  // looks at the entry; the add could have gone out under the wording
  // instead of the id and every one of them would still have passed.
  {
    disk = { cards: [{ id: "ours", tokens: stamp(HERE), scope: HERE, by: {} }],
             decks: { [HERE]: [] }, channelMeta: {}, settings: {} };
    const api6 = lift({ doc: page({ mine: true }) });

    const ours = api6.buildOffered(await store.read(), HERE)
      .find((c) => tokens.cardKey(c.tokens) === tokens.cardKey(stamp(HERE)));
    await api6.addToDeck(ours);
    check("pressing the card you own puts that very card in the deck",
      disk.decks[HERE].join() === "ours");
    check("and does not save a second one saying the same thing",
      disk.cards.length === 1);

    const stranger = api6.buildOffered(await store.read(), HERE).find((c) => c.offered);
    await api6.addToDeck(stranger);
    check("pressing one nobody owns yet saves it on the way in",
      disk.cards.length === 2);
    check("and the card it saved is the one in the deck",
      disk.decks[HERE].length === 2 && disk.decks[HERE].includes(disk.cards[1].id));
  }

  offering = [];
}

/* ---------- saving one you cannot send ---------- */

// Checking that the question is asked is not checking that the answer is
// obeyed: `if (false && why)` kept both of those true while every refused
// save went through. So the save runs, and what matters is whether anything
// was written.
// What ends up in the pool, not what was asked of it.
const saving = async (doc, captured, over = {}) => {
  disk = { cards: [], decks: { [HERE]: [] }, channelMeta: {}, settings: {} };
  const api = lift({ doc, ...over });
  await api.saveTokens(captured, "channel");
  return { ...api.seen, cards: disk.cards };
};

let after = await saving(page({ mine: false }), stamp(HERE));
check("a member emoji you cannot send is not saved", after.cards.length === 0);
check("and nothing was even asked of the store", after.writes.length === 0);
check("and you are told why", after.toasts.join("").includes("lock.membershipSave"));

after = await saving(page({ mine: true }), stamp(HERE));
check("the same card lands in the pool once you are a member", after.cards.length === 1);
check("as this channel's, since it can be nothing else", after.cards[0].scope === HERE);

after = await saving(page({ mine: false }), text("わこつ"));
check("and plain words were never in question", after.cards.length === 1);

// The one the review found, and the shape it actually needs: the page moves
// *while storage is being read*. Before, the chat is the one the emoji came
// from and there is no membership; by the time the answer comes back, the
// page is somewhere I am a member. Reading the badge then, rather than at the
// start, turns a definite no into a "cannot tell" — and lets the save through.
const arriving = () => ({ showing: page({ mine: true }), where: { id: AWAY, name: "ゆめの" } });

after = await saving(page({ mine: false }), stamp(HERE), { moves: arriving });
check(
  "a membership found after the page moved does not answer for where we were",
  after.cards.length === 0
);
check("and the refusal still says what it is", after.toasts.join("").includes("lock.membershipSave"));

// The pairing cuts both ways: a badge read here says no more about another
// channel's emoji than it says yes. Refusing on it would stop a card that is
// very likely fine, and the page that can actually answer will lock it.
after = await saving(page({ mine: false }), stamp(AWAY));
check("a badge here does not refuse another channel's emoji either", after.cards.length === 1);
check("and the card is that channel's, not this one's", after.cards[0].scope === AWAY);

// The same move, but the emoji were never in question.
after = await saving(page({ mine: false }), text("888"), { moves: arriving });
check("while an ordinary card is unaffected by any of it", after.cards.length === 1);

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

/* ---------- and that the observer is wired to hear it ---------- */

// onPageChanged can be perfect and never called. Reading the source for a
// name and an option said nothing about *what* was being watched: a detached
// target, or `subtree: false`, passed every one of those assertions while
// disconnecting the panel from the page entirely. So the observer is handed
// in and asked afterwards.
{
  const api = lift();
  const root = { id: "the document element" };
  api.watchPage(root);
  const { fn, root: watched, options } = api.seen.observer;

  // Not "a function was passed" — the one that answers a membership change.
  // The page here says no and the panel has not been told yet, so the first
  // call is a change and has to repaint.
  api.seen.renders = 0;
  fn();
  check("the observer is given the function that hears a membership change",
    api.seen.renders === 1);
  check("it watches what it was handed", watched === root);
  check("the whole tree under it", options.subtree === true);
  check("nodes coming and going", options.childList === true);
  check("and a badge changing what it is", options.attributes === true &&
    Array.isArray(options.attributeFilter) && options.attributeFilter.includes("type"));
}

// The lines left over: what gets watched, and what the two helpers are handed
// when render calls them. Pulling buildPool and offerFromChat out of render
// made their insides testable and left their arguments exactly as exposed as
// they were — passing null to either is invisible from inside.
check("and it is the document that is watched",
  /watchPage\(document\.documentElement\)/.test(src));
check("the pool is built for the channel we are on",
  /buildPool\(data, channel\?\.id\)/.test(src));
// Anchored on the call, not the name: `function offerFromChat(deck, channel)`
// matched the looser pattern and kept it true whatever render passed.
check("and the offer is made about it too",
  /:\s*offerFromChat\(deck, channel\)/.test(src));

/* ---------- pressing one ---------- */

// The press is the last moment anything can be right, and it was checked
// against what the panel happened to be drawn with. Removing the guard
// altogether passed every assertion in this file.
const pressing = async (over, card, staged = []) => {
  const api = lift({ staged, ...over });
  await api.playCard(card, { send: false });
  return api.seen;
};

const ours = { id: "ours", tokens: stamp(HERE) };

let press = await pressing({ doc: page({ mine: false }) }, ours);
check("a card the page says you cannot send is not sent", press.sent === 0);
check("and says which kind of no it is", press.toasts.join("").includes("lock.membershipPlay"));

// Pressing it does nothing at all, and the bar is across the panel from
// where the press happened. The card that was pressed is under the pointer.
check("and marks the card that was pressed", press.flashed.includes("ours:refused"));

press = await pressing({ doc: page({ mine: true }) }, ours);
check("and goes out once the page says you can", press.sent === 1);

// The stale lock is what the panel was drawn with, and the hand freezes under
// the pointer — so rejoining left a card refusing to play that had just
// become playable again.
press = await pressing({ doc: page({ mine: true }) }, { ...ours, locked: true, lapsed: true });
check("a lock left over from before is not the answer once the page can give one",
  press.sent === 1);

// ...but it is the answer when the page cannot.
press = await pressing({ doc: page({ chip: false }) }, { ...ours, locked: true, lapsed: true });
check("while a page that cannot answer leaves the old lock standing", press.sent === 0);

/* ---------- and what the press actually sends ---------- */

// ⇧＋click stages a reaction in the editor without sending it. The card was
// checked; the comment was not — so a plain card pressed afterwards carried
// the unusable emoji out with it.
press = await pressing({ doc: page({ mine: false }) }, { id: "plain", tokens: text("888") },
  stamp(HERE));
check("a plain card does not carry out what is already in the editor", press.sent === 0);
check("and says what is in the way", press.toasts.join("").includes("toast.leftover"));

press = await pressing({ doc: page({ mine: true }) }, { id: "plain", tokens: text("888") },
  stamp(HERE));
check("the same editor goes out once every part of it can", press.sent === 1);

process.exit(fail);
