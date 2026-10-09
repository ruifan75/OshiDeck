// Drops an exported preset into presets/presets.json.
//
//   node tools/add-preset.mjs ~/Downloads/oshideck-preset-さくら.json
//   node tools/add-preset.mjs ~/Downloads/oshideck-preset-さくら.json --channel UC…
//   node tools/add-preset.mjs tools/candidates/*.preset.json
//
// Making a preset is meant to be the same gesture as using one: build a deck
// you like, write it out from the options page, run this, commit. The file is
// validated by the extension's own reader first — a preset that would be
// skipped at load time should not reach the repository at all.
//
// A bundled preset names a channel, always. What someone wants to open a
// stream with belongs to that streamer — the in-jokes, the call-and-response,
// the stamps — and a generic set of greetings is something anyone types once
// and never thinks about again. Exporting names the channel by itself when
// the deck carries that channel's member emoji; a deck of plain text has
// nothing to give it away, so `--channel` says it.
import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";

const root = new URL("..", import.meta.url).pathname;
const bundle = `${root}presets/presets.json`;

const args = argv.slice(2);
const flag = args.indexOf("--channel");
const channel = flag >= 0 ? args[flag + 1] : null;
// `indexOf` answers -1 when the flag is absent, and `at !== flag + 1` is then
// `at !== 0` — which quietly dropped the first filename of every call that
// did not use the flag, including the one the README gives.
const paths = args.filter((a, at) =>
  !a.startsWith("--") && (flag < 0 || (at !== flag && at !== flag + 1)));

if (!paths.length || (flag >= 0 && !channel)) {
  console.log("usage: node tools/add-preset.mjs <preset.json …> [--channel UC…]");
  exit(1);
}
// `--channel` renames the one file it is given. Several files already carry
// their own channel, and one flag cannot answer for all of them.
if (channel && paths.length > 1) {
  console.log("FAIL --channel は1つのファイルにしか使えません");
  exit(1);
}

globalThis.OshiDeck = {};
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => ({}), set: async () => {}
} } };
await import(`${root}src/tokens.js`);
await import(`${root}src/backup.js`);
await import(`${root}src/store.js`);
await import(`${root}src/presets.js`);
// The validators answer with [key, ...args] now, for the pages to translate
// where they show it. Without this the reason printed here was the key and
// its arguments joined by a comma.
await import(`${root}src/i18n.js`);
const { presets, i18n } = globalThis.OshiDeck;
const why = (problem) => (Array.isArray(problem) ? i18n.t(...problem) : String(problem));

const die = (message) => { console.log(`FAIL ${message}`); exit(1); };

let list;
try {
  list = JSON.parse(readFileSync(bundle, "utf8"));
} catch (error) {
  die(`presets/presets.json を読めません: ${error.message}`);
}
if (!Array.isArray(list)) die("presets/presets.json が配列ではありません");

let added = 0;
let replaced = 0;

for (const path of paths) {
  let incoming;
  try {
    incoming = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(`${path} を読めません: ${error.message}`);
  }

  const problem = presets.validate(incoming);
  if (problem) die(`${path} は使えません: ${why(problem)}`);

  // Said on the command line, when the deck had no member emoji to say it.
  if (channel) {
    if (incoming.channel && incoming.channel !== channel) {
      die(`${path} は ${incoming.channel} 専用です。--channel ${channel} とは違います`);
    }
    incoming.channel = channel;
  }

  // A preset belongs to a channel: one naming none would be offered to every
  // empty deck, which is a promise it cannot keep.
  if (!incoming.channel) {
    die(`${path} はどのチャンネルのものか分かりません。` +
      "--channel UC… を付けるか、そのチャンネルのメン限スタンプを入れて書き出してください。");
  }

  const problemAgain = presets.validate(incoming);
  if (problemAgain) die(`${path} は使えません: ${problemAgain}`);

  // The channel, not the name. Two presets for one channel would both be
  // offered to the same empty deck, which is the collision that matters;
  // two channels sharing a display name are never offered together, and
  // among hundreds of VTubers that is going to happen.
  const at = list.findIndex((preset) => preset.channel === incoming.channel);
  if (at >= 0) {
    list[at] = incoming;
    replaced += 1;
  } else {
    list.push(incoming);
    added += 1;
  }
}

console.log(`追加 ${added}組、差し替え ${replaced}組`);

// One line per card. JSON.stringify with an indent puts every token on its
// own line, which turns a ten-card preset into a hundred lines and makes the
// diff of adding one card unreadable.
const shaped = (preset) => [
  "  {",
  `    "format": ${preset.format || 1},`,
  `    "name": ${JSON.stringify(preset.name)},`,
  `    "note": ${JSON.stringify(preset.note || "")},`,
  ...(preset.channel ? [`    "channel": ${JSON.stringify(preset.channel)},`] : []),
  '    "cards": [',
  preset.cards
    .map((card) => `      { "tokens": ${JSON.stringify(card.tokens)}, "scope": ${JSON.stringify(card.scope)} }`)
    .join(",\n"),
  "    ]",
  "  }"
].join("\n");

writeFileSync(bundle, `[\n${list.map(shaped).join(",\n")}\n]\n`);
console.log(`presets/presets.json — ${list.length}組`);
