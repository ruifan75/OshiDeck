// Drawing a card from the chat: which reaction is offered, and where the room
// for it comes from.
//
// The panel sits at the bottom of the chat, so a drawn card must not cost a
// row — the hand tightens instead. And a card that cannot be sent is worse
// than no card, so what is offered is filtered before it is ever shown.
import { readFileSync } from "node:fs";
import { page } from "./page.mjs";

const source = process.env.OD_SOURCE
  ? new URL(`file://${process.env.OD_SOURCE}`)
  : new URL("../../content.js", import.meta.url);
const src = readFileSync(source, "utf8");

const from = src.indexOf("  // A card is drawn when the chat bursts");
const to = src.indexOf("  function buildDrawnRow(", from);
// whyNotSendable comes along (below), and so does the line that asks it on
// the panel's behalf.
// What may be offered is decided by the same rule that locks a card, so the
// real one comes along rather than a stand-in that would only agree with
// itself.
const ruleFrom = src.indexOf("  // Am I a member of the channel running this chat?");
const ruleTo = src.indexOf("  function markLocked(", ruleFrom);
if (from < 0 || to < 0 || to <= from || ruleFrom < 0 || ruleTo <= ruleFrom) {
  console.log("FAIL could not lift drawFromChat out of content.js");
  process.exit(1);
}
const body = src.slice(ruleFrom, ruleTo) + src.slice(from, to);

globalThis.OshiDeck = {};
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => ({}), set: async () => {}
} } };
// IIFEs, imported for their side effects. OD_LAYOUT and OD_STORE let the
// mutation checker swap in broken copies.
await import(process.env.OD_LAYOUT ? `file://${process.env.OD_LAYOUT}` : "../../src/layout.js");
await import("../../src/tokens.js");
await import("../../src/backup.js");
await import(process.env.OD_STORE
  ? `file://${process.env.OD_STORE}`
  : new URL("../../src/store.js", import.meta.url).href);
const { layout, store } = globalThis.OshiDeck;

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
  repeated: globalThis.OshiDeck.tokens.repeated,
  hasSubstance: (t) => (t || []).some((x) => x.type === "youtubeEmoji" || x.value?.trim()),
  requiredChannels: (t) =>
    [...new Set((t || []).filter((x) => x.emojiId).map((x) => x.emojiId.split("/")[0]))]
};

// One panel, kept across calls so the hold can be observed. `chat` is what the
// watcher would report as a burst right now; set it to null for a quiet chat.
// The hold is handed in rather than read back out of the implementation. A
// test that asks the code how long it holds for agrees with whatever it says,
// so it can only tell that holding happens — not that it happens for as long
// as anybody was told.
// Every one of these runs on a page whose owner is known, because that is now
// the precondition for drawing anything at all: pass `channelId: null` to get
// the chat whose owner could not be found.
const HERE = "UChere00000000000000000";

function panel({ suggest = true, now = 1_000_000, hold = 45_000,
                 channelId = HERE, member = null } = {}) {
  // `null` is a page that has not rendered the chip, not one that says no —
  // building a definite non-member page for it meant the unknown case could
  // never be driven through offerFromChat at all.
  const asPage = (answer) => (answer === null ? page({ chip: false }) : page({ mine: answer }));

  const state = { chat: null, now, renders: 0, forgotten: 0, member, channelId,
                  showing: asPage(member) };

  // `painted` starts dirty so that clearing it can be seen: a stream that is
  // not the one before it must repaint from scratch, not skip on a signature
  // the previous chat left behind.
  const api = new Function(
    "settingsCache", "watcher", "tokens", "store", "Date", "scheduleRender", "document",
    `let painted = "stale";
     ${body};
     return { drawFromChat, offerFromChat, switchStream, painted: () => painted };`
  )(
    { suggest },
    {
      forget: () => { state.forgotten += 1; },
      burst: (accept) => {
        const seen = state.chat && { key: key(state.chat.tokens), count: state.chat.count, tokens: state.chat.tokens };
        return seen && (!accept || accept(seen)) ? seen : null;
      }
    },
    tokenStub,
    // Which number is asked for is part of the behaviour: a stub that answers
    // every question the same way lets the hold be read from the wrong setting
    // and still keeps the whole file green.
    { tuning: (settings, group) => (group === "hold" ? hold : 0) },
    { now: () => state.now },
    () => { state.renders += 1; },
    // offerFromChat reads the badge itself — that is the whole point of it
    // being a function rather than two arguments composed at the call site.
    { querySelector: (selector) => state.showing.querySelector(selector) }
  );

  return {
    chat(next) { state.chat = next; return this; },
    tick(ms) { state.now += ms; return this; },
    renders: () => state.renders,
    forgotten: () => state.forgotten,
    painted: () => api.painted(),
    switch: (video, channel) => api.switchStream(video, channel),
    // A membership can end while a card is being held.
    becomes(next) {
      state.member = next;
      state.showing = asPage(next);
      return this;
    },
    // And so can the page's hold on its own owner: an in-page navigation can
    // leave the chat where it was with nothing left to read the channel off.
    loses() {
      state.channelId = null;
      return this;
    },
    // What render() actually calls: it reads the badge off the page itself.
    offer: (deck = []) => api.offerFromChat(deck, state.channelId ? { id: state.channelId } : null),
    draw: (deck = []) => api.drawFromChat(deck, { channelId: state.channelId, member: state.member })
  };
}

