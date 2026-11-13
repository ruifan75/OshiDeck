// Exercise the actual rebuild planner with recorded response shapes. Holodex
// omits `mentions` when the requested list is empty; that is a usable solo.
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../..", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "oshideck-production-"));
let failed = 0;
const check = (label, ok) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok   " : "FAIL "}${label}`);
};
try {
  mkdirSync(join(dir, "tools"));
  const source = process.env.OD_PRODUCTION || join(root, "tools", "produce-presets.mjs");
  const file = join(dir, "tools", "produce-presets.mjs");
  copyFileSync(source, file);
  copyFileSync(process.env.OD_CHAT_LINES || join(root, "tools", "chat-lines.mjs"), join(dir, "tools", "chat-lines.mjs"));
  const { karaoke, ordinary, planChannel, planAll, mineAll, finishAll, inspectChat,
    needsLogin, unavailable, save, RECIPE } = await import(pathToFileURL(file).href);
  const song = { id: "song0000001", topic_id: "singing", duration: 3600 };
  check("karaoke keeps an omitted empty mentions list", karaoke(song));
  check("karaoke rejects a known collaboration", !karaoke({ ...song, mentions: [{ id: "guest" }] }));
  check("karaoke uses the measured duration bounds", !karaoke({ ...song, duration: 2399 }) &&
    !karaoke({ ...song, duration: 16001 }) && karaoke({ ...song, duration: 2400 }));
  check("ordinary streams exclude singing and members-only", !ordinary(song) &&
    !ordinary({ ...song, topic_id: "membersonly" }) && ordinary({ ...song, topic_id: null }));
  const channel = { id: `UC${"a".repeat(22)}`, name: "Example", subscribers: 100 };
  let requests = 0;
  const ask = async (query) => {
    requests++;
    if (query.includes("topic=singing")) return [song];
    if (query.includes("offset=0")) return Array.from({ length: 50 }, () => song);
    return [{ ...song, id: "talk0000001", topic_id: null }];
  };
  const plan = await planChannel(channel, ask);
  check("the ordinary scan continues past a page of karaoke", plan.ordinary.length === 1 && requests === 3);
  check("a song is not also an ordinary stream", !plan.ordinary.some((v) => v.id === song.id));
  check("the plan records its search bounds", plan.search.ordinaryScanned === 51 &&
    plan.search.ordinaryExhausted && plan.search.singingLimit === 50);
  save(join(dir, "channels.json"), [channel]);
  const result = await planAll(dir, { ask, jobs: 1 });
  check("the planner writes a resumable per-channel plan", result.completed === 1 &&
    JSON.parse(readFileSync(join(dir, "plans", `${channel.id}.json`))).recipe === RECIPE);
  const resumed = await planAll(dir, { ask: () => { throw Error("must not fetch again"); }, jobs: 1 });
  check("a completed plan resumes without another fetch", resumed.skipped === 1);
  save(join(dir, "channels.json"), [{ ...channel, id: `UC${"b".repeat(22)}` }]);
  let rejected = false;
  const reportError = console.error;
  console.error = () => {};
  try { await planAll(dir, { ask: async () => { throw Error("unavailable"); }, jobs: 1 }); }
  catch (_) { rejected = true; }
  finally { console.error = reportError; }
  const progress = JSON.parse(readFileSync(join(dir, "planning.json")));
  check("a failed fetch is reported as failure rather than no streams", rejected && progress.failed === 1);

  check("login failures request cookies instead of meaning no replay", needsLogin("Sign in to confirm you're not a bot") &&
    needsLogin("HTTP Error 403") && !needsLogin("There are no subtitles"));
  check("no replay is distinct from a network failure", unavailable("There are no subtitles") &&
    !unavailable("HTTP Error 429") && !unavailable("Connection timed out"));
  const unicodeFile = join(dir, "unicode-chat.json");
  const unicodeRow = { replayChatItemAction: { actions: [{ addChatItemAction: { item: {
    liveChatTextMessageRenderer: { authorExternalChannelId: "viewer", message: { runs: [
      { text: "first\u2028second\u2029" + "文".repeat(40000) }
    ] } }
  } } }] } };
  writeFileSync(unicodeFile, JSON.stringify(unicodeRow) + "\n" + JSON.stringify(unicodeRow));
  let unicodeMessages = null;
  try { unicodeMessages = await inspectChat(unicodeFile); } catch (_) { /* reported below */ }
  check("chat inspection preserves literal Unicode separators across chunks", unicodeMessages === 2);
  mkdirSync(join(dir, "src"));
  for (const file of ["tokens.js", "backup.js", "store.js", "trending.js", "presets.js"]) {
    copyFileSync(join(root, "src", file), join(dir, "src", file));
  }
  for (const file of ["mine-chat.mjs", "scope.mjs"]) {
    copyFileSync(join(root, "tools", file), join(dir, "tools", file));
  }
  const second = { ...channel, id: `UC${"b".repeat(22)}`, name: "Second" };
  save(join(dir, "channels.json"), [channel, second]);
  mkdirSync(join(dir, "cache"));
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"];
  for (const [index, c] of [channel, second].entries()) {
    const video = `song000000${index + 1}`;
    const rows = words.map((word) => ({ replayChatItemAction: { actions: [{ addChatItemAction: {
      item: { liveChatTextMessageRenderer: { authorExternalChannelId: "viewer", message: { runs: [{ text: word }] } } }
    } }] } }));
    writeFileSync(join(dir, "cache", `${video}.live_chat.json`), rows.map((row) => JSON.stringify(row)).join("\n"));
    save(join(dir, "plans", `${c.id}.json`), { recipe: RECIPE, channel: c.id, singing: [{ id: video }], ordinary: [] });
  }
  const mined = await mineAll(dir, { jobs: 2, browser: null, cacheDirs: [join(dir, "cache")] });
  check("the rebuild mines cached replays without downloading", mined.completed === 2 &&
    JSON.parse(readFileSync(join(dir, "results", `${channel.id}.json`))).cards === 12);
  check("the rebuild preserves existing measurement chats", existsSync(join(dir, "cache", "song0000001.live_chat.json")));
  const resumedMine = await mineAll(dir, { jobs: 1, browser: null, cacheDirs: [] });
  check("completed channels resume without downloading", resumedMine.skipped === 2);
  const finished = await finishAll(dir);
  check("the full rebuild keeps more than ten and validates both presets", finished.presets === 2 &&
    finished.cards === 24 && finished.maxCards === 12);
  const published = JSON.parse(readFileSync(join(dir, "presets", `${channel.id}.preset.json`)));
  check("finishing publishes channel-only cards without a scope threshold",
    finished.scope.policy === "channel-only" && finished.scope.status === "ready" &&
    published.cards.every((card) => card.scope === "channel"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
