// Fills in the missing picture for member emoji already in the candidates.
//
//   node tools/emoji-src.mjs                  # every channel that needs it
//   node tools/emoji-src.mjs UCeqIM…          # just this one
//
// The candidates were mined before the url was being kept, and they hold
// everything else: the ids, the counts, fifteen streams' worth of who said
// what. Re-mining to recover one field would throw all of that away and take
// a day; this reads the ids that are already there and goes looking only for
// their pictures.
//
// One stream at a time, stopping as soon as every id has been seen. A
// channel's regulars use its stamps constantly, so the first stream usually
// has all of them — and when it does not, the second is cheaper than fifteen.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { argv } from "node:process";

const root = new URL("..", import.meta.url).pathname;
const dir = `${root}tools/candidates`;

const only = argv.slice(2).find((a) => /^UC[A-Za-z0-9_-]{22}$/.test(a));
const MOST_STREAMS = 4;

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".preset.json"))
  .filter((f) => !only || f.startsWith(only));

/* ---------- what each channel is missing ---------- */

const emojiTokens = (data) =>
  data.candidates.flatMap((c) => c.tokens.filter((t) => t.type === "youtubeEmoji"));

let done = 0;
let untouched = 0;

for (const file of files) {
  const path = `${dir}/${file}`;
  const data = JSON.parse(readFileSync(path, "utf8"));
  const channel = data.channel;

  const wanted = new Set(emojiTokens(data).filter((t) => !t.src).map((t) => t.emojiId));
  if (!wanted.size) { untouched += 1; continue; }

  const work = `${root}chat/src-${channel}`;
  mkdirSync(work, { recursive: true });

  let streams = [];
  try {
    streams = execFileSync("node", [`${root}tools/channels.mjs`, "--streams", channel,
      "--limit", String(MOST_STREAMS)], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch (_) { /* no streams listed */ }

  const found = new Map();

  for (const video of streams) {
    if (!wanted.size) break;

    const chat = `${work}/${video}.live_chat.json`;
    if (!existsSync(chat)) {
      try {
        execFileSync("yt-dlp", ["--skip-download", "--write-subs", "--sub-langs", "live_chat",
          "--sub-format", "json", "-o", `${work}/%(id)s.%(ext)s`,
          `https://www.youtube.com/watch?v=${video}`], { stdio: "ignore" });
      } catch (_) { /* members-only, or no replay */ }
    }
    if (!existsSync(chat)) continue;

    for (const line of readFileSync(chat, "utf8").split("\n")) {
      if (!line.includes("isCustomEmoji")) continue;
      let entry;
      try { entry = JSON.parse(line); } catch (_) { continue; }
      for (const action of entry.replayChatItemAction?.actions || []) {
        const item = action.addChatItemAction?.item?.liveChatTextMessageRenderer;
        for (const run of item?.message?.runs || []) {
          const id = run.emoji?.emojiId;
          if (!id || !wanted.has(id)) continue;
          const sizes = run.emoji.image?.thumbnails || [];
          const url = sizes[sizes.length - 1]?.url;
          if (!url) continue;
          found.set(id, url);
          wanted.delete(id);
        }
      }
    }
  }

  rmSync(work, { recursive: true, force: true });

  if (found.size) {
    for (const token of emojiTokens(data)) {
      if (!token.src && found.has(token.emojiId)) token.src = found.get(token.emojiId);
    }
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  }

  done += 1;
  console.log(`${channel}  ${found.size}個  ${wanted.size ? `（${wanted.size}個は見つからず）` : ""}`);
}

console.log(`\n${done}チャンネルを直しました（もともと揃っていた ${untouched}）`);