const draw = ({ suggest = true, chat = null, deck = [], channelId = HERE, member = null } = {}) =>
  panel({ suggest, channelId, member }).chat(chat).draw(deck);

const wave = { tokens: text("かわいい"), count: 9 };

check("a burst is offered", draw({ chat: wave })?.tokens === wave.tokens);
check("and is marked as not yours", draw({ chat: wave })?.drawn === true);
// Nothing shows the number any more; the card breathes in the corner while
// it is being said. It is still what the sort runs on.
check("carrying the count it was drawn on", draw({ chat: wave })?.hits === 9);

check("a quiet chat offers nothing", draw({ chat: null }) === null);
check("turned off, nothing is offered", draw({ suggest: false, chat: wave }) === null);

const SAKURA_ID = "UCsakura0000000000000000";
const heart = { tokens: stamp(SAKURA_ID), count: 20 };

check(
  "another channel's member emoji are never offered",
  draw({ chat: heart, channelId: "UCyumeno0000000000000000", member: true }) === null
);

check(
  "nor this channel's while you are not a member",
  draw({ chat: heart, channelId: SAKURA_ID, member: false }) === null
);

// This is what being able to ask bought: the emoji belong here and so do you.
check(
  "but this channel's are offered once you are one",
  draw({ chat: heart, channelId: SAKURA_ID, member: true })?.tokens === heart.tokens
);

// The chip has not rendered yet. Refusing on a guess would hide a card that
// is very likely fine; the same choice is made when locking.
check(
  "and a page that has not said yet is not treated as a no",
  draw({ chat: heart, channelId: SAKURA_ID, member: null })?.tokens === heart.tokens
);

check(
  "nor is something with no substance",
  draw({ chat: { tokens: text("   "), count: 20 } }) === null
);

/* ---------- and nothing at all where the panel is off ---------- */

// A chat whose owner could not be worked out has no deck for a card to join
// and no way to ask whether it could be sent. The panel says so on its one
// line and does nothing else; drawing is part of that nothing.
check(
  "a chat with no channel draws nothing, however loud it gets",
  draw({ chat: { tokens: text("かわいい"), count: 400 }, channelId: null }) === null
);

// This is the half that was wrong rather than merely unwanted: asked without
// a channel, whyNotSendable answers "cannot judge", not "no" — so somebody
// else's member emoji passed every test offering puts in the way, and the
// card would have failed the moment it was pressed.
check(
  "least of all a member emoji it has no way to judge",
  draw({ chat: heart, channelId: null, member: true }) === null
);

// And a card already in hand goes with it: the page can lose its owner under
// a card that is being held, and a held card was only ever checked when it
// was drawn.
const adrift = panel({ hold: 45_000 });
const beforehand = adrift.chat(wave).draw();
check("a card drawn on a known channel is held", !!beforehand && adrift.draw() === beforehand);
check("and is let go when the page stops being able to say where it is",
  adrift.loses().draw() === null);

/* ---------- exact wording, not the sort's loose one ---------- */

check(
  "a reaction already in the deck is not offered again",
  draw({ chat: wave, deck: [{ id: "k", tokens: text("かわいい") }] }) === null
);

// Ordinary words remain distinct even if the sort groups them together.
check(
  "holding きちゃ does not cover きちゃきちゃ",
  draw({ chat: { tokens: text("きちゃきちゃ"), count: 6 }, deck: [{ id: "k", tokens: text("きちゃ") }] })
    ?.tokens[0].value === "きちゃきちゃ"
);

