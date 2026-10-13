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

const peekFrom = src.indexOf("  // What makes one peek a different peek.");
const peekTo = src.indexOf("  function poolTabs(", peekFrom);
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
const dropped = b.dropStalePeek();
check("and removing that control clears it", b.peek() === null);
// The caller needs to know, because it may be about to return without
// redrawing: the panel skips a render whose signature has not changed, and
// the signature cannot see a peek.
check("and says so, for a caller that is about to skip", dropped === true);
check("with nothing left owning the bar", b.owner() === null);

// A control still on the page keeps its description: the panel re-renders
// every few seconds in chat-driven mode, and the pointer may not have moved.
b = bar();
const staying = { isConnected: true };
b.setPeek({ text: "この札を編集" }, staying);
check("a control still there keeps its description",
  b.dropStalePeek() === false && b.peek()?.text === "この札を編集");

// Clearing has no owner to remember.
b = bar();
b.setPeek({ text: "x" }, { isConnected: true });
b.setPeek(null);
check("clearing forgets the owner too", b.owner() === null);

// Idle, the bar says which deck this is and how much of it travels, so a peek
// with nothing in it has to leave it alone. An empty object is still truthy:
// when cardPeek briefly answered `{ text: "" }` the bar drew an empty row
// where the deck's name had been, and then — because "" and null compare the
// same here — moving the pointer away was not a change and the bar was never
// rebuilt. One hover emptied it for good.
b = bar();
b.setPeek({ text: "" }, { isConnected: true });
check("a peek with nothing in it leaves the bar to the deck", b.peek() === null);
check("with nothing owning it", b.owner() === null);
check("and no redraw asked for on the way past", b.seen.refreshes === 0);

// A card that does have something to say still says it, and the way back out
// is still a change — otherwise the warning would be the thing that sticks.
b = bar();
b.setPeek({ text: "メンバー限定", warning: true }, { isConnected: true });
check("a locked card still speaks", b.peek()?.text === "メンバー限定");
b.setPeek({ text: "" }, { isConnected: true });
check("and moving to one that does not gives the bar back", b.peek() === null);
check("which is worth the redraw", b.seen.refreshes === 2);

/* ---------- nothing moves under the pointer ---------- */

// Every automatic redraw goes through scheduleRender — the chat changing, a
// drawn card's hold running out, a resize, the presets arriving — and it is
// held while the pointer is on the panel. So a card cannot be swapped out
// from under the cursor; a short hold means the card is gone sooner, not
// that it goes while you are reaching for it.
{
  const from = src.indexOf("  function scheduleRender() {");
  const to = src.indexOf("\n  }", from) + 4;
  if (from < 0 || to <= from) {
    console.log("FAIL could not lift scheduleRender out of content.js");
    process.exit(1);
  }

  const panelWith = (frozen) => {
    const seen = { renders: 0 };
    const api = new Function(
      "seen", "frozen",
      `let stopped = false;
       let pendingRender = false;
       let refreshTimer = null;
       const clearTimeout = () => {};
       const setTimeout = (fn) => { fn(); return 1; };
       const render = () => { seen.renders += 1; };
       ${src.slice(from, to)}
       return { scheduleRender, owed: () => pendingRender };`
    )(seen, frozen);
    return { ...api, seen };
  };

  let p = panelWith(false);
  p.scheduleRender();
  check("with nothing under the pointer the panel redraws", p.seen.renders === 1);

  p = panelWith(true);
  p.scheduleRender();
  check("the pointer on the panel holds the redraw", p.seen.renders === 0);
  check("and remembers that one is owed", p.owed() === true);
}

/* ---------- what the stripe is allowed to say ---------- */

// The stripe means scope, and scope is the one thing you need while deciding
// whether to add a card: a channel-only one works here and nowhere else. The
// panel sets data-scope on every card and had it right — and then the pool
// repainted every ::before grey, "being browsed, not in play", so the answer
// never reached the screen. Worst on the preset half, whose cards have never
// been seen before and have nothing else to go on.
//
// A rule, not a line of code, which is why no other test here could see it.
{
  const css = readFileSync(
    process.env.OD_CSS
      ? new URL(`file://${process.env.OD_CSS}`)
      : new URL("../../content.css", import.meta.url),
    "utf8"
  );
  // Each piece holds one rule: its selector and the declarations after it.
  const inThePool = css.split("}").filter((rule) => rule.includes('[data-pool="true"]'));
  check("the pool has rules of its own at all", inThePool.length > 0);
  check("the pool does not paint over the scope stripe",
    inThePool.every((rule) => !(rule.includes("::before") && rule.includes("background"))));
}

/* ---------- a long channel name gives the controls room ---------- */

