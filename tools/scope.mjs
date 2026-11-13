// Turn mined candidates into a channel's starting deck.
//
//   node tools/scope.mjs --all --dir <candidates> --out <presets>
//   node tools/scope.mjs UC… --take 10 --name 稀羽すう
//
// A mined phrase is a suggestion for this room. Finding it in other rooms
// does not ask the user whether they want it in every pool. Every generated
// card is therefore channel-only and keeps this room's own wording. Loading
// reuses an existing universal copy when the full contents already match.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { argv, exit } from "node:process";
import { resolve } from "node:path";

const root = new URL("..", import.meta.url).pathname;
globalThis.OshiDeck = {};
globalThis.document = { querySelector: () => null };
globalThis.chrome = { runtime: { id: "x" }, storage: { local: { get: async () => ({}), set: async () => {} } } };
await import(`${root}src/tokens.js`);
await import(`${root}src/backup.js`);
await import(`${root}src/store.js`);
await import(`${root}src/trending.js`);
const { trending } = globalThis.OshiDeck;

const args = argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
};
const channel = args.find((a) => /^UC[A-Za-z0-9_-]{22}$/.test(a));
const every = args.includes("--all");
const take = Number(flag("--take", 10));
const name = flag("--name", null);
const dir = resolve(flag("--dir", `${root}tools/candidates`));
const outputDir = resolve(flag("--out", dir));
const channelsFile = resolve(flag("--channels", `${root}tools/channels.json`));

if ((!channel && !every) || !Number.isInteger(take) || take < 1) {
  console.log("usage: node tools/scope.mjs <UC…> [--take N] [--name 名前]");
  console.log("       node tools/scope.mjs --all [--dir candidates] [--out presets] [--channels channels.json]");
  exit(1);
}
if (channel && !existsSync(`${dir}/${channel}.json`)) {
  console.log(`FAIL ${channel} の候補がありません。先に tools/mine.sh を回してください`);
  exit(1);
}

let named = new Map();
try {
  named = new Map(JSON.parse(readFileSync(channelsFile, "utf8"))
    .map((c) => [c.id, c.japanese || c.name]));
} catch (_) { /* a caller can supply --name when the list is unavailable */ }

function startingDeck(mine) {
  // Ten is a fill target. The miner has already selected every qualifying
  // karaoke card; never apply the legacy top-ten cut to that chosen hand.
  const selected = Array.isArray(mine.selected) ? new Set(mine.selected) : null;
  const cards = selected
    ? mine.candidates.filter((c) => selected.has(trending.signature(c.tokens)))
    : mine.candidates.slice(0, take);
  if (selected && cards.length !== selected.size) throw new Error("A selected signature is missing or duplicated");
  return {
    format: 2,
    name: name || named.get(mine.channel) || mine.channel,
    note: mine.sources
      ? `歌枠${mine.sources.filter((s) => s.kind === "singing").length}配信・` +
        `通常${mine.sources.filter((s) => s.kind === "ordinary").length}配信のチャットから${cards.length}枚`
      : `過去${mine.streams}配信のチャットから、常連が多い順に${cards.length}枚`,
    channel: mine.channel,
    cards: cards.map((c) => ({
      tokens: c.tokens.map((t) => t.type === "text"
        ? { type: "text", value: t.value }
        : {
            type: "youtubeEmoji", emojiId: t.emojiId,
            ...(t.alt ? { alt: t.alt } : {}),
            ...(t.sharedTooltipText ? { sharedTooltipText: t.sharedTooltipText } : {}),
            ...(t.src ? { src: t.src } : {})
          }),
      scope: "channel"
    }))
  };
}

const files = every
  ? readdirSync(dir).filter((f) => /^UC[A-Za-z0-9_-]{22}\.json$/.test(f))
  : [`${channel}.json`];
let made = 0, empty = 0;
mkdirSync(outputDir, { recursive: true });
for (const file of files) {
  const mine = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
  const preset = startingDeck(mine);
  if (!preset.cards.length) { empty++; continue; }
  const out = `${outputDir}/${mine.channel}.preset.json`;
  writeFileSync(out, `${JSON.stringify(preset, null, 2)}\n`);
  made++;
  if (!every) console.log(out.replace(root, ""));
}
console.log(`${files.length}チャンネル → ${made}組（候補なし ${empty}、すべてチャンネル専用）`);