for (const [owned, incoming] of [[5, 6], [6, 5], [1, 6], [6, 1]]) {
  check(`owning ${owned} claps covers a burst of ${incoming}`,
    draw({ chat: { tokens: text("👏".repeat(incoming)), count: 9 },
      deck: [{ id: "claps", tokens: text("👏".repeat(owned)) }] }) === null);
}
check("a repeated emoji sequence is already covered by the same sequence",
  draw({ chat: { tokens: text("🦢✨".repeat(3)), count: 9 },
    deck: [{ id: "sequence", tokens: text("🦢✨".repeat(2)) }] }) === null);
check("a different emoji sequence is still worth offering",
  !!draw({ chat: { tokens: text("🦢🎶".repeat(3)), count: 9 },
    deck: [{ id: "sequence", tokens: text("🦢✨".repeat(2)) }] }));
check("different skin tones are different reactions",
  !!draw({ chat: { tokens: text("👏🏻".repeat(6)), count: 9 },
    deck: [{ id: "claps", tokens: text("👏".repeat(5)) }] }));
check("repeated member emoji are covered regardless of count",
  draw({ chat: { tokens: Array.from({ length: 6 }, () => stamp(SAKURA_ID)[0]), count: 9 },
    channelId: SAKURA_ID, member: true,
    deck: [{ id: "hearts", tokens: Array.from({ length: 5 }, () => stamp(SAKURA_ID)[0]) }] }) === null);

const repeatedOffer = panel({ hold: 45_000 });
check("an unowned repeated reaction can still be drawn",
  !!repeatedOffer.chat({ tokens: text("👏".repeat(6)), count: 9 }).draw());
check("adding a different repeat count also retires an already-held offer",
  repeatedOffer.draw([{ id: "claps", tokens: text("👏".repeat(5)) }]) === null);

/* ---------- it stays put once drawn ---------- */

const p = panel({ hold: 45_000 });
const first = p.chat({ tokens: text("888"), count: 5 }).draw();
check("the first burst is drawn", first?.tokens[0].value === "888");

p.chat({ tokens: text("かわいい"), count: 9 }).tick(5_000);
check("a louder burst does not replace it while it is held", p.draw() === first);

p.tick(35_000); // forty seconds in, well short of the hold
check("and still does not, most of the way through", p.draw() === first);

p.tick(10_000); // fifty seconds in, past it
check("once the hold is over, the newer burst takes its place",
  p.draw()?.tokens[0].value === "かわいい");

// A shorter hold means a shorter hold, not merely some hold.
const brief = panel({ hold: 10_000 });
const held = brief.chat({ tokens: text("888"), count: 5 }).draw();
brief.chat({ tokens: text("かわいい"), count: 9 }).tick(6_000);
check("a ten second hold still holds at six", brief.draw() === held);
brief.tick(6_000);
check("and lets go by twelve", brief.draw()?.tokens[0].value === "かわいい");

// Expiry is only ever noticed by a render, and a chat that has gone quiet
// causes none — so the panel has to wake itself, or the card outstays its hold
// for as long as the silence lasts. This one uses a real timer, so the hold is
// in milliseconds rather than the fake clock's seconds — and *when* it wakes is
// the whole point: a wake-up that comes straight away is a repaint that
// retires nothing, and the hold still ends in silence.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sleeper = panel({ hold: 300 });
sleeper.chat({ tokens: text("888"), count: 5 }).draw();
check("nothing is repainted merely for drawing a card", sleeper.renders() === 0);
await sleep(150);
check("nor part of the way through the hold", sleeper.renders() === 0);
await sleep(650);
check("but the panel wakes itself once the hold has run out", sleeper.renders() === 1);

// Being held is not being exempt. The held card was checked once, when it was
// drawn, so a membership ending mid-hold left an unplayable card sitting in
// the panel — no lock, since a drawn card is not in the deck to be locked —
// until the hold ran out on its own.
const lapsing = panel({ hold: 45_000, channelId: SAKURA_ID, member: true });
const onLoan = lapsing.chat(heart).draw();
check("a member is offered this channel's emoji", onLoan?.tokens === heart.tokens);
check("and keeps it while nothing changes", lapsing.draw() === onLoan);

lapsing.becomes(false);
check("but loses it the moment the membership goes", lapsing.draw() === null);

