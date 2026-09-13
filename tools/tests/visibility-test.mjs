// What the panel is showing: whether the deck is on screen at all, and what
// its bar is saying.
//
// YouTube opens Super Chat over the same corner the deck sits in, and it does
// that by collapsing the chat input rather than removing it — so "the input is
// still in the DOM" is not "the input is usable". Getting that wrong drew the
// deck on top of YouTube's panel, which is what was reported.
//
// syncVisibility is lifted out of content.js with its free names supplied
// here, so the decision is tested without needing a browser. What it cannot
// test is YouTube's own timing; that was measured live and is recorded in the
// commit that added the attribute observer.
import { readFileSync } from "node:fs";

const source = process.env.OD_SOURCE
  ? new URL(`file://${process.env.OD_SOURCE}`)
  : new URL("../../content.js", import.meta.url);
const src = readFileSync(source, "utf8");

const from = src.indexOf("  function syncVisibility() {");
const to = src.indexOf("  const getScroller = ", from);
if (from < 0 || to < 0 || to <= from) {
  console.log("FAIL could not lift syncVisibility out of content.js");
  process.exit(1);
}
const body = src.slice(from, to);

// One scenario: its own root, its own input, its own counters.
function scene({ mounted = true, connected = true, hidden = false, usable = true } = {}) {
  const state = {
    renders: 0,
    notes: [],
    frozen: true, // the pointer is on the deck unless a case says otherwise
    root: mounted ? { hidden, isConnected: connected } : null
  };

  const api = new Function(
    "state",
    `let stopped = false;
     let frozen = state.frozen;
     let rootEl = state.root;
     const getChatInput = () => state.usable ? {} : null;
     const scheduleRender = () => { state.renders += 1; };
     const journal = { record: (entry) => state.notes.push(entry.what) };
     ${body}
     return { syncVisibility, frozen: () => frozen };`
  )(state);

  state.usable = usable;
  return {
    state,
    run() { api.syncVisibility(); state.frozen = api.frozen(); return state; }
  };
}

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

/* ---------- the panel takes the corner ---------- */

let s = scene({ hidden: false, usable: false }).run();
check("a collapsed input hides the deck", s.root.hidden === true);
check("and says so once, for a report", s.notes.length === 1);

check(
  "hiding releases the hover freeze, since nothing is under the pointer",
  s.frozen === false
);

/* ---------- and gives it back ---------- */

s = scene({ hidden: true, usable: true }).run();
check("a usable input shows the deck again", s.root.hidden === false);
check("and asks for a render, because the contents are stale", s.renders === 1);

/* ---------- no needless work ---------- */

s = scene({ hidden: false, usable: true }).run();
check("already visible and usable changes nothing", s.root.hidden === false && s.renders === 0);

s = scene({ hidden: true, usable: false }).run();
check("already hidden and unusable changes nothing", s.notes.length === 0 && s.renders === 0);

/* ---------- nothing mounted yet ---------- */

// The first render found the input collapsed and returned before mounting.
// Returning here as well left the deck missing until something else happened
// to schedule a render, which on a quiet chat can be a long time.
s = scene({ mounted: false, usable: true }).run();
check("with nothing mounted, a usable input asks for a render", s.renders === 1);

s = scene({ mounted: false, usable: false }).run();
check("with nothing mounted and nothing usable, it waits", s.renders === 0);

s = scene({ mounted: true, connected: false, usable: true }).run();
check("a root torn out of the page counts as not mounted", s.renders === 1);

/* ---------- the bar, once what it describes is gone ---------- */

const peekFrom = src.indexOf("  function setPeek(next, owner = null) {");
const peekTo = src.indexOf("  function poolBar(", peekFrom);
if (peekFrom < 0 || peekTo < 0 || peekTo <= peekFrom) {
  console.log("FAIL could not lift setPeek out of content.js");
  process.exit(1);
}

function bar() {
  const seen = { refreshes: 0 };
  const api = new Function(
    "seen",
    `let peek = null;
     let peekOwner = null;
     const notice = null;
     const refreshBar = () => { seen.refreshes += 1; };
     ${src.slice(peekFrom, peekTo)}
     return { setPeek, dropStalePeek, peek: () => peek, owner: () => peekOwner };`
  )(seen);
  return { ...api, seen };
}

// A card ejected while the pointer was on its eject button: the element goes,
// so pointerleave never comes, and the bar was left describing a button that
// no longer existed — which also meant it could never become the save
// targets, so nothing could be added either.
let b = bar();
const button = { isConnected: true };
b.setPeek({ text: "このデッキから外す" }, button);
check("hovering a control puts its description in the bar", b.peek()?.text === "このデッキから外す");

button.isConnected = false;
b.dropStalePeek();
check("and removing that control clears it", b.peek() === null);
check("with nothing left owning the bar", b.owner() === null);

// A control still on the page keeps its description: the panel re-renders
// every few seconds in chat-driven mode, and the pointer may not have moved.
b = bar();
const staying = { isConnected: true };
b.setPeek({ text: "この札を編集" }, staying);
b.dropStalePeek();
check("a control still there keeps its description", b.peek()?.text === "この札を編集");

