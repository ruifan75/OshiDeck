// The bar is 400px and the notice row does not wrap. These are the rules
// tools/check-width.mjs is there to keep, and each one is broken here to see
// it go red — a checker that cannot fail is decoration.
import { readFileSync } from "node:fs";

// Loaded by path so the mutation runner can hand over a broken copy.
const { checkWidth, noticeKeys, width } = await import(
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

/* ---------- what it reads ---------- */

check("every English notice fits the bar as it stands", run().bad === 0);

const toast = (body) => `function f() { showToast(${body}); }`;

check("the keys come from the calls, so a new toast is measured too",
  [...noticeKeys(toast('t("toast.deleted")')).keys()].join() === "toast.deleted");

check("both sides of a choice are read, not just the first",
  [...noticeKeys(toast('a ? t("dup.inDeck") : t("dup.inPool")')).keys()].sort().join() ===
    "dup.inDeck,dup.inPool");

check("the button's own label is not measured as the message",
  [...noticeKeys(toast('t("toast.ejected"), { actionLabel: t("action.undo") }')).keys()].join() ===
    "toast.ejected");

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
