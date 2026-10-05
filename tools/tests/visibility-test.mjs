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
import { page, documentFor } from "./page.mjs";

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

  // Position is not enough on its own: `painted = null` slipped in just above
  // the comparison keeps every position intact and stops the skip from ever
  // holding — the panel then rebuilds on every notification, which is the bug
  // the skip exists for. Render does clear it deliberately elsewhere (when it
  // steps aside, and when it remounts), so what can be pinned is the stretch
  // between working the signature out and comparing it: nothing may touch it
  // there.
  const signatureAt = src.indexOf("const next = panelSignature", renderAt);
  check("and nothing rewrites the record in between",
    signatureAt > 0 && !/\bpainted\s*=/.test(src.slice(signatureAt, skipAt)));

  // A control that replaces itself in place — the drawn card's ＋ becoming the
  // two save targets — disconnects the element the bar was describing without
  // changing anything the signature can see. Clearing that after the decision
  // is too late: the panel skips, and the bar keeps describing a button that
  // is no longer there.
  const peekAt = src.indexOf("dropStalePeek();", renderAt);
  check("and clears a stale description before deciding, not after",
    peekAt > renderAt && peekAt < skipAt);
}

/* ---------- what the editor tells the panel ---------- */

// The bar offers 通用 or this channel only, and which of those is possible
// depends on what is in the editor — a member emoji can go nowhere else. That
// decision used to be made inside the listener that wired the editor up, where
// no test could reach it, so the signature could be told about a state that
// nothing ever computed.
const editFrom = src.indexOf("  function editorChanged(input) {");
const editTo = src.indexOf("  function watchInput(input) {", editFrom);
if (editFrom < 0 || editTo < 0 || editTo <= editFrom) {
  console.log("FAIL could not lift editorChanged out of content.js");
  process.exit(1);
}

const words = (value) => ({ type: "text", value });
const member = (owner) => ({ type: "youtubeEmoji", emojiId: `${owner}/heart` });

function editor({ editing = null, notice = null } = {}) {
  const seen = { renders: 0, bars: 0, cleared: 0 };
  const api = new Function(
    "seen", "tokens",
    `let editingId = ${JSON.stringify(editing)};
     let notice = ${JSON.stringify(notice)};
     const clearNotice = () => { notice = null; seen.cleared += 1; };
     let inputHasContent = false;
     let inputIsPinned = false;
     let currentTokens = [];
     const readInput = (input) => {
       currentTokens = tokens.collectTokens(input);
       return tokens.hasSubstance(currentTokens);
     };
     const render = () => { seen.renders += 1; };
     const refreshBar = () => { seen.bars += 1; };
     ${src.slice(editFrom, editTo)}
     return { editorChanged, filled: () => inputHasContent, pinned: () => inputIsPinned,
              editing: () => editingId, notice: () => notice };`
  )(seen, {
    // An editor is just what is in it.
    collectTokens: (input) => input || [],
    hasSubstance: (list) => list.some((t) => t.emojiId || t.value?.trim()),
    requiredChannels: (list) => [...new Set(list.filter((t) => t.emojiId).map((t) => t.emojiId.split("/")[0]))]
  });
  return { ...api, seen };
}

let e = editor();
e.editorChanged([]);
check("an empty editor nobody was editing changes nothing", e.seen.bars === 0);

e.editorChanged([words("わこつ")]);
check("typing rebuilds the bar", e.seen.bars === 1);
check("and the panel is told the editor has something in it", e.filled() === true);
check("which anyone can send", e.pinned() === false);

e.editorChanged([words("わこつ")]);
check("typing more of the same does not rebuild it again", e.seen.bars === 1);

e.editorChanged([words("わこつ"), member("UCsakura0000000000000000")]);
check("a member emoji arriving rebuilds the bar", e.seen.bars === 2);
check("and is what pins the comment to this channel", e.pinned() === true);

e.editorChanged([words("わこつ")]);
check("taking it out again rebuilds it once more", e.seen.bars === 3);
check("and unpins the comment", e.pinned() === false);

// A notice is in the same row as the save targets and outranks them, so an
// error about what was typed hid the buttons needed to fix it — for the six
// seconds it took to time out. Typing again is the answer: a message about
// what just happened stops being news as soon as something else happens.
e = editor({ notice: { message: "混到了多個頻道的會員限定貼圖" } });
e.editorChanged([words("わこつ")]);
check("typing clears a notice that was in the way", e.notice() === null);
check("and the bar is rebuilt without it", e.seen.bars >= 1);

// Emptying the editor is how you stop editing, and there is no other way out.
e = editor({ editing: "card-1" });
e.editorChanged([words("直している")]);
e.editorChanged([]);
check("emptying the editor ends the edit", e.editing() === null);
check("and redraws rather than only rebuilding the bar", e.seen.renders === 1);

/* ---------- what the bar adds to a card ---------- */