// Clearing has no owner to remember.
b = bar();
b.setPeek({ text: "x" }, { isConnected: true });
b.setPeek(null);
check("clearing forgets the owner too", b.owner() === null);

/* ---------- where the skip is decided ---------- */

// The signature can be tested as a pure function; whether render actually
// consults it cannot, without a DOM. What can be pinned is the one thing that
// went wrong: the check sat *after* replaceChildren(), where the panel has no
// first child by construction, so the condition could never hold and every
// notification rebuilt everything anyway. Order is the whole bug.
{
  const renderAt = src.indexOf("  async function render() {");
  const skipAt = src.indexOf("if (next === painted", renderAt);
  const tearAt = src.indexOf("rootEl.replaceChildren()", renderAt);

  check("render still decides whether to skip", renderAt >= 0 && skipAt > renderAt);
  check("and does it before tearing the panel down", skipAt > 0 && tearAt > 0 && skipAt < tearAt);
}

/* ---------- what counts as having changed ---------- */

const sigFrom = src.indexOf("  function panelSignature(data, channel, hue, shown, pool, drawn) {");
const sigTo = src.indexOf("  function renderHand(", sigFrom);
if (sigFrom < 0 || sigTo < 0 || sigTo <= sigFrom) {
  console.log("FAIL could not lift panelSignature out of content.js");
  process.exit(1);
}

// Chat-driven mode renders every few seconds whether or not anything shown has
// changed. Getting this wrong in one direction redraws constantly — which made
// the drawn card lurch — and in the other leaves the panel stale, which is
// worse. So both directions are pinned.
function signature({ pool = false, more = false, editing = null, flash = null,
                     typing = false, settings = {}, channel = "UCaaa", name = "さくら",
                     hue = 320, width = 400, presets = 1,
                     shown = [], poolCards = [], drawn = null } = {}) {
  return new Function(
    "poolOpen", "expanded", "editingId", "flashId", "inputHasContent",
    "tokens", "presetsOnHand", "rootEl",
    `${src.slice(sigFrom, sigTo)} return panelSignature;`
  )(
    pool, more, editing, flash, typing,
    { cardKey: (t) => (t || []).map((x) => x.value ?? x.emojiId).join("") },
    () => new Array(presets),
    { clientWidth: width }
  )(
    { settings: { mode: "hand", cardSize: "small", rows: 2, sortBy: "heat", suggest: true, ...settings } },
    { id: channel, name }, hue, shown, poolCards, drawn
  );
}

const say = (value) => [{ type: "text", value }];
const hand = [{ id: "a", hits: 0, tokens: say("わこつ") }, { id: "b", hits: 0, tokens: say("888") }];

check("the same panel signs the same", signature({ shown: hand }) === signature({ shown: hand }));

check(
  "a chat count ticking up is not a change",
  signature({ shown: [{ id: "a", hits: 4, tokens: say("x") }] }) ===
  signature({ shown: [{ id: "a", hits: 9, tokens: say("x") }] })
);

check(
  "but a card starting to trend is",
  signature({ shown: [{ id: "a", hits: 0, tokens: say("x") }] }) !==
  signature({ shown: [{ id: "a", hits: 1, tokens: say("x") }] })
);

// An edit keeps the card's id, so the id alone cannot speak for it.
check(
  "a card edited in place is a change",
  signature({ shown: [{ id: "a", tokens: say("わこつ") }] }) !==
  signature({ shown: [{ id: "a", tokens: say("わこつ〜") }] })
);

check(
  "a card becoming channel-only is",
  signature({ shown: [{ id: "a", tokens: say("x") }] }) !==
  signature({ shown: [{ id: "a", tokens: say("x"), bound: true }] })
);

check(
  "and a card becoming unplayable here is",
  signature({ shown: [{ id: "a", tokens: say("x") }] }) !==
  signature({ shown: [{ id: "a", tokens: say("x"), locked: true }] })
);

check(
  "reordering the hand is",
  signature({ shown: hand }) !== signature({ shown: [hand[1], hand[0]] })
);

check(
  "a different card being drawn is",
  signature({ shown: hand, drawn: { key: "888" } }) !== signature({ shown: hand, drawn: { key: "99" } })
);

check(
  "and so is one being drawn at all",
  signature({ shown: hand }) !== signature({ shown: hand, drawn: { key: "888" } })
);

for (const [label, over] of [
  ["opening the pool", { pool: true }],
  ["expanding", { more: true }],
  ["editing a card", { editing: "a" }],
  ["flashing one", { flash: "a" }],
  ["typing", { typing: true }],
  ["a settings change", { settings: { rows: 1 } }],
  ["switching channel", { channel: "UCbbb" }],
  ["the channel being named at last", { name: "" }],
  ["a new colour", { hue: 90 }],
  ["the panel being resized", { width: 320 }],
  ["the pool gaining a card", { poolCards: [{ id: "p" }] }],
  ["the presets arriving", { presets: 0 }]
]) {
  check(`${label} is a change`, signature({ shown: hand }) !== signature({ shown: hand, ...over }));
}

process.exit(fail);
