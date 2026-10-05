// Which of a channel's phrases belong to it, and which belong to everybody.
//
//   node tools/scope.mjs UCeqIMtLuGc3YgwkhEaG8oDg
//   node tools/scope.mjs UCeqIMtLuGc3YgwkhEaG8oDg --take 10 --name 稀羽すう
//   node tools/scope.mjs --all                    # every channel, one pass
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
// So: *near the top* in other rooms → `global`, and it travels to every pool.
// Only here → `channel`, and it stays. Member emoji are settled before any of
// this by the store, which forces them to the channel that issues them.
//
// Near the top, rather than merely present. A candidate list runs to several
// hundred, and being somewhere in one only means a few people said it once.
// `ただいま` is 稀羽すう's greeting — her streams are called ここで待ってんのよ,
// so her viewers come home to them — and three other channels had it: at 78th,
// 78th and 46th, by one to three people each, against her 63 and 622 times.
// Counting those as "said elsewhere" called it universal.
//
// Twenty is where the two kinds separate. At that depth 👏 is in 32 of 35
// other channels and ただいま is in none; going to ten would start taking
// うおおおおお (4) and はい！はい！はい！はい！ (9) away as well, and those
// really do belong to everybody.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { argv, exit } from "node:process";

const root = new URL("..", import.meta.url).pathname;
const dir = `${root}tools/candidates`;

// How far down somebody else's list still counts as "they say this too".
const NEAR_THE_TOP = 20;

// And how many of them have to. A share rather than a count, because the
// count changes as more channels are mined and the question does not: with
// 36 channels to compare against, `ただいま` was in none of them and "at
// least one" was a fine rule; at 272 it is in two, and "at least one" called
// 稀羽すう's own greeting universal again.
//
// The distribution is two humps with a gap: of 2619 cards across 273
// channels, 1390 are in nobody else's top twenty and 568 are in more than
// half. Two percent — six channels of 272 — is where the gap sits. Above it:
// GG, わかる, おはよー, ばいばーい, 88888, ナイス, 待機. Below it: そう,
// wkwkwk, ないふぁい, and spellings of things already counted once.
const SAID_ELSEWHERE = 0.02;

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
const every = args.includes("--all");
const take = Number(flag("--take", 10));
const name = flag("--name", null);

if (!channel && !every) {
  console.log("usage: node tools/scope.mjs <UC…> [--take N] [--name 名前]");
  console.log("       node tools/scope.mjs --all");
  exit(1);
}
if (channel && !existsSync(`${dir}/${channel}.json`)) {
  console.log(`FAIL ${channel} の候補がありません。先に tools/mine.sh を回してください`);
  exit(1);
}

/* ---------- everyone else's rooms ---------- */

// Its own output lives in the same directory, and `<channel>.preset.json`
// ends in .json like everything else — read as a candidate list it has no
// candidates in it at all.
const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".preset.json"));

// Read once, not once per channel. Every lookup wants the same thing — who
// else says this — so the tally is built across all of them and each
// channel's own contribution subtracted when its turn comes. Doing it per
// channel meant re-reading a hundred megabytes 273 times.
const loaded = files.map((file) => {
  const other = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
  // Signatures, so `888` and `88888888` are the same thing said twice and
  // `おつ` is not `おつかれ`. The same collapse the hand's own sort uses.
  return {
    ...other,
    near: new Set(other.candidates.slice(0, NEAR_THE_TOP).map((c) => trending.signature(c.tokens)))
  };
});

const everywhere = new Map();
for (const room of loaded) {
  for (const sig of room.near) everywhere.set(sig, (everywhere.get(sig) || 0) + 1);
}

