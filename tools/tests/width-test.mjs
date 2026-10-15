// The bar is 400px and the notice row does not wrap. These are the rules
// tools/check-width.mjs is there to keep, and each one is broken here to see
// it go red — a checker that cannot fail is decoration.
import { readFileSync } from "node:fs";

// Loaded by path so the mutation runner can hand over a broken copy.
const { checkWidth, noticeKeys, roomIn, width } = await import(
  process.env.OD_WIDTH ? `file://${process.env.OD_WIDTH}` : "../check-width.mjs");

globalThis.OshiDeck = {};
globalThis.chrome = { i18n: { getUILanguage: () => "ja" } };
await import(new URL("../../src/i18n.js", import.meta.url));
const { MESSAGES } = globalThis.OshiDeck.i18n;

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const run = (over = {}) => {
  const output = [];
  const bad = checkWidth({ MESSAGES, read, report: (m) => output.push(m), ...over });
  return { bad, output: output.join("\n") };
};

/* ---------- the ruler ---------- */

// Measured in a real Chromium against the real CSS, with the bar at 400px.
// If the table drifts, every budget below drifts with it and says nothing.
const MEASURED = [
  ["The same card was already saved for any channel", 245.8],
  ["Member emoji from more than one channel are mixed in", 273.3],
  ["Added “Sakura” (3 of them were already in your pool)", 259.3]
];
for (const [text, real] of MEASURED) {
  check(`the ruler agrees with the browser on ${JSON.stringify(text.slice(0, 20))}`,
    Math.abs(width(text) - real) < 0.5);
}

// A character with no advance in the table is the one case where guessing
// would be worst: it would quietly read as an average letter and pass.
check("a character the table cannot measure is refused, not guessed",
  width("枚", { report: () => {} }) === null);

/* ---------- how much room there is ---------- */

// 238.2px is what a real Chromium reported for the busiest bar: the pool tab
// reading `Pool 24` beside the `Build` button. That number used to be written
// down; now it is worked out, so this is where the two have to meet. If the
// arithmetic drifts every budget below drifts with it, and nothing else here
// would say so. Handed the exact label that bar carried, the arithmetic has
// to come out at what was measured off it.
check("the room worked out for a bar reading Pool 24 is the one measured",
  Math.abs(roomIn({
    MESSAGES: { ...MESSAGES, "pool.short": { ...MESSAGES["pool.short"], en: "Pool 24" } },
    source: "\n  const MOST_SHOWN = 99;"
  }) - 238.2) < 0.1);

// A pool of four figures drew `Pool 10000` and took the width out of the
// sentence beside it, which was then cut. The cap belongs to content.js; what
// matters here is that the budget follows it instead of keeping its own idea.
check("a bar whose count may grow wider leaves the words less room",
  roomIn({ MESSAGES, source: "\n  const MOST_SHOWN = 9999;" }) <
    roomIn({ MESSAGES, source: "\n  const MOST_SHOWN = 24;" }));

check("and a panel whose cap cannot be read is not guessed at",
  roomIn({ MESSAGES, source: "there is no cap in here" }) === null);

/* ---------- what it reads ---------- */

check("every English notice fits the bar as it stands", run().bad === 0);

const toast = (body) => `function f() { showToast(${body}); }`;
const panel = (body) => `\n  const MOST_SHOWN = 99;\n  function f() { ${body} }`;

check("the keys come from the calls, so a new toast is measured too",
  [...noticeKeys(toast('t("toast.deleted")')).keys()].join() === "toast.deleted");

check("both sides of a choice are read, not just the first",
  [...noticeKeys(toast('a ? t("dup.inDeck") : t("dup.inPool")')).keys()].sort().join() ===
    "dup.inDeck,dup.inPool");

// A notice holds the row for a few seconds; what the bar says of itself
// holds it for as long as the deck is empty, which is longer. Same row, same
// cut, same budget — and it arrives through a different call.
check("what the bar says of itself is measured too, not only the toasts",
  [...noticeKeys('function f() { barLine(t("pool.emptyHint")); }').keys()].join() ===
    "pool.emptyHint");

check("and the panel's own empty line is one of the ones measured",
  noticeKeys(read("content.js")).has("pool.emptyHint"));

check("the button's own label is not measured as the message",
  [...noticeKeys(toast('t("toast.ejected"), { actionLabel: t("action.undo") }')).keys()].join() ===
    "toast.ejected");

// Every saved.* sentence reaches the row as `showToast(saved)`, with the
// sentence chosen a few lines above. None of them were measured.
check("a notice handed its sentence by name is measured too",
  noticeKeys(panel('const saved = ok ? t("saved.pool") : t("saved.global"); showToast(saved);'))
    .size === 2);

