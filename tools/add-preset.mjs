// Drops an exported preset into presets/presets.json.
//
//   node tools/add-preset.mjs ~/Downloads/oshideck-preset-さくら.json
//
// Making a preset is meant to be the same gesture as using one: build a deck
// you like, write it out from the options page, run this, commit. The file is
// validated by the extension's own reader first — a preset that would be
// skipped at load time should not reach the repository at all.
import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";

const root = new URL("..", import.meta.url).pathname;
const bundle = `${root}presets/presets.json`;

const [, , path, ...rest] = argv;
if (!path || rest.length) {
  console.log("usage: node tools/add-preset.mjs <exported preset.json>");
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
const { presets } = globalThis.OshiDeck;

const die = (message) => { console.log(`FAIL ${message}`); exit(1); };

let incoming;
try {
  incoming = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  die(`${path} を読めません: ${error.message}`);
}

const problem = presets.validate(incoming);
if (problem) die(`${path} は使えません: ${problem}`);

let list;
try {
  list = JSON.parse(readFileSync(bundle, "utf8"));
} catch (error) {
  die(`presets/presets.json を読めません: ${error.message}`);
}
if (!Array.isArray(list)) die("presets/presets.json が配列ではありません");

// Names are how a preset is offered, so two of them cannot share one.
const at = list.findIndex((preset) => preset.name === incoming.name);
if (at >= 0) {
  list[at] = incoming;
  console.log(`「${incoming.name}」を差し替えました（${incoming.cards.length}枚）`);
} else {
  list.push(incoming);
  console.log(`「${incoming.name}」を追加しました（${incoming.cards.length}枚）`);
}
if (incoming.channel) {
  console.log(`  ${incoming.channel} 専用 ── その配信でだけ出ます`);
}

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
