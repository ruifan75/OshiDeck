// Which of a channel's phrases belong to it, and which belong to everybody.
//
//   node tools/scope.mjs UCeqIMtLuGc3YgwkhEaG8oDg
//   node tools/scope.mjs UCeqIMtLuGc3YgwkhEaG8oDg --take 10 --name 稀羽すう
//
// Reads every tools/candidates/*.json — one per channel, from mine-chat —
// and asks of each phrase: how many other channels say it too?
//
// "Not a member emoji" is not the same as "universal", which is where this
// started. 🦢✨ is 稀羽すう's own sign — her name is 羽, a wing — and nothing
// in the characters themselves says so: they are ordinary emoji that anyone
// can type anywhere. Sending them at somebody else is simply wrong, and the
// only thing that can tell is whether anybody else's room says them.
//
// So: said in other rooms → `global`, and it travels to every pool. Said only
// here → `channel`, and it stays. Member emoji are settled before any of this
// by the store, which forces them to the channel that issues them.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { argv, exit } from "node:process";

const root = new URL("..", import.meta.url).pathname;
const dir = `${root}tools/candidates`;

globalThis.OshiDeck = {};
globalThis.document = { querySelector: () => null };
globalThis.chrome = { runtime: { id: "x" }, storage: { local: { get: async () => ({}), set: async () => {} } } };
await import(`${root}src/tokens.js`);
await import(`${root}src/backup.js`);
await import(`${root}src/store.js`);
await import(`${root}src/trending.js`);
const { tokens, trending } = globalThis.OshiDeck;

const args = argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
};
const channel = args.find((a) => /^UC[A-Za-z0-9_-]{22}$/.test(a));
const take = Number(flag("--take", 10));
const name = flag("--name", null);

if (!channel) {
  console.log("usage: node tools/scope.mjs <UC…> [--take N] [--name 名前]");
  exit(1);
}
if (!existsSync(`${dir}/${channel}.json`)) {
  console.log(`FAIL ${channel} の候補がありません。先に tools/mine.sh を回してください`);
  exit(1);
}

/* ---------- everyone else's rooms ---------- */

const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const elsewhere = new Map();   // signature -> how many other channels say it
let rooms = 0;

for (const file of files) {
  const other = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
  if (other.channel === channel) continue;
  rooms += 1;

  // Signatures, so `888` and `88888888` are the same thing said twice and
  // `おつ` is not `おつかれ`. The same collapse the hand's own sort uses.
  const said = new Set(other.candidates.map((c) => trending.signature(c.tokens)));
  for (const sig of said) elsewhere.set(sig, (elsewhere.get(sig) || 0) + 1);
}

if (!rooms) {
  console.log("FAIL 比べる相手がいません。ほかのチャンネルも tools/mine.sh で掘ってください");
  exit(1);
}

/* ---------- and this one ---------- */

const mine = JSON.parse(readFileSync(`${dir}/${channel}.json`, "utf8"));

const label = (list) =>
  list.map((t) => (t.type === "text" ? t.value : t.sharedTooltipText || `[${t.alt}]`)).join("");

const judged = mine.candidates.slice(0, take).map((c) => {
  const others = elsewhere.get(trending.signature(c.tokens)) || 0;
  // Member emoji have no say in this: they can be sent in one place, and the
  // store forces their scope regardless of what a preset claims.
  const member = tokens.requiredChannels(c.tokens).length > 0;
  return { ...c, others, member, scope: member || !others ? "channel" : "global" };
});

console.log(`${rooms}チャンネルと比べました\n`);
console.log("よそ  常連  種別   scope    内容");
for (const c of judged) {
  console.log(
    `${String(c.others).padStart(3)}/${rooms}  ${String(c.regulars).padStart(4)}  ` +
    `${c.member ? "メン限" : "　　  "}  ${c.scope.padEnd(8)} ${label(c.tokens).slice(0, 38)}`
  );
}

/* ---------- as a preset ---------- */

const preset = {
  format: 2,
  name: name || channel,
  note: `過去${mine.streams}配信のチャットから、常連が多い順に${judged.length}枚`,
  channel,
  cards: judged.map((c) => ({
    tokens: c.tokens.map((t) =>
      t.type === "text"
        ? { type: "text", value: t.value }
        : {
            type: "youtubeEmoji",
            emojiId: t.emojiId,
            ...(t.alt ? { alt: t.alt } : {}),
            ...(t.sharedTooltipText ? { sharedTooltipText: t.sharedTooltipText } : {})
          }),
    scope: c.scope
  }))
};

const out = `${dir}/${channel}.preset.json`;
writeFileSync(out, `${JSON.stringify(preset, null, 2)}\n`);
console.log(`\n${out.replace(root, "")}`);
console.log(`  node tools/add-preset.mjs ${out.replace(root, "")}`);