// One spelling per phrase, for the cards that travel.
//
// Scope is decided on the signature, which treats `お`, `おおー` and `お！`
// as one reaction — rightly, they are. But each channel writes its own
// commonest wording onto the card, so 273 channels produced twelve separate
// global cards for that one reaction, eight for `w`, four for `👏`. Loading
// several presets then stacked all of them into every pool.
//
// So a phrase that is going to be global gets the wording the most people
// used across every channel that says it. A channel-only card keeps its own:
// there is nobody else to agree with, and the way this room writes it is the
// point.
const spelling = new Map();   // signature -> wording -> people
for (const room of loaded) {
  for (const c of room.candidates) {
    const sig = trending.signature(c.tokens);
    const by = spelling.get(sig) || new Map();
    const key = JSON.stringify(c.tokens);
    by.set(key, (by.get(key) || 0) + c.people);
    spelling.set(sig, by);
  }
}

const commonestSpelling = (sig, fallback) => {
  const by = spelling.get(sig);
  if (!by) return fallback;
  const [best] = [...by].sort((a, b) => b[1] - a[1]);
  return JSON.parse(best[0]);
};

if (loaded.length < 2) {
  console.log("FAIL 比べる相手がいません。ほかのチャンネルも tools/mine.sh で掘ってください");
  exit(1);
}

/* ---------- and this one ---------- */

const label = (list) =>
  list.map((t) => (t.type === "text" ? t.value : t.sharedTooltipText || `[${t.alt}]`)).join("");

// Names, so a preset is offered by something a person recognises.
let named = new Map();
try {
  named = new Map(
    JSON.parse(readFileSync(`${root}tools/channels.json`, "utf8"))
      .map((c) => [c.id, c.japanese || c.name])
  );
} catch (_) { /* the list is optional */ }

function decide(mine) {
  const rooms = loaded.length - 1;
  return mine.candidates.slice(0, take).map((c) => {
    const sig = trending.signature(c.tokens);
    // Everyone who says it, less this channel if it is one of them.
    const others = (everywhere.get(sig) || 0) - (mine.near.has(sig) ? 1 : 0);
    // Member emoji have no say in this: they can be sent in one place, and
    // the store forces their scope regardless of what a preset claims.
    const member = tokens.requiredChannels(c.tokens).length > 0;
    const common = others >= Math.max(1, Math.ceil(rooms * SAID_ELSEWHERE));
    const scope = member || !common ? "channel" : "global";
    return {
      ...c,
      tokens: scope === "global" ? commonestSpelling(sig, c.tokens) : c.tokens,
      others, rooms, member, scope
    };
  });
}

function write(mine, judged, title) {
  const preset = {
    format: 2,
    name: title,
    note: `過去${mine.streams}配信のチャットから、常連が多い順に${judged.length}枚`,
    channel: mine.channel,
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
  const out = `${dir}/${mine.channel}.preset.json`;
  writeFileSync(out, `${JSON.stringify(preset, null, 2)}\n`);
  return out;
}

if (every) {
  let made = 0;
  let empty = 0;
  for (const mine of loaded) {
    const judged = decide(mine);
    if (!judged.length) { empty += 1; continue; }
    write(mine, judged, named.get(mine.channel) || mine.channel);
    made += 1;
  }
  console.log(`${loaded.length}チャンネル → ${made}組（候補なし ${empty}）`);
  console.log(`  node tools/add-preset.mjs tools/candidates/*.preset.json`);
  exit(0);
}

const mine = loaded.find((m) => m.channel === channel);
const judged = decide(mine);

console.log(`${judged[0]?.rooms ?? loaded.length - 1}チャンネルと比べました\n`);
console.log("よそ  常連  種別   scope    内容");
for (const c of judged) {
  console.log(
    `${String(c.others).padStart(3)}/${c.rooms}  ${String(c.regulars).padStart(4)}  ` +
    `${c.member ? "メン限" : "　　  "}  ${c.scope.padEnd(8)} ${label(c.tokens).slice(0, 38)}`
  );
}

const out = write(mine, judged, name || named.get(channel) || channel);
console.log(`\n${out.replace(root, "")}`);
console.log(`  node tools/add-preset.mjs ${out.replace(root, "")}`);
