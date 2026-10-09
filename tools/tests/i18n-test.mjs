// The words, and which one comes out.
//
// The table itself is checked by tools/check-i18n.mjs — that every key says it
// in every language, that nothing asks for a key that is not there, and that
// nothing is still written into the code. What is left for here is the part
// with decisions in it: which language answers, and what happens when the one
// asked for has nothing to say.
const src = process.env.OD_I18N
  ?? new URL("../../src/i18n.js", import.meta.url).pathname;

// A browser whose own language is not the source one. Without this the guess
// and the fallback are the same string, and a table that ignored the browser
// entirely would look exactly like one that asked it.
globalThis.chrome = { i18n: { getUILanguage: () => "zh-TW" } };
globalThis.OshiDeck = {};
await import(`file://${src}`);
const { i18n } = globalThis.OshiDeck;

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

/* ---------- which language answers ---------- */

check("asked for Japanese, Japanese", i18n.use("ja") === "ja");
check("asked for Traditional Chinese, that", i18n.use("zh-TW") === "zh-TW");

// Nobody has written Simplified, and Traditional is far closer to it than
// Japanese is. A reader of one can read the other; a reader of neither is no
// worse off than before.
check("a nearby Chinese falls to the Chinese there is", i18n.use("zh-CN") === "zh-TW");
check("and zh on its own does too", i18n.use("zh") === "zh-TW");

// A language nobody has written falls to the source, which is a language.
check("English falls back to the source", i18n.use("en-US") === "ja");
check("and so does something nobody has heard of", i18n.use("xx") === "ja");

/* ---------- what comes out ---------- */

i18n.use("ja");
check("Japanese is the Japanese", i18n.t("bar.global") === "共通");
i18n.use("zh-TW");
check("Chinese is the Chinese", i18n.t("bar.global") === "通用");

check("what goes in the hole comes out of it",
  i18n.t("count.cards", 7).includes("7"));
check("and the second hole is the second argument",
  i18n.t("preset.loadedReused", "さくら", 3).includes("さくら") &&
  i18n.t("preset.loadedReused", "さくら", 3).includes("3"));

// A hole with nothing for it should leave a gap, not the word "undefined" —
// and it has to be a message with *more* holes than arguments, since a call
// with no arguments at all never reaches the filling.
check("a hole nobody filled is empty, not 'undefined'",
  !i18n.t("preset.loadedReused", "さくら").includes("undefined"));

/* ---------- when it has nothing to say ---------- */

// A key nobody wrote is a bug in the code, and showing the key is how it gets
// noticed. Showing nothing would hide it; showing the source language would
// hide it too.
check("a key that does not exist says so", i18n.t("no.such.key") === "no.such.key");

// A missing *translation* is not a bug in the same way — the Japanese is still
// a sentence, and a sentence in the wrong language beats `bar.global`.
const { MESSAGES, SOURCE } = i18n;
const borrowed = { ...MESSAGES["bar.global"] };
delete MESSAGES["bar.global"]["zh-TW"];
i18n.use("zh-TW");
check("a missing translation falls through to the source, not to the key",
  i18n.t("bar.global") === borrowed[SOURCE]);
Object.assign(MESSAGES["bar.global"], borrowed);

/* ---------- and what the setting means ---------- */

// "" is not a language: it means nobody chose, and the browser's own is the
// opening guess. Reading it as a language would pin everyone to the source —
// and the browser here is in Chinese, so the two answers differ.
i18n.use("ja");
check("an empty setting goes back to guessing, not to the last choice",
  i18n.use("") === "zh-TW");
check("which is what the browser is in", i18n.current() === "zh-TW");

process.exit(fail);