// Silently measuring nothing is the failure that looks like success.
check("and one whose sentence cannot be worked out at all is a failure",
  run({ read: (f) => (f === "content.js"
    ? panel('showToast(t("toast.deleted")); showToast(whateverThisHolds);')
    : read(f)) }).bad > 0);

// toast.saveFailedKept is handed a whole sentence rather than a name, and
// standing a channel name in its $1 understated it by 90px.
check("a $1 the call fills with another message is measured as that message",
  run({ MESSAGES: { ...MESSAGES,
    "toast.inputKept": { ...MESSAGES["toast.inputKept"], en: "W".repeat(40) } } }).bad > 0);

// Reporting the unknown character and then handing the notice the button's
// space as well is the one outcome worse than either on its own.
check("a button label the table cannot measure fails instead of passing",
  run({ MESSAGES: { ...MESSAGES,
    "action.undo": { ...MESSAGES["action.undo"], en: "↶ Undo" } } }).bad > 0);

/* ---------- and what it used to let past ---------- */

// Found by review. The map kept one call per key, so the same sentence shown
// from two places was measured once — and `toast.saveFailedKept` is shown
// from two, one of them handed a whole sentence for its $1.
check("a key shown from two places is measured at both of them",
  run({ read: (f) => (f === "content.js"
    ? panel('showToast(t("toast.saveFailedKept", t("toast.noInput")));' +
            ' showToast(t("toast.saveFailedKept", t("toast.inputKept")));')
    : read(f)),
    // Wide enough that the sentence built around it runs over, narrow enough
    // that it fits the bar on its own — so the only thing that can fail here
    // is the second call being measured at all.
    MESSAGES: { ...MESSAGES,
      "toast.inputKept": { ...MESSAGES["toast.inputKept"], en: "W".repeat(16) } } }).bad > 0);

// Reading the branch written out in full and calling the expression
// understood: `other` can be the wider of the two and was never looked at.
check("a name on the other side of a choice is read as well as the t() beside it",
  run({ read: (f) => (f === "content.js"
    ? panel('const other = t("toast.inputKept"); showToast(ok ? t("toast.deleted") : other);')
    : read(f)),
    MESSAGES: { ...MESSAGES,
      "toast.inputKept": { ...MESSAGES["toast.inputKept"], en: "W".repeat(40) } } }).bad > 0);

// The hop is one hop and it is by name, so it has to be able to say no. An
// unrelated const of the same name in another function is not what this
// parameter holds, and answering with it reports a sentence never seen as
// measured and fitting.
check("a name nothing here gives a value is a failure, not someone else's const",
  run({ read: (f) => (f === "content.js"
    ? '\n  const MOST_SHOWN = 99;\n  function g() { const saved = t("toast.deleted"); return saved; }' +
      '\n  function f(saved) { showToast(saved); }'
    : read(f)) }).bad > 0);

// …while the two shapes that do say what a name holds still do.
check("but a const in the same function still answers",
  run({ read: (f) => (f === "content.js"
    ? panel('const saved = t("toast.deleted"); showToast(saved);')
    : read(f)) }).bad === 0);
check("and so does a property handed in under that name",
  run({ read: (f) => (f === "content.js"
    ? '\n  const MOST_SHOWN = 99;\n  function g() { h({ kept: t("toast.inputKept") }); }' +
      '\n  function f({ kept }) { showToast(t("toast.saveFailedKept", kept)); }'
    : read(f)),
    MESSAGES: { ...MESSAGES,
      "toast.inputKept": { ...MESSAGES["toast.inputKept"], en: "W".repeat(16) } } }).bad > 0);

// `width(text) ?? 0` let an unmeasurable alternative weigh nothing: it lost
// the pick to whichever of its siblings the table did know, and the unknown
// character went unreported. Any of them can be the one that shows.
check("an alternative the table cannot measure fails rather than losing the pick",
  run({ read: (f) => (f === "content.js"
    ? panel('const kept = ok ? t("toast.noInput") : t("toast.inputKept");' +
            ' showToast(t("toast.saveFailedKept", kept));')
    : read(f)),
    MESSAGES: { ...MESSAGES,
      "toast.inputKept": { ...MESSAGES["toast.inputKept"], en: "↶ kept" } } }).bad > 0);

/* ---------- and what a second review found it still let past ---------- */

// All four were the same shape: it found one thing it could read and called
// the expression understood. The reader asks a different question now — have
// I accounted for everything this can produce — and answers null when it has
// not. `other`, `saved` and the rest below all hold the 40-W translation.
const wide = { ...MESSAGES,
  "toast.inputKept": { ...MESSAGES["toast.inputKept"], en: "W".repeat(40) } };
