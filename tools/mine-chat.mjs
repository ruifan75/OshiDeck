// What a channel's chat actually says, as candidate cards.
//
//   yt-dlp --skip-download --write-subs --sub-langs live_chat --sub-format json \
//     -o "chat/%(id)s.%(ext)s" "https://www.youtube.com/watch?v=…"
//   node tools/mine-chat.mjs UCeqIMtLuGc3YgwkhEaG8oDg chat/*.live_chat.json
//
// The output is a candidate list, not a preset. Which of these belong in
// somebody's starting hand is a matter of taste, and a count cannot have any.
// Pick from it by hand, then feed the result to add-preset.mjs.
//
// Ranked by **how many different people** said it, not by how many times it
// was said. A few people spamming a hundred stamps each is the thing that
// dominates a raw count, and it is not what the room is doing. On a 2-hour
// singing stream the two orderings disagree completely at the top.
import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";

const root = new URL("..", import.meta.url).pathname;

globalThis.OshiDeck = {};
globalThis.document = { querySelector: () => null };
globalThis.chrome = { runtime: { id: "x" }, storage: { local: { get: async () => ({}), set: async () => {} } } };
await import(`${root}src/tokens.js`);
await import(`${root}src/backup.js`);
await import(`${root}src/store.js`);
await import(`${root}src/trending.js`);
const { tokens, trending } = globalThis.OshiDeck;

const [, , channel, ...files] = argv;
if (!channel || !files.length) {
  console.log("usage: node tools/mine-chat.mjs <UC…> <chat.json> [more.json …]");
  exit(1);
}
if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel)) {
  console.log(`FAIL ${channel} はチャンネルIDではありません`);
  exit(1);
}

// Names for the ids that turn up inside emoji, when tools/channels.json has
// them. A guest's stamps are reported rather than silently dropped.
let known = new Map();
try {
  known = new Map(
    JSON.parse(readFileSync(`${root}tools/channels.json`, "utf8"))
      .map((c) => [c.id, c.japanese || c.name])
  );
} catch (_) { /* the list is optional */ }

/* ---------- the chat, as tokens ---------- */

// A chat export says `shortcuts: [":_tadaima:"]` where the live page says
// `shared-tooltip-text`. Same string, different spelling of the same fact,
// and tokens.js only knows the second one.
const asTokens = (message) =>
  (message?.runs || []).map((run) =>
    "text" in run
      ? { type: "text", value: run.text }
      : {
          type: "youtubeEmoji",
          emojiId: run.emoji?.emojiId || "",
          alt: run.emoji?.image?.accessibility?.accessibilityData?.label || "",
          sharedTooltipText: (run.emoji?.shortcuts || [])[0] || ""
        });

const seen = new Map();      // signature -> what was said, and by whom
const guests = new Map();    // other channels' member emoji, and how often
let messages = 0;
let skipped = 0;

for (const file of files) {
  const streams = new Set();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_) { continue; }

    for (const action of entry.replayChatItemAction?.actions || []) {
      const item = action.addChatItemAction?.item?.liveChatTextMessageRenderer;
      if (!item) continue;
      messages += 1;

      const list = asTokens(item.message);
      if (!tokens.hasSubstance(list)) continue;

      const required = tokens.requiredChannels(list);
      // Anything that cannot be sent on this channel is not this channel's to
      // hand on — and a card needing two channels can be sent nowhere at all.
      const elsewhere = required.filter((id) => id !== channel);
      if (elsewhere.length) {
        for (const id of elsewhere) guests.set(id, (guests.get(id) || 0) + 1);
        skipped += 1;
        continue;
      }

      const signature = trending.signature(list);
      if (!signature) continue;

      const at = seen.get(signature) || {
        tokens: list, people: new Set(), streams: new Set(), count: 0,
        member: required.length > 0
      };
      at.count += 1;
      at.people.add(item.authorExternalChannelId || `anon:${at.count}`);
      at.streams.add(file);
      // The wording people actually used most, rather than the first seen:
      // a signature collapses `888` and `88888888`, and one of them is what
      // somebody would want on the card.
      seen.set(signature, at);
      streams.add(file);
    }
  }
}

/* ---------- what came out ---------- */

const candidates = [...seen.values()]
  .map((c) => ({
    people: c.people.size,
    count: c.count,
    streams: c.streams.size,
    member: c.member,
    text: tokens.toPlainText(c.tokens).trim(),
    tokens: c.tokens.map((t) =>
      t.type === "text"
        ? { type: "text", value: t.value }
        : { type: "youtubeEmoji", emojiId: t.emojiId, alt: t.alt,
            sharedTooltipText: t.sharedTooltipText })
  }))
  // One person saying a thing is not something the room does.
  .filter((c) => c.people > 1)
  .sort((a, b) => b.streams - a.streams || b.people - a.people || b.count - a.count);

const out = `${root}tools/candidates.json`;
writeFileSync(out, `${JSON.stringify({ channel, streams: files.length, candidates }, null, 2)}\n`);

// Built from the tokens rather than from the text, so a member emoji reads
// as `:_curry:` and not as `currycurrycurry` — its label is a bare word, and
// three of them run together into something nobody typed.
const label = (c) =>
  c.tokens.map((t) => (t.type === "text" ? t.value : t.sharedTooltipText || `[${t.alt}]`)).join("");

console.log(`${files.length}配信・${messages}メッセージ → 候補 ${candidates.length}`);
if (skipped) {
  console.log(`\nよそのメン限スタンプを含む ${skipped} 件は外しました:`);
  for (const [id, n] of [...guests].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`  ${String(n).padStart(4)}  ${known.get(id) || `${id}（一覧にありません）`}`);
  }
}

console.log("\n配信数  人数  回数  種別  内容");
for (const c of candidates.slice(0, 40)) {
  console.log(
    `${String(c.streams).padStart(5)} ${String(c.people).padStart(5)} ${String(c.count).padStart(5)}` +
    `   ${c.member ? "メン限" : "　　  "}  ${label(c).slice(0, 44)}`
  );
}
console.log(`\ntools/candidates.json — ${candidates.length}件`);