// The channel save target sits beside 通用, the pool and the builder. A
// non-shrinking target overflows that row even though its label has ellipsis.
// Pin the CSS sizing contract here; pixel geometry needs a browser.
{
  const css = readFileSync(
    process.env.OD_CSS
      ? new URL(`file://${process.env.OD_CSS}`)
      : new URL("../../content.css", import.meta.url),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .flatMap(([, group, body]) => group.split(",").map((selector) => ({
      selector: selector.trim(), body,
      // These selectors have only classes, attributes and type names.
      specificity: (selector.match(/[.\[]/g) || []).length
    })));

  // Only the selectors that apply to these elements in the bar. Resolve
  // specificity and source order so an earlier or weaker override cannot pass.
  const styleFor = (...selectors) => Object.fromEntries(rules
    .filter((rule) => selectors.includes(rule.selector))
    .sort((a, b) => a.specificity - b.specificity)
    .flatMap(({ body }) => body.split(";").filter((declaration) => declaration.includes(":"))
      .map((declaration) => declaration.split(":").map((part) => part.trim()))));

  const target = styleFor(".od-text-button", ".od-save-channel", ".od-save-channel[data-primary]");
  check("the channel save target can shrink below its long name",
    target["flex-shrink"] === "1" && target["min-width"] === "0");
  check("the save group can give room to the other bar controls",
    styleFor(".od-bar-save")["min-width"] === "0");
  check("the global save target keeps its size",
    styleFor(".od-text-button")["flex-shrink"] === "0");
  check("the pool and builder controls keep their size",
    styleFor(".od-text-button", ".od-bar > .od-text-button")["flex-shrink"] === "0");

  const label = styleFor(".od-text-button span");
  check("the channel save label clips with an ellipsis on one line",
    label.overflow === "hidden" && label["white-space"] === "nowrap" && label["text-overflow"] === "ellipsis");
  check("the save icon keeps its size while the label shrinks",
    styleFor(".od-text-button svg")["flex-shrink"] === "0");
}

/* ---------- the way into the pool ---------- */

// How many cards the two halves come to, lifted rather than worked out here.
// Written into the fixture, "a card in both halves is one card to add" was a
// fact about the fixture: the panel could go back to adding the two labels
// together and every assertion below would have gone on agreeing with itself.
const countFrom = src.indexOf("  function cardsWaiting(mine, offered) {");
const countTo = src.indexOf("\n  }", countFrom);
if (countFrom < 0 || countTo <= countFrom) {
  console.log("FAIL could not lift cardsWaiting out of content.js");
  process.exit(1);
}
const cardsWaiting = new Function(`${src.slice(countFrom, countTo + 4)} return cardsWaiting;`)();

check("a card in both halves is one card to add",
  cardsWaiting([{ id: "x" }], [{ id: "x" }]) === 1);
check("and two that are not the same card are two",
  cardsWaiting([{ id: "x" }], [{ id: "y" }]) === 2);

// And that the panel still goes through it. The function can be right and
// unused: putting the two lengths back into render() left every assertion
// above green, because they all call the function directly.
check("and the panel works the count out with it",
  /\n    const waiting = cardsWaiting\(mine, offered\);\n/.test(src));

// It used to be a full-width row under the hand, which spent a line of a
// short panel saying one short thing. The bar is already where this UI puts
// anything that would otherwise take room of its own.
{
  const from = src.indexOf(
    "  function buildBar({ channel, hue, count, mine, offered, waiting, empty, folded }) {");
  const to = src.indexOf("  function noticeRow(");
  if (from < 0 || to < 0 || to <= from) {
    console.log("FAIL could not lift buildBar out of content.js");
    process.exit(1);
  }

  const bar = (poolOpen, mine, offered = 0, waiting = mine + offered,
               empty = false, folded = false) => new Function(
    "poolOpen", "mine", "offered", "waiting", "empty", "folded", "document", "t",
    `let poolTab = "mine";
     const notice = null, peek = null, inputHasContent = false;
     const noticeRow = () => ({ is: "notice" });
     const peekReadout = () => ({ is: "peek" });
     const poolTabs = (m, o) => ({ is: "tabs", mine: m, offered: o });
     const saveTargets = () => ({ is: "saveTargets" });
     const deckIdentity = (channel, hue, count, empty, folded) => ({ is: "identity", empty, folded });
     const buildAction = (icon, text) => ({ is: "action", icon, text });
     const render = () => {};
     const openOptions = () => {};
     ${src.slice(from, to)}
     return buildBar({ channel: null, hue: 0, count: 4, mine, offered, waiting, empty, folded });`
  )(
    poolOpen,
    mine,
    offered,
    waiting,
    empty,
    folded,
    { createElement: () => ({
        kids: [],
        append(...nodes) { this.kids.push(...nodes); },
        appendChild(node) { this.kids.push(node); },
        set className(v) {}
      }) },
    (key, ...rest) => [key, ...rest].join("|")
  );

  const wayIn = (built) => built.kids.find((k) => k.is === "action" && k.icon === "plus");

  check("the way in is in the bar", !!wayIn(bar(false, 7)));
  check("and says how many are waiting", wayIn(bar(false, 7)).text.includes("7"));
  check("nothing to add offers no way in", !wayIn(bar(false, 0)));
  check("and the pool itself offers no way into itself", !wayIn(bar(true, 7)));
  check("the builder is still there either way",
    bar(false, 7).kids.some((k) => k.icon === "deck") && bar(false, 0).kids.some((k) => k.icon === "deck"));

  // Both halves counted. A channel whose preset is the only thing on offer —
  // nothing saved yet, which is every channel at the start — had no way in
  // at all while the button counted the pool alone.
  check("a preset alone is still a way in", !!wayIn(bar(false, 0, 10)));
  check("and the count is everything you could add",
    wayIn(bar(false, 7, 10)).text.includes("17"));

  // Cards, not tabs. The same card is in both halves when you own something
  // the preset also carries — yours, and the preset saying everyone here uses
  // it — and adding the two labels up counted it twice.
  check("the way in says how many cards, not how many entries",
    wayIn(bar(false, 7, 10, 12)).text.includes("12"));

  // The button shares its line with the words beside it. `Pool 10000` took
  // 23px out of the sentence, which was then cut — and a pool that size is
  // not far-fetched, since a backup holding it validates and is under a
  // megabyte. tools/check-width.mjs budgets for the capped label, so a count
  // printed in full would overrun a bar the checker thinks is fine.
  check("a pool too large to print is not printed in full",
    wayIn(bar(false, 100000, 0, 100000)).text.includes("99+"));
  check("and one small enough is printed as it is",
    wayIn(bar(false, 7)).text.includes("7"));
  check("and with nothing to add there is still no way in", !wayIn(bar(false, 3, 3, 0)));

  // Inside, they are two labels rather than one list: a card you saved and a
  // card a preset is offering are different things, and shown together the
  // pool was full of cards that were not in it.
  const identity = (built) => built.kids.find((k) => k.is === "identity");
  check("the bar is told when there is nothing below it to identify",
    identity(bar(false, 0, 0, 0, true))?.empty === true);
  check("and when there is", identity(bar(false, 7))?.empty === false);

  // And which way the handle on that line points. The bar is the only thing
  // a folded panel still draws, so the way back out is on it.
  check("the bar is told when the panel is folded away",
    identity(bar(false, 7, 0, 7, false, true))?.folded === true);
  check("and when it is open", identity(bar(false, 7))?.folded === false);

  const tabs = (built) => built.kids.find((k) => k.is === "tabs");
  check("the pool shows its two halves apart", !!tabs(bar(true, 7, 10)));
  check("each counted on its own",
    tabs(bar(true, 7, 10)).mine === 7 && tabs(bar(true, 7, 10)).offered === 10);
}

/* ---------- the panel with nothing in it ---------- */

// An empty deck used to cost a bar, a row of hint text, and the padding
// around both. In a chat column 400px tall that was most of what a new deck
// ever showed — and all a popped-out chat window ever showed, forever, since
// a window with no owner to find can never have a deck at all.
//
// So the sentence moved onto the bar's own line and the row went away. Which
// sentence it is matters. A card saved with no channel still becomes a card —
// it goes to the pool — but it has no deck to appear in, decks being per
// channel, so the hint would answer a question nobody asked and leave the
// real one unanswered. The panel has to say it cannot tell where it is.
{
  const lift = (name, until) => {
    const from = src.indexOf(`  function ${name}(`);
    const to = src.indexOf(until, from);
    if (from < 0 || to < 0 || to <= from) {
      console.log(`FAIL could not lift ${name} out of content.js`);
      process.exit(1);
    }
    return src.slice(from, to);
  };

  const element = (tag) => ({
    tag,
    kids: [],
    className: "",
    textContent: "",
    dataset: {},
    attrs: {},
    style: { setProperty() {} },
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(type, handler) { this.handlers = [...this.handlers || [], handler]; },
    click() { for (const handler of this.handlers || []) handler(); },
    append(...nodes) { this.kids.push(...nodes); },
    appendChild(node) { this.kids.push(node); }
  });

  // What the handle asked for, in order. Nothing is stored here: the panel
  // writes the answer to settings and draws itself again from what comes
  // back, so all this end of it does is ask.
  const asked = [];
  const said = lift("deckIdentity", "  // Written down rather than kept here");
  const identity = (channel, empty, folded = false) => new Function(
    "channel", "empty", "folded", "document", "t", "svgIcon", "setFolded",
    `${lift("barLine", "  function noticeRow(")}
     ${said}
     return deckIdentity(channel, 200, empty ? 0 : 4, empty, folded);`
  )(channel, empty, folded, { createElement: element },
    (key, ...rest) => [key, ...rest].join("|"),
    (name) => ({ is: "icon", name }), (next) => asked.push(next));

  const here = { id: "UC1", name: "さくらみこ" };

  check("an empty deck says what to do instead of counting to zero",
    identity(here, true).textContent === "pool.emptyHint");
  check("and a chat whose channel cannot be worked out says that instead",
    identity(null, true).textContent === "toast.noChannel");

  // Through barLine, which is the door tools/check-width.mjs reads. A
  // sentence written straight into a span is a sentence nothing measures,
  // and this one shares its room with the pool and builder controls.
  check("and says it on the bar's own measured line",
    identity(here, true).className === "od-bar-line");
  check("which is all the bar puts there, not a row underneath",
    identity(here, true).kids.length === 0);

  // The collapse is not allowed to eat the ordinary bar on its way past.
  check("a deck with cards in it still names its channel and counts them",
    identity(here, false).kids.some((k) => k.textContent === "さくらみこ") &&
      identity(here, false).kids.some((k) => k.textContent === "count.cards|4"));

  // The deck's own line doubles as the handle, rather than a third control
  // beside the pool and the builder: the bar's one line of words is cut to
  // whatever those leave it, and the tightest sentence on it has under 7px
  // to spare. A handle that costs nothing is one that is part of the line.
  const open = identity(here, false);
  const shut = identity(here, false, true);

  check("the line that names the deck is the handle that folds it",
    open.tag === "button" && open.className.includes("od-fold"));
  check("and it says, to a reader that cannot see it, which state it is in",
    open.attrs["aria-expanded"] === "true" && open.attrs["aria-label"] === "aria.fold" &&
      shut.attrs["aria-expanded"] === "false" && shut.attrs["aria-label"] === "aria.unfold");
  check("the chevron turns with it rather than being two different marks",
    open.dataset.folded === "false" && shut.dataset.folded === "true" &&
      open.kids.some((k) => k.is === "icon" && k.name === "chevron"));

  asked.length = 0;
  open.click();
  shut.click();
  check("and each asks for the state it is not in",
    asked.length === 2 && asked[0] === true && asked[1] === false);

  check("the hint is said once, on the bar, and nowhere else",
    (src.match(/t\("pool\.emptyHint"\)/g) || []).length === 1 &&
      said.includes('t("pool.emptyHint")'));

  // Setting the mark is not the whole of it: the panel has to take it off
  // again when a card turns up. Guarded with `if (empty)` the source still
  // reads correctly, and a populated panel keeps the collapsed padding — so
  // the decision is run here rather than read.
  const from = src.indexOf("      rootEl.dataset.mode = data.settings.mode;");
  const to = src.indexOf("      rootEl.appendChild(barEl);", from);
  if (from < 0 || to < 0 || to <= from) {
    console.log("FAIL could not lift the collapse out of render");
    process.exit(1);
  }

  const root = {
    dataset: {},
    marks: new Set(),
    toggleAttribute(name, on) { if (on) this.marks.add(name); else this.marks.delete(name); },
    appendChild() {}
  };
  const seen = {};
  const step = new Function("rootEl", "seen", "shown", "drawn", "wants", "poolOpen", `
    let barContext, barEl;
    const data = { settings: { mode: "hand", folded: wants } };
    const channel = null, hue = 0, waiting = 0;
    const mine = [], offered = [];
    const buildBar = (context) => { seen.context = context; return {}; };
    ${src.slice(from, to)}`);

  step(root, seen, [], null, false, false);
  check("a panel with nothing to show is marked collapsed",
    root.marks.has("data-empty") && seen.context.empty === true);

  step(root, seen, [{ id: "a" }], null, false, false);
  check("and the mark comes off the moment it has a card",
    !root.marks.has("data-empty") && seen.context.empty === false);

  step(root, seen, [], { key: "drawn" }, false, false);
  check("a card drawn from chat is something to show, so it is not collapsed",
    !root.marks.has("data-empty"));

  // The other way down to one line: a full deck the viewer has put away.
  step(root, seen, [{ id: "a" }], null, true, false);
  check("a panel asked to stay folded is marked folded",
    root.marks.has("data-folded") && seen.context.folded === true);

  step(root, seen, [{ id: "a" }], null, false, false);
  check("and opens again when it is asked to",
    !root.marks.has("data-folded") && seen.context.folded === false);

  // Two different reasons for the same line, and only one of them has a
  // handle on it: an empty panel marked folded as well could not be opened,
  // because the line it shows is a sentence and not the deck.
  step(root, seen, [], null, true, false);
  check("a panel with nothing in it is empty rather than folded",
    root.marks.has("data-empty") && !root.marks.has("data-folded"));

  step(root, seen, [{ id: "a" }], null, true, true);
  check("and the pool, which you opened on purpose, is not folded shut under you",
    !root.marks.has("data-folded"));

  // The mark only takes the padding away. What a folded panel does not draw
  // is decided by the lines after the ones lifted above.
  const rest = src.slice(to);
  check("a folded panel stops at the bar",
    rest.indexOf("\n      if (folded) return;\n") > 0 &&
      rest.indexOf("if (folded) return;") < rest.indexOf("const hidden ="));
}

/* ---------- and the room that gives back ---------- */

// Most of what an empty panel costs is the padding around it, which is set on
// the root — so collapsing it is a rule rather than a line of code, and no
// other test here could see it. List mode sets the same padding at the same
// weight, so the collapsed rule has to be written after it; before it, an
// empty panel in list mode keeps the whole block.
{
  const css = readFileSync(
    process.env.OD_CSS
      ? new URL(`file://${process.env.OD_CSS}`)
      : new URL("../../content.css", import.meta.url),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  // Anchored to the start of a line, or `.od-bar` finds the descendant rule
  // `#oshideck-root[data-empty] .od-bar` written above it and compares the
  // collapsed height with itself.
  // Either the whole of a rule's selector or the first name in a list of
  // them: the collapsed padding is now asked for by two, and a rule found by
  // its second name would still be the rule.
  const bodyOf = (selector) => {
    for (const end of [" {", ",\n"]) {
      const at = css.indexOf(`\n${selector}${end}`);
      if (at >= 0) return css.slice(at, css.indexOf("}", at));
    }
    return "";
  };
  const px = (body, name) => Number(body.match(new RegExp(`${name}:\\s*(\\d+)px`))?.[1] ?? NaN);

  // `padding: 7px 12px 5px` is top, sides, bottom. Read against the first
  // number, a collapsed bottom of 6px — more than the 5px it replaces —
  // counted as an improvement.
  const shorthand = (body) => {
    const parts = (body.match(/padding:\s*([^;]+)/)?.[1] || "")
      .trim().split(/\s+/).map((value) => Number(value.replace("px", "")));
    const [top, , bottom = top] = parts;
    return { top, bottom };
  };

  // Smaller than, not equal to a number written here as well: a test that
  // copies the stylesheet agrees with whatever the stylesheet says. And
  // smaller than both bottoms, since list mode sets its own.
  const collapsed = bodyOf("#oshideck-root[data-empty]");
  const normal = shorthand(bodyOf("#oshideck-root"));
  const lowest = Math.min(normal.bottom,
    px(bodyOf('#oshideck-root[data-mode="list"]'), "padding-bottom"));
  check("the panel gives up its padding when it has nothing to show",
    px(collapsed, "padding-top") < normal.top &&
      px(collapsed, "padding-bottom") < lowest);

  check("and keeps a line for the bar, a shorter one",
    px(bodyOf("#oshideck-root[data-empty] .od-bar"), "min-height") <
      px(bodyOf(".od-bar"), "min-height"));

  check("written after list mode, which sets the same padding at the same weight",
    css.indexOf("#oshideck-root[data-empty],") >
      css.indexOf('#oshideck-root[data-mode="list"] {'));

  // Folded away is the same line, for the other reason, and gets the same
  // room back. Asked for by the same rules rather than by a second set with
  // numbers of their own, which is a thing to keep true and not only to do.
  check("a panel folded away gives up exactly what an empty one does",
    px(bodyOf("#oshideck-root[data-folded]"), "padding-top") === px(collapsed, "padding-top") &&
      px(bodyOf("#oshideck-root[data-folded]"), "padding-bottom") ===
        px(collapsed, "padding-bottom") &&
      px(bodyOf("#oshideck-root[data-folded] .od-bar"), "min-height") ===
        px(bodyOf("#oshideck-root[data-empty] .od-bar"), "min-height"));

  // The handle is a button for the keyboard's sake and has to be talked out
  // of looking like one, since what it is drawn as is the deck's own line.
  const handle = bodyOf("button.od-bar-identity");
  check("the handle is a button nobody can tell is a button",
    /border:\s*0/.test(handle) && /background:\s*none/.test(handle) &&
      /font:\s*inherit/.test(handle) && /cursor:\s*pointer/.test(handle));

  check("and its chevron faces the way the panel will go, not two marks",
    /transform:\s*rotate\(180deg\)/.test(bodyOf(".od-fold svg")) &&
      /transform:\s*none/.test(bodyOf('.od-fold[data-folded="true"] svg')));

  const line = bodyOf(".od-bar-line");
  check("the bar's line is cut rather than wrapped onto a second one",
    /white-space:\s*nowrap/.test(line) && /text-overflow:\s*ellipsis/.test(line) &&
      /overflow:\s*hidden/.test(line));
}

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
  // And the skip itself has to put the bar right. Clearing the variables
  // while leaving the bar as it was left the description on screen until
  // something else happened to refresh it.
  const skipBody = src.slice(skipAt, src.indexOf("painted = next;", skipAt));
  check("and the skip refreshes the bar it just emptied",
    skipBody.includes("if (dropped) refreshBar();"));
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

  // splitEmoji is the real one. How wide a card is and how many pictures get
  // drawn on it are the same count, and a copy written here would only ever
  // agree with itself.
  globalThis.OshiDeck ||= {};
  await import(
    process.env.OD_TOKENS
      ? `file://${process.env.OD_TOKENS}`
      : new URL("../../src/tokens.js", import.meta.url).href
  );
  const { splitEmoji, repeated } = globalThis.OshiDeck.tokens;

  const drawFrom = src.indexOf("  function peekReadout({");
  const drawTo = src.indexOf("  // What makes one peek a different peek.");
  if (drawFrom < 0 || drawTo < 0) {
    console.log("FAIL could not lift peekReadout out of content.js");
    process.exit(1);
  }

  const api = new Function(
    "tokens", "settingsCache", "watcher", "t", "document",
    `${src.slice(sizes, sizesTo)}
     ${src.slice(from, to)}
     ${src.slice(drawFrom, drawTo)}
     return { cardPeek, cardBody, widthOf, peekReadout };`
  )(
    { toPlainText: (list) => (list || []).map((x) => (x.type === "text" ? x.value : x.alt || "")).join(""),
      // A marker rather than a node: what matters is that the bar asked for
      // the card to be drawn, and asked for it the way a card face is drawn.
      toFragment: (list, options) => ({ drawn: list, preview: options?.preview }),
      cardKey: (list) => (list || [])
        .map((x) => (x.type === "text" ? x.value : `\u0001${x.emojiId}`)).join(""),
      splitEmoji, repeated },
    { cardSize: "small" },
    { ranking: () => new Map() },
    (key, ...args) => [key, ...args].join("|"),
    { createElement: () => ({
        kids: [],
        dataset: {},
        appendChild(node) { this.kids.push(node); },
        set className(v) {},
        set textContent(v) { this.wrote = v; }
      }) }
  );

  const stamp = (n) => new Array(n).fill(0).map(() => (
    { type: "youtubeEmoji", emojiId: "UCx/y", alt: "tadaima", sharedTooltipText: ":_tadaima:" }));
  // Different stamps, for the cases about how much room pictures take. The
  // same stamp n times is drawn as one and a count, which is a separate
  // question and has its own cases below.
  const varied = (n) => new Array(n).fill(0).map((_, at) => (
    { type: "youtubeEmoji", emojiId: `UCx/y${at}`, alt: "tadaima", sharedTooltipText: ":_tadaima:" }));
  const words = (value) => [{ type: "text", value }];

  // The bar shows the card in full — shrunk, faded and cut off is the state
  // a full card is in, and the bar has room the card does not.
  //
  // It carries the tokens, never a spelling of them. Spelling was why this
  // was taken out once: a member emoji's text is the name YouTube files it
  // under, so three stamps read back as `tadaimatadaimatadaima`.
  const long = words("あ".repeat(25));
  check("the bar carries the card's own tokens",
    api.cardPeek({ tokens: stamp(3) }).tokens?.length === 3);
  check("and no words that would spell the pictures out",
    !api.cardPeek({ tokens: stamp(3) }).text);
  check("words come through as words",
    api.cardPeek({ tokens: long }).tokens?.[0]?.value === "あ".repeat(25));

  // And it draws them the way a card face draws them.
  {
    const readout = api.peekReadout(api.cardPeek({ tokens: stamp(3) }));
    check("the bar draws the stamps rather than naming them",
      readout.kids[0]?.drawn?.length === 3);
    // The same way a card face does. The editor's markup carries
    // `shared-tooltip-text`, which is YouTube's own attribute, and a bar
    // built that way would hand its tooltip the filenames all over again.
    check("the way a card face draws them, not the way the editor does",
      readout.kids[0]?.preview === true);
    check("and writes no text alongside them", readout.wrote === undefined);
  }

  // Still not the things the card already says about itself: it breathes in
  // the corner while it is being said, and its ＋ is on it.
  check("no count of who else is saying it",
    !api.cardPeek({ tokens: stamp(3), hits: 5 }).text);
  check("and a drawn card is not told where its own ＋ is",
    !api.cardPeek({ tokens: stamp(3), drawn: true, hits: 7 }).text);

  // A locked card is the one case where the bar has something of its own to
  // say, so there it is words — and they are drawn as words.
  {
    const locked = api.cardPeek({ tokens: stamp(3), locked: true, lapsed: true });
    check("a locked card is told why instead", locked.text === "peek.lockMembership");
    check("and marked as a warning", locked.warning === true);
    const readout = api.peekReadout(locked);
    check("which the bar writes out", readout.wrote === "peek.lockMembership");
    check("and nothing is drawn for it", readout.kids.length === 0);
  }

  // A picture is measured as a picture, never as the length of its name —
  // measuring the text shrank and faded a card of three small stamps for
  // being 21 characters long, which is `tadaimatadaimatadaima`.
  check("three stamps are nine wide, not twenty-one",
    api.widthOf({ tokens: varied(3) }) === 9);

  // The same for a stamp that arrived inside a sentence, now that the card
  // draws those as pictures too. Counting characters made these eleven wide,
  // because ✨ is one UTF-16 unit and 🦢 is two — so six pictures and three
  // pictures faded at different points for no reason a reader could see.
  check("a stamp inside text is a picture, not its characters",
    api.widthOf({ tokens: words("🦢✨🎶🫧🎀💜") }) === 18);
  check("and the words around it are still words",
    api.widthOf({ tokens: words("おつ🦢") }) === 5);
  check("a card of actual words is treated as overlong",
    api.cardBody({ tokens: long }, "small").body.dataset.length === "long");

  // How full is full. The budget decides when the contents stop fitting,
  // and fitting is an area: a stamp is about two characters wide and about
  // one and a half lines tall, so a small card holds four of them where it
  // holds eight characters.
  //
  // Measuring only the width put every step out of reach of the stamps. The
  // shrink arrived at ten of them and the fade never did, while the third
  // row was already being cut off at the card's edge at five.
  const step = (n, size) => api.cardBody({ tokens: varied(n) }, size).body.dataset.length;
  check("two stamps sit on a small card at full size", step(2, "small") === undefined);
  check("four shrink a step", step(4, "small") === "medium");
  check("seven shrink again, and that is the step that fades", step(7, "small") === "long");
  check("a large card holds four at full size", step(4, "large") === undefined);
  check("and reaches the fade later than a small one does", step(7, "large") === "medium");

  /* ---------- one thing, said over and over ---------- */

  // Most cards are: of the 2609 mined out of chat, 1150 are nothing but a
  // run of pictures repeated. Drawn literally, a small card has to shrink to
  // fit five stamps — and the stamps are the whole point of a card like that.
  {
    const body = api.cardBody({ tokens: stamp(5) }, "small").body;
    check("five of the same stamp draw as one picture and a count",
      body.kids.length === 2 && body.kids[0]?.drawn?.length === 1);
    check("the count says how many", body.kids[1]?.wrote === "×5");
    // The shortest unit, so six of one stamp is ×6 and not a unit of three
    // said twice — both describe the card, only one of them is a card.
    check("six of one stamp is six, not three twice",
      api.cardBody({ tokens: stamp(6) }, "small").body.kids[1]?.wrote === "×6");
    check("and the card keeps its full size", body.dataset.length === undefined);
    // Five different stamps still have to shrink: there is nothing to count.
    check("while five different ones still do not fit", step(5, "small") === "medium");
    check("the count takes room on the card too",
      api.widthOf({ tokens: stamp(5) }) === 5);
  }

  // A run, not only a single stamp.
  check("a repeated run of pictures collapses the same way",
    api.cardBody({ tokens: words("🦢✨🦢✨🦢✨") }, "small").body.kids[1]?.wrote === "×3");

  // Characters are a different question, and the answer is usually no.
  // `www` is the word, `88888` is the clapping, and `てぇてぇ`, `よしよし`,
  // `そうそう` are each one word that happens to be a doubling — writing any
  // of them as `×N` takes the word apart.
  const drawn = (text) => api.cardBody({ tokens: words(text) }, "small").body;
  check("repeated characters are left exactly as they are", drawn("www").kids.length === 1);
  check("and so is clapping", drawn("88888888").kids.length === 1);
  check("and a word that is a doubling", drawn("てぇてぇ").kids.length === 1);

  // Unless there is a terminator, which makes the unit something that was
  // said rather than the shape of how it was said. Of the 354 cards of
  // repeated characters mined from chat, all 14 with one read as a count and
  // none of the other 340 do.
  check("a chant with a terminator is counted", drawn("はい！はい！はい！はい！").kids[1]?.wrote === "×4");
  check("and the unit keeps its mark",
    drawn("アンコール！アンコール！").kids[0]?.drawn?.[0]?.value === "アンコール！");
  check("but a mark on its own is not something said", drawn("！！！！").kids.length === 1);

  // The card counts; the bar still shows what will actually be sent.
  check("the bar carries every one of them", api.cardPeek({ tokens: stamp(5) }).tokens?.length === 5);
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

const sigFrom = src.indexOf("  function panelSignature(data, channel, hue, shown, mine, offered, waiting, drawn) {");
const sigTo = src.indexOf("  function renderHand(", sigFrom);
if (sigFrom < 0 || sigTo < 0 || sigTo <= sigFrom) {
  console.log("FAIL could not lift panelSignature out of content.js");
  process.exit(1);
}

// Chat-driven mode renders every few seconds whether or not anything shown has
// changed. Getting this wrong in one direction redraws constantly — which made
// the drawn card lurch — and in the other leaves the panel stale, which is
// worse. So both directions are pinned.
function signature({ pool = false, tab = "mine", more = false, editing = null, flash = null,
                     typing = false, pinned = false, settings = {}, channel = "UCaaa", name = "さくら",
                     hue = 320, width = 400, presets = 1,
                     shown = [], mine = [], offered = [], drawn = null } = {}) {
  // Worked out by the panel's own line, not by this file.
  const waiting = cardsWaiting(mine, offered);
  return new Function(
    "poolOpen", "poolTab", "expanded", "editingId", "flashId", "inputHasContent", "inputIsPinned",
    "tokens", "presetsOnHand", "rootEl", "flashKind",
    `${src.slice(sigFrom, sigTo)} return panelSignature;`
  )(
    pool, tab, more, editing, flash, typing, pinned,
    { cardKey: (t) => (t || []).map((x) => x.value ?? x.emojiId).join("") },
    () => new Array(presets),
    { clientWidth: width },
    "found"
  )(
    { settings: { mode: "hand", cardSize: "small", rows: 2, sortBy: "heat", suggest: true, ...settings } },
    { id: channel, name }, hue, shown, mine, offered, waiting, drawn
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
  // The cards swap under the pointer and nothing else about the panel moves.
  ["switching to the other half of it", { pool: true, tab: "offered" }],
  ["expanding", { more: true }],
  ["editing a card", { editing: "a" }],
  ["flashing one", { flash: "a" }],
  ["typing", { typing: true }],
  ["typing something only this channel can send", { typing: true, pinned: true }],
  ["a settings change", { settings: { rows: 1 } }],
  // Folding is one of those, and the one that changes the most: the hand,
  // the rest of it and the drawn card all go. Left out of the signature the
  // panel would skip the redraw and stay exactly as it was, and the chevron
  // would answer a click by doing nothing.
  ["folding the panel away", { settings: { folded: true } }],
  ["switching channel", { channel: "UCbbb" }],
  ["the channel being named at last", { name: "" }],
  ["a new colour", { hue: 90 }],
  ["the panel being resized", { width: 320 }],
  ["the pool gaining a card", { mine: [{ id: "p" }] }],
  ["the preset starting to offer one", { offered: [{ id: "p" }] }],
  ["the presets arriving", { presets: 0 }]
]) {
  check(`${label} is a change`, signature({ shown: hand }) !== signature({ shown: hand, ...over }));
}

// The two halves of the pool counted apart. Delete a card the preset also
// carries and it leaves 「手持ち」 for 「プリセット」 in the same breath: one
// fewer here, one more there, and a total that has not moved. Counted
// together the panel saw nothing happen, skipped the render, and left the bar
// showing the tab counts from before — 「プリセット」 missing while the preset
// was offering a card.
// And the half it is in, which the total cannot answer either: save a card the
// preset was already offering and it joins your half without leaving the
// preset's — one more card you own, the same card on offer, the same number
// of cards to add.
check(
  "saving a card the preset already offers is a change",
  signature({ shown: hand, mine: [], offered: [{ id: "preset:x" }] }) !==
  signature({ shown: hand, mine: [{ id: "x" }], offered: [{ id: "x" }] })
);

// And the total, which neither length can answer: the preset dropping the
// card you own for one you do not leaves both halves exactly the size they
// were, with one more card to add than there was.
check(
  "the preset trading a card you own for one you do not is a change",
  signature({ shown: hand, mine: [{ id: "x" }], offered: [{ id: "x" }] }) !==
  signature({ shown: hand, mine: [{ id: "x" }], offered: [{ id: "y" }] })
);

check(
  "a card crossing from one half of the pool to the other is a change",
  signature({ shown: hand, mine: [{ id: "p" }, { id: "q" }], offered: [] }) !==
  signature({ shown: hand, mine: [{ id: "q" }], offered: [{ id: "p" }] })
);

process.exit(fail);
