// Is anything still only saying it one way? Include the validators: their
// errors reach the UI through translated import/export status wrappers.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(root + file, "utf8");

const JAPANESE = /[぀-ヿ一-鿿]/;
const VALIDATORS = ["src/backup.js", "src/presets.js"];
const CODE = ["content.js", "options.js", ...VALIDATORS];

// Also callable with source fixtures, so the tests can prove that a new
// untranslated validator error or a misspelled message key fails this check.
export function checkI18n({ MESSAGES, LANGUAGES, SOURCE, read, report = console.log }) {
  let bad = 0;
  const fail = (message) => { bad += 1; report(`FAIL ${message}`); };

  /* ---------- every key says it in every language ---------- */

  for (const [key, entry] of Object.entries(MESSAGES)) {
    for (const { code } of LANGUAGES) {
      if (!entry[code]) fail(`${key} — ${code} がありません`);
    }
    const slots = (text) => (text.match(/\$\d/g) || []).sort().join("");
    for (const { code } of LANGUAGES) {
      if (entry[code] && slots(entry[code]) !== slots(entry[SOURCE])) {
        fail(`${key} — ${code} の $1,$2… が ${SOURCE} と合いません`);
      }
      // `$1{card|cards}` picks the word that goes with the number. Anywhere
      // else a brace is just text, and t() prints it as written — which is how
      // a misplaced one reaches the panel instead of failing here.
      for (const m of (entry[code] || "").matchAll(/\{[^{}]*\}/g)) {
        const before = entry[code].slice(Math.max(0, m.index - 2), m.index);
        if (!/^\$\d$/.test(before)) {
          fail(`${key} — ${code} の ${m[0]} が $1,$2… の直後にありません`);
        } else if ((m[0].match(/\|/g) || []).length !== 1) {
          fail(`${key} — ${code} の ${m[0]} は「一つのとき|それ以外」の二つに分けてください`);
        }
      }
      // A brace with no partner. The rule above only ever sees closed pairs,
      // so `$1{card|cards` walked past it and t(), which prints what it does
      // not recognise, put the brace on the panel.
      if (/[{}]/.test((entry[code] || "").replace(/\{[^{}]*\}/g, ""))) {
        fail(`${key} — ${code} に相手のいない { か } があります`);
      }
    }
  }

  /* ---------- nothing asks for a key that is not there ---------- */

  const used = new Set();
  const html = read("options.html");
  const ask = (file, key) => {
    used.add(key);
    if (!Object.hasOwn(MESSAGES, key)) fail(`${file} — 知らない key: ${key}`);
  };

  for (const file of CODE) {
    const source = strip(read(file));
    for (const [, key] of source.matchAll(/\bt\(\s*["']([\w.]+)["']/g)) {
      ask(file, key);
    }
    if (VALIDATORS.includes(file)) {
      // The tuple stays language-neutral until i18n.t fills a wrapper with it.
      for (const [, key] of source.matchAll(/\breturn\s+\[\s*["']([\w.]+)["']/g)) {
        ask(file, key);
        if (!key.startsWith("validation.")) fail(`${file} — validator error key must start with validation.: ${key}`);
      }
      // Catch English strings too: changing the hardcoded language does not
      // make a validator error localisable.
      if (/\breturn\s*["'`]/.test(source)) {
        fail(`${file} — validator errors must return [message key, ...arguments], not text`);
      }
    }
  }
  for (const [, key] of html.matchAll(/data-i18n(?:-[\w-]+)?="([\w.]+)"/g)) {
    ask("options.html", key);
  }

  /* ---------- nothing translated once, at load ---------- */

  // Anything inside a function is asked for when it runs, after applyLanguage.
  for (const file of CODE) {
    for (const line of read(file).split("\n")) {
      if (/^(const|let|var)\s+\w+\s*=/.test(line) && /\bt\(\s*"/.test(line)) {
        fail(`${file} — 読み込み時に訳している: ${line.trim().slice(0, 60)}`);
      }
    }
  }

  /* ---------- and nothing is left saying it in Japanese ---------- */

  let left = 0;
  for (const file of CODE) {
    const lines = strip(read(file)).split("\n");
    lines.forEach((line, index) => {
      for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
        const text = m[1] ?? m[2] ?? m[3] ?? "";
        if (!JAPANESE.test(text)) continue;
        left += 1;
        report(`     ${file}:${index + 1}  ${text.slice(0, 60)}`);
      }
    });
  }

  // Keyed elements may keep the Japanese fallback shown before script runs.
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, "")
    .replace(/<([\w-]+)[^>]*\sdata-i18n="[\w.]+"[^>]*>[^<]*/g, "<$1>");

  for (const [, text] of body.matchAll(/>([^<>]+)</g)) {
    if (!JAPANESE.test(text)) continue;
    left += 1;
    report(`     options.html  ${text.trim().slice(0, 60)}`);
  }
  if (left) fail(`まだ ${left} か所が直接書かれています（上）`);

  /* ---------- keys nobody asks for ---------- */

  const dead = Object.keys(MESSAGES).filter((key) => !used.has(key));
  if (dead.length) fail(`使われていない key が ${dead.length} 個: ${dead.slice(0, 8).join(", ")}${dead.length > 8 ? " …" : ""}`);

  if (!bad) report(`ok   ${Object.keys(MESSAGES).length}個の key、${LANGUAGES.length}言語、書き残しなし`);
  return bad;
}

// Comments are for whoever reads the code, not for whoever uses it.
function strip(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  globalThis.OshiDeck = {};
  await import(new URL("../src/i18n.js", import.meta.url));
  process.exitCode = checkI18n({ ...globalThis.OshiDeck.i18n, read });
}