// The panel's own call, which reads the badge rather than being handed the
// answer. Forcing that answer to true left the whole suite green.
const asking = panel({ hold: 45_000, channelId: SAKURA_ID, member: false });
check("the panel does not offer what the page says you cannot send",
  asking.chat(heart).offer() === null);

asking.becomes(true);
check("and offers it once the page says you can", asking.offer()?.tokens === heart.tokens);

// A page that has not said yet is not a no — the same answer the locks give.
const unsure = panel({ hold: 45_000, channelId: SAKURA_ID, member: null });
check("and a page that cannot answer yet does not refuse",
  unsure.chat(heart).offer()?.tokens === heart.tokens);

/* ---------- a new stream is a new chat ---------- */

// YouTube can swap the message list inside the same document, so the panel can
// find itself in front of a different chat without anything being torn down.
// Nothing the last one said means anything here.
const SAKURA = { id: "UCsakura0000000000000000", name: "さくら" };

const moved = panel({ hold: 45_000 });
moved.switch("Gv0g2GYipSM", SAKURA);
const settled = moved.forgotten();
const kept = moved.chat({ tokens: text("888"), count: 5 }).draw();
moved.chat(null);
check("a drawn card outlives an ordinary render", moved.draw() === kept);
check("and a render that finds the same stream", moved.switch("Gv0g2GYipSM", SAKURA) === false);
check("which forgets nothing", moved.forgotten() === settled);

// The same channel, a second stream. Nothing about the page need be rebuilt
// between them, and the first one's card was still being offered here.
check("but the same channel on a new video is a new chat",
  moved.switch("dQw4w9WgXcQ", SAKURA) === true);
check("which takes the card away", moved.draw() === null);
check("forgets what the last chat was saying", moved.forgotten() === settled + 1);
check("and repaints rather than trusting the old signature", moved.painted() === null);

// A popped-out chat window has no video to go by, so the channel answers for
// it — and two of those in a row are still one chat.
const popped = panel();
check("with no video the channel is the stream", popped.switch(null, SAKURA) === true);
check("and stays the same one", popped.switch(null, SAKURA) === false);

/* ---------- what the steps are worth ---------- */

// The steps are the whole interface to these numbers, so what each one means
// is part of the behaviour rather than an implementation detail.
const { DEFAULT_SETTINGS: defaults } = store;
check("out of the box a card is held for 30 seconds", store.tuning(defaults, "hold") === 30_000);
check("a wave is six messages and three tenths of the room",
  store.tuning(defaults, "draw")?.min === 6 && store.tuning(defaults, "draw")?.share === 0.3);
check("and the order halves its weight every 20 seconds", store.tuning(defaults, "pace") === 20_000);
check("and the hand follows the chat before anything is changed", defaults.sortBy === "trend");

// The steps are the honest default, but a number is a legitimate answer for
// these two: somebody who has watched their own chat has a better one.
check("a hold given in milliseconds is used as given",
  store.tuning({ hold: 7_000 }, "hold") === 7_000);
check("and so is a pace", store.tuning({ pace: 45_000 }, "pace") === 45_000);
check("but the draw is two numbers that have to agree, so it stays a step",
  store.tuning({ draw: 5_000 }, "draw")?.min === 6);

// Out of range, or not a number at all, falls back rather than taking effect.
check("a hold of nothing is refused", store.tuning({ hold: NaN }, "hold") === 30_000);
check("too short is pulled up to a second", store.tuning({ hold: 1 }, "hold") === 1_000);
check("and too long down to ten minutes", store.tuning({ pace: 9_999_999 }, "pace") === 600_000);

check("ひかえめ asks for more of the room than ふつう",
  store.tuning({ draw: "shy" }, "draw")?.share > store.tuning({ draw: "normal" }, "draw")?.share);
check("よく引く asks for fewer messages",
  store.tuning({ draw: "eager" }, "draw")?.min < store.tuning({ draw: "normal" }, "draw")?.min);
check("ながめ holds longer than みじかめ",
  store.tuning({ hold: "long" }, "hold") > store.tuning({ hold: "short" }, "hold"));
check("はやい forgets faster than ゆっくり",
  store.tuning({ pace: "quick" }, "pace") < store.tuning({ pace: "slow" }, "pace"));

// A settings file from before these existed has no opinion about them.
check("an unset step falls back to the middle one",
  store.tuning({}, "hold") === store.tuning({ hold: "normal" }, "hold"));
check("and so does one nobody recognises",
  store.tuning({ draw: "whatever" }, "draw")?.min === store.tuning({ draw: "normal" }, "draw")?.min);

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
