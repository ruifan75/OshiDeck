// How many streams is enough?
//
//   node tools/saturation.mjs UC… chat/*.live_chat.json
//
// Not a question of taste, so not a question for anyone's judgement. Mining
// one more stream costs a download and a minute; the thing worth knowing is
// when it stops changing the answer.
//
// What is measured is the top of the list, not the length of it. A longer
// list is what more chat always produces — most of it said twice by two
// people and never again. The question is whether the cards somebody would
// actually pick are still moving.
import { readFileSync } from "node:fs";
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
if (!channel || files.length < 2) {
  console.log("usage: node tools/saturation.mjs <UC…> <chat.json> <chat.json> […]");
  exit(1);
}

const TOP = 25;

// One stream, as signatures and who said them.
function read(file) {
  const out = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_) { continue; }
    for (const action of entry.replayChatItemAction?.actions || []) {
      const item = action.addChatItemAction?.item?.liveChatTextMessageRenderer;
      if (!item) continue;
      const list = (item.message?.runs || []).map((run) =>
        "text" in run
          ? { type: "text", value: run.text }
          : { type: "youtubeEmoji", emojiId: run.emoji?.emojiId || "",
              sharedTooltipText: (run.emoji?.shortcuts || [])[0] || "" });
      if (!tokens.hasSubstance(list)) continue;
      if (tokens.requiredChannels(list).some((id) => id !== channel)) continue;
      const sig = trending.signature(list);
      if (!sig) continue;
      const at = out.get(sig) || { people: new Set(), label: label(list) };
      at.people.add(item.authorExternalChannelId || Math.random());
      out.set(sig, at);
    }
  }
  return out;
}

const label = (list) =>
  list.map((t) => (t.type === "text" ? t.value : t.sharedTooltipText || "[絵文字]")).join("");

const streams = files.map((f) => ({ file: f.split("/").pop().slice(0, 11), seen: read(f) }));

/* ---------- add one stream at a time ---------- */

const merged = new Map();
let previous = [];

console.log(`${streams.length}配信、上位${TOP}件がどう動くか\n`);
console.log("配信  候補数  2回以上  上位入替  新顔");

for (let i = 0; i < streams.length; i++) {
  for (const [sig, at] of streams[i].seen) {
    const held = merged.get(sig) || { people: 0, streams: 0, label: at.label };
    held.people += at.people.size;
    held.streams += 1;
    merged.set(sig, held);
  }

  // Worth picking from: said in more than one stream, by more than one person.
  const ranked = [...merged.entries()]
    .filter(([, c]) => c.streams > 1 && c.people > 2)
    .sort((a, b) => b[1].streams - a[1].streams || b[1].people - a[1].people)
    .slice(0, TOP);

  const now = ranked.map(([sig]) => sig);
  const fresh = now.filter((sig) => !previous.includes(sig)).length;
  const churn = previous.length ? previous.filter((sig) => !now.includes(sig)).length : 0;

  console.log(
    `${String(i + 1).padStart(4)}  ${String(merged.size).padStart(6)}  ` +
    `${String([...merged.values()].filter((c) => c.streams > 1).length).padStart(7)}  ` +
    `${String(churn).padStart(8)}  ${String(fresh).padStart(4)}`
  );
  previous = now;
}

console.log(`\n最終の上位${TOP}:`);
for (const [, c] of [...merged.entries()]
  .filter(([, c]) => c.streams > 1 && c.people > 2)
  .sort((a, b) => b[1].streams - a[1].streams || b[1].people - a[1].people)
  .slice(0, TOP)) {
  console.log(`  ${String(c.streams).padStart(3)}配信 ${String(c.people).padStart(5)}人  ${c.label.slice(0, 40)}`);
}
