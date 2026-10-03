// Drops an exported preset into presets/presets.json.
//
//   node tools/add-preset.mjs ~/Downloads/oshideck-preset-さくら.json
//   node tools/add-preset.mjs ~/Downloads/oshideck-preset-さくら.json --channel UC…
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

const [, , path, ...rest] = argv;
const flag = rest.indexOf("--channel");
const channel = flag >= 0 ? rest[flag + 1] : null;
const spare = rest.filter((_, at) => at !== flag && at !== flag + 1);

if (!path || spare.length || (flag >= 0 && !channel)) {
  console.log("usage: node tools/add-preset.mjs <exported preset.json> [--channel UC…]");
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