// The card is under the pointer. Repeating what is written on it says
// nothing, and for member emoji it said something wrong: their text is the
// name YouTube files them under, so `:_tadaima:` three times read out as
// `tadaimatadaimatadaima`. What a card cannot show is the number — trending
// is a dot in the corner, not a count.
{
  const from = src.indexOf("  function cardPeek(card) {");
  const to = src.indexOf("  function trackPeek(");
  const sizes = src.indexOf("  // How much a card at this size can show");
  const sizesTo = src.indexOf("  function buildCard(");
  if (from < 0 || sizes < 0) {
    console.log("FAIL could not lift cardPeek out of content.js");
    process.exit(1);
  }

  const api = new Function(
    "tokens", "settingsCache", "watcher", "t", "document",
    `${src.slice(sizes, sizesTo)}
     ${src.slice(from, to)}
     return { cardPeek, cardBody, widthOf };`
  )(
    { toPlainText: (list) => (list || []).map((x) => (x.type === "text" ? x.value : x.alt || "")).join(""),
      toFragment: () => ({}) },
    { cardSize: "small" },
    { ranking: () => new Map() },
    (key, ...args) => [key, ...args].join("|"),
    { createElement: () => ({ appendChild() {}, dataset: {}, set className(v) {} }) }
  );

  const stamp = (n) => new Array(n).fill(0).map(() => (
    { type: "youtubeEmoji", emojiId: "UCx/y", alt: "tadaima", sharedTooltipText: ":_tadaima:" }));
  const words = (value) => [{ type: "text", value }];

  check("a card says what it says, so the bar does not repeat it",
    api.cardPeek({ tokens: words("わこつ") }).text === "");
  check("nor does it spell out an emoji's filename",
    api.cardPeek({ tokens: stamp(3) }).text === "");

  // The card breathes in the corner when it is being said right now, and
  // five people or fifty does not change what anybody does about it.
  check("nor count what the card is already showing it is doing",
    api.cardPeek({ tokens: stamp(3), hits: 5 }).text === "");
  check("and a drawn card is not told where its own ＋ is",
    api.cardPeek({ tokens: stamp(3), drawn: true, hits: 7 }).text === "");

  // The one thing a card genuinely cannot show: itself, when it is too full.
  const long = words("あ".repeat(25));
  check("a card too full to read is read out in the bar",
    api.cardPeek({ tokens: long, hits: 4 }).text === "あ".repeat(25));

  // An emoji is a picture about two characters wide, not the length of its
  // name — measuring the text shrank and faded a card of three small
  // pictures for being 21 characters long.
  check("three emoji are six characters wide, not twenty-one",
    api.widthOf({ tokens: stamp(3) }) === 6);
  check("so a card of them is not treated as overlong",
    !api.cardBody({ tokens: stamp(3) }, "small").body.dataset.length);
  check("while a card of actual words still is",
    api.cardBody({ tokens: long }, "small").body.dataset.length === "long");
}

/* ---------- keeping a card that was dealt to you ---------- */

// Built, not read. Asserting that the source says `drawnTools(card)` let a
// drawnTools returning an empty div through — the control is what matters,
// not the call.
{
  const toolsFrom = src.indexOf("  function drawnTools(card) {");
  const toolsTo = src.indexOf("\n  function ", toolsFrom + 10);
  const iconFrom = src.indexOf("  function iconButton(");
  const iconTo = src.indexOf("\n  function ", iconFrom + 10);
  if (toolsFrom < 0 || iconFrom < 0) {
    console.log("FAIL could not lift drawnTools out of content.js");
    process.exit(1);
  }

  const document = documentFor(page());
  const made = new Function(
    "t", "document", "cardPeek", "stageForSaving", "saveTokens", "targetButtons", "svgIcon", "describe",
    [src.slice(toolsFrom, toolsTo), src.slice(iconFrom, iconTo), "return drawnTools;"].join("\n")
  )(
    (key) => key,
    document,
    () => ({ text: "" }),
    () => {},
    () => {},
    () => [document.createElement("button")],
    () => document.createElement("svg"),
    () => {}
  )({ tokens: [{ type: "text", value: "888" }] });

  const buttons = [];
  (function find(node) {
    for (const kid of node.kids || []) { if (kid.tag === "BUTTON") buttons.push(kid); find(kid); }
  })(made);

  check("a drawn card is handed something to press", buttons.length >= 1);
  check("and it is the one that keeps it", (made.attrs.class || "").includes("od-card-tools"));
}

// With auto-send on, pressing a card sends it — so the ＋ is the only way to
// keep a drawn one, and the list row was shipped without it, which left the
// card playable and unkeepable for exactly the people who had turned that
// setting on.
{
  const upto = (at) => src.slice(at, src.indexOf("\n  function ", at + 10));
  const row = upto(src.indexOf("  function buildDrawnRow(card) {"));
  const fan = upto(src.indexOf("  function buildDrawn(card, { size }) {"));

  check("a drawn card in the fan can be kept", row.length > 0 && fan.includes("drawnTools(card)"));
  check("and so can one in the list", fan.length > 0 && row.includes("drawnTools(card)"));
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
                     typing = false, pinned = false, settings = {}, channel = "UCaaa", name = "さくら",
                     hue = 320, width = 400, presets = 1,
                     shown = [], poolCards = [], drawn = null } = {}) {
  return new Function(
    "poolOpen", "expanded", "editingId", "flashId", "inputHasContent", "inputIsPinned",
    "tokens", "presetsOnHand", "rootEl",
    `${src.slice(sigFrom, sigTo)} return panelSignature;`
  )(
    pool, more, editing, flash, typing, pinned,
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
  ["typing something only this channel can send", { typing: true, pinned: true }],
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
