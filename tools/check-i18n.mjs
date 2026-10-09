// Is anything still only saying it one way?
//
// Translating by hand across three files is the kind of job that is 95% done
// for a long time: a toast in a branch nobody took, an aria-label, a string
// built in two halves. So the finding is automated — every literal with
// Japanese in it that is still sitting in the code is reported, along with
// keys that nothing uses and keys that exist in one language only.
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (file) => readFileSync(root + file, "utf8");

globalThis.OshiDeck = {};
await import(`file://${root}src/i18n.js`);
const { MESSAGES, LANGUAGES, SOURCE } = globalThis.OshiDeck.i18n;

const JAPANESE = /[぀-ヿ一-鿿]/;
const CODE = ["content.js", "options.js"];

let bad = 0;
const fail = (message) => { bad += 1; console.log(`FAIL ${message}`); };

/* ---------- every key says it in every language ---------- */

for (const [key, entry] of Object.entries(MESSAGES)) {
  for (const { code } of LANGUAGES) {
    if (!entry[code]) fail(`${key} — ${code} がありません`);
  }
  // A placeholder that exists in one language and not another is a sentence
  // with a hole in it.
  const slots = (text) => (text.match(/\$\d/g) || []).sort().join("");
  for (const { code } of LANGUAGES) {
    if (entry[code] && slots(entry[code]) !== slots(entry[SOURCE])) {
      fail(`${key} — ${code} の $1,$2… が ${SOURCE} と合いません`);
    }
  }
}

/* ---------- nothing asks for a key that is not there ---------- */

const used = new Set();
const html = read("options.html");

for (const file of CODE) {
  const source = read(file);
  for (const [, key] of source.matchAll(/\bt\(\s*"([\w.]+)"/g)) {
    used.add(key);
    if (!MESSAGES[key]) fail(`${file} — 知らない key: ${key}`);
  }
}
for (const [, key] of html.matchAll(/data-i18n(?:-[\w-]+)?="([\w.]+)"/g)) {
  used.add(key);
  if (!MESSAGES[key]) fail(`options.html — 知らない key: ${key}`);
}

/* ---------- nothing translated once, at load ---------- */

// A translated string cannot be a constant on a page that can change
// language. Three tables of them were built at module load — before the
// stored language is applied — so a browser in one language and a page set to
// another showed the page's language everywhere except there, and switching
// language left them behind for good.
//
// Module level is the test: anything inside a function is asked for when it
// runs, which is after applyLanguage.
for (const file of CODE) {
  for (const line of read(file).split("\n")) {
    if (/^(const|let|var)\s+\w+\s*=/.test(line) && /\bt\(\s*"/.test(line)) {
      fail(`${file} — 読み込み時に訳している: ${line.trim().slice(0, 60)}`);
    }
  }
}

/* ---------- and nothing is left saying it in Japanese ---------- */

// Comments are the one place Japanese stays: they are for whoever reads the
// code, not for whoever uses it.
function strip(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

let left = 0;
for (const file of CODE) {
  const source = strip(read(file));
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
      const text = m[1] ?? m[2] ?? m[3] ?? "";
      if (!JAPANESE.test(text)) continue;
      left += 1;
      console.log(`     ${file}:${index + 1}  ${text.slice(0, 60)}`);
    }
  });
}

// The page itself: text sitting between tags rather than behind a key.
// An element that names a key may keep its Japanese inside: that text is the
// fallback shown before the script runs, which is better than a blank page.
const body = html
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<(script|style)[\s\S]*?<\/\1>/g, "")
  .replace(/<([\w-]+)[^>]*\sdata-i18n="[\w.]+"[^>]*>[^<]*/g, "<$1>");

for (const [, text] of body.matchAll(/>([^<>]+)</g)) {
  if (!JAPANESE.test(text)) continue;
  left += 1;
  console.log(`     options.html  ${text.trim().slice(0, 60)}`);
}

if (left) fail(`まだ ${left} か所が直接書かれています（上）`);

/* ---------- keys nobody asks for ---------- */

const dead = Object.keys(MESSAGES).filter((key) => !used.has(key));
if (dead.length) fail(`使われていない key が ${dead.length} 個: ${dead.slice(0, 8).join(", ")}${dead.length > 8 ? " …" : ""}`);

if (!bad) console.log(`ok   ${Object.keys(MESSAGES).length}個の key、${LANGUAGES.length}言語、書き残しなし`);
process.exit(bad ? 1 : 0);