const reading = (body) => run({ MESSAGES: wide,
  read: (f) => (f === "content.js" ? `\n  const MOST_SHOWN = 99;\n${body}` : read(f)) }).bad > 0;

check("a branch it cannot read is not excused by the branch beside it",
  reading('  function f(other) { showToast(ok ? t("toast.deleted") : other); }'));

check("a const in one function does not answer a parameter in another",
  reading('  function g() { const saved = t("toast.deleted"); }\n' +
          '  const f = saved => { showToast(saved); };'));

check("and a parameter shadowing a const of the same name answers for itself",
  reading('  const saved = t("toast.deleted");\n  function f(saved) { showToast(saved); }'));

check("an unrelated property is not what a parameter holds",
  reading('  const unrelated = { saved: t("toast.deleted") };\n' +
          '  function f(saved) { showToast(saved); }'));

const narrow = (body) => run({
  read: (f) => (f === "content.js" ? `\n  const MOST_SHOWN = 99;\n${body}` : read(f)) }).bad > 0;

// Everything here fits, so the only thing that can make it red is the reader
// saying it could not account for the expression.
check("and a name wrapped in a template is not a name it has read",
  narrow('  function f() { const other = t("toast.deleted");' +
         ' showToast(ok ? t("toast.deleted") : `${other}`); }'));

check("and a name bound in two places is not read from either",
  narrow('  function g() { const other = t("toast.deleted"); }\n' +
         '  function h() { const other = t("toast.deleted"); }\n' +
         '  function f() { showToast(other); }'));

// …while the one shape it does read still reads: a const nothing else in the
// file can be, written out of t() calls and nothing else.
check("a const of t() calls, bound once and never a parameter, still answers",
  run({ read: (f) => (f === "content.js"
    ? '\n  const MOST_SHOWN = 99;\n  function f() {' +
      ' const saved = ok ? t("saved.pool") : t("saved.global"); showToast(saved); }'
    : read(f)) }).bad === 0);
check("and both of its branches are measured, not just the first",
  [...noticeKeys('\n  function f() {' +
     ' const saved = ok ? t("saved.pool") : t("saved.global"); showToast(saved); }').keys()]
    .sort().join() === "saved.global,saved.pool");

// A `$1` is a different question from the message itself. A name may be
// holding a sentence, so one that cannot be read is a failure; a property or
// a count is a value, and a value is what the stand-in was always for.
check("a $1 handed a name it cannot read is a failure",
  reading('  function f(kept) { showToast(t("toast.saveFailedKept", kept)); }'));
check("and a name destructured out of a parameter list is a parameter too",
  narrow('  const kept = t("toast.deleted");\n' +
         '  function f({ kept }) { showToast(t("toast.saveFailedKept", kept)); }'));
check("but a $1 handed something that was never a message takes the stand-in",
  run({ read: (f) => (f === "content.js"
    ? '\n  const MOST_SHOWN = 99;\n  function f(preset) {' +
      ' showToast(t("preset.loadedReused", preset.name, preset.cards.length)); }'
    : read(f)) }).bad === 0);

// A bar with no toasts in it is not a bar that fits; it is a file this
// checker failed to read, which looked exactly like success before.
check("a content.js it cannot read fails loudly",
  run({ read: (f) => (f === "content.js" ? "// nothing here" : read(f)) }).bad > 0);

/* ---------- what it refuses ---------- */

const long = "This is a members-only emoji. Become a member and you can use it";
check("a notice that runs past the end of the bar is caught",
  run({ MESSAGES: { ...MESSAGES, "toast.deleted": { ...MESSAGES["toast.deleted"], en: long } } })
    .bad > 0);

// 193px fits on its own and does not fit beside an Undo button; a single
// budget for both would let this one through.
const tight = "Saved it, and the one in your pool too";
const withButton = run({
  MESSAGES: { ...MESSAGES, "toast.ejected": { ...MESSAGES["toast.ejected"], en: tight } }
});
const withoutButton = run({
  MESSAGES: { ...MESSAGES, "dup.inDeck": { ...MESSAGES["dup.inDeck"], en: tight } }
});
check("the button a notice carries takes its width off the room",
  withButton.bad > 0 && withoutButton.bad === 0);

// The number is filled in before measuring, because `$1 cards` is not what
// the bar is asked to draw.
const filled = run({
  MESSAGES: { ...MESSAGES, "dup.inDeck": { ...MESSAGES["dup.inDeck"], en: "$1 $1 $1 $1 $1 $1" } }
});
check("a $1 is measured as what stands in it, not as two characters",
  filled.bad > 0);

process.exit(fail);
