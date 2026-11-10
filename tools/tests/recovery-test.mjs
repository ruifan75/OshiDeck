// Recorded yt-dlp errors must skip an ineligible video, not lose its whole
// channel. A local downloader also reproduces a cached bad fragment on retry.
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../..", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "oshideck-recovery-"));
const originalPath = process.env.PATH;
let failed = 0;
const check = (label, ok) => { if (!ok) failed++; console.log(`${ok ? "ok   " : "FAIL "}${label}`); };
const member = "ERROR: [youtube] member00001: Join this channel to get access to members-only content like this video, and other exclusive perks.";
const level = "ERROR: [youtube] level000001: This video is available to this channel's members on level: Example tier (or any higher level). Join this channel to get access to members-only content and other exclusive perks.";
const broken = "ERROR: Unable to download video subtitles for 'live_chat': Expecting value: line 1 column 1 (char 0)";

try {
  for (const folder of ["tools", "src", "bin", "fixtures", "plans", "downloads", "raw"]) mkdirSync(join(dir, folder));
  copyFileSync(process.env.OD_PRODUCTION || join(root, "tools", "produce-presets.mjs"), join(dir, "tools", "produce-presets.mjs"));
  copyFileSync(join(root, "tools", "chat-lines.mjs"), join(dir, "tools", "chat-lines.mjs"));
  const { mineAll, unavailable, quarantinePartial, save, RECIPE } = await import(pathToFileURL(join(dir, "tools", "produce-presets.mjs")).href);
  check("a members-only response is an ineligible video", unavailable(member));
  check("a membership-level response is an ineligible video", unavailable(level));
  check("an unavailable recording is skipped", unavailable("ERROR: [youtube] example0001: This live stream recording is not available."));
  check("a video still being processed is currently unusable", unavailable("ERROR: [youtube] example0001: We're processing this video. Check back later."));
  check("an unavailable-video response is skipped", unavailable("ERROR: [youtube] example0001: This video is not available."));
  check("public titles and network failures are not membership evidence",
    !unavailable('[youtube] Downloading webpage: Our members-only celebration') &&
    !unavailable("[info] Title: Join this channel to get access to members-only content") &&
    !unavailable('ERROR: HTTP Error 503: Service Unavailable'));
  if (!process.argv.includes("--classify-only")) {
    for (const file of ["tokens.js", "backup.js", "store.js", "trending.js", "presets.js"]) {
      copyFileSync(join(root, "src", file), join(dir, "src", file));
    }
    for (const file of ["mine-chat.mjs", "scope.mjs"]) copyFileSync(join(root, "tools", file), join(dir, "tools", file));
    const downloader = join(dir, "bin", "yt-dlp");
    writeFileSync(downloader, `#!/usr/bin/env node
const fs = require("node:fs");
const id = process.argv.at(-1).split("=").at(-1);
const old = fs.existsSync("attempts.jsonl") ? fs.readFileSync("attempts.jsonl", "utf8").trim().split("\\n").map(JSON.parse) : [];
fs.appendFileSync("attempts.jsonl", JSON.stringify({id}) + "\\n");
const stop = (reason) => { console.error(reason); process.exit(1); };
if (id === "member00001") stop(${JSON.stringify(member)});
if (id === "level000001") stop(${JSON.stringify(level)});
const part = "raw/" + id + ".live_chat.json.part-Frag1";
if (id === "fresh000001" && !old.some(x => x.id === id)) {
  fs.writeFileSync(part, "<!DOCTYPE html><html>temporary response</html>");
  fs.writeFileSync("raw/" + id + ".live_chat.json.ytdl", "{}");
  stop(${JSON.stringify(broken)});
}
if (fs.existsSync(part)) stop(${JSON.stringify(broken)});
fs.copyFileSync("fixtures/" + id + ".json", "raw/" + id + ".live_chat.json");
console.log("Download completed");
`);
    chmodSync(downloader, 0o755);
    process.env.PATH = `${join(dir, "bin")}:${originalPath}`;
    const channels = ["a", "b", "c", "d"].map((letter, index) => ({
      id: `UC${letter.repeat(22)}`, name: letter, subscribers: 4 - index
    }));
    save(join(dir, "channels.json"), channels);
    const videos = [["member00001", "song0000001"], ["level000001", "song0000002"], ["stale000001"], ["fresh000001"]];
    const row = { replayChatItemAction: { actions: [{ addChatItemAction: { item: {
      liveChatTextMessageRenderer: { authorExternalChannelId: "viewer", message: { runs: [{ text: "cheer" }] } }
    } } }] } };
    for (const [index, channel] of channels.entries()) {
      save(join(dir, "plans", `${channel.id}.json`), { recipe: RECIPE, channel: channel.id,
        singing: videos[index].map((id) => ({ id })), ordinary: [] });
      for (const id of videos[index]) writeFileSync(join(dir, "fixtures", `${id}.json`), JSON.stringify(row) + "\n");
    }
    save(join(dir, "downloads", "member00001.json"), { state: "error", channel: channels[0].id, video: "member00001", reason: member });
    save(join(dir, "downloads", "stale000001.json"), { state: "error", channel: channels[2].id, video: "stale000001", reason: broken });
    writeFileSync(join(dir, "raw", "stale000001.live_chat.json.part-Frag1"), "<!DOCTYPE html>cached response");
    writeFileSync(join(dir, "raw", "stale000001.live_chat.json.part"), "preserved incomplete chat");
    writeFileSync(join(dir, "raw", "stale000001.live_chat.json.ytdl"), "{}");
    let result = { completed: 0 };
    try { result = await mineAll(dir, { jobs: 2, browser: null, cacheDirs: [], retryDelayMs: 0 }); }
    catch (_) { /* Individual assertions below identify the failed guarantee. */ }
    const attempts = readFileSync(join(dir, "attempts.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    check("a known membership failure resumes without another request", !attempts.some((x) => x.id === "member00001") &&
      JSON.parse(readFileSync(join(dir, "downloads", "member00001.json"))).state === "unavailable");
    check("a new membership failure advances to the next public stream", attempts.filter((x) => x.id === "level000001").length === 1 &&
      JSON.parse(readFileSync(join(dir, "results", `${channels[1].id}.json`))).state === "complete");
    check("a cached bad fragment is replaced before resuming", attempts.filter((x) => x.id === "stale000001").length === 1 &&
      JSON.parse(readFileSync(join(dir, "results", `${channels[2].id}.json`))).cards === 1);
    check("a failed fragment is replaced before its next attempt", attempts.filter((x) => x.id === "fresh000001").length === 2 &&
      JSON.parse(readFileSync(join(dir, "results", `${channels[3].id}.json`))).cards === 1);
    check("all channels finish despite ineligible streams", result.completed === 4);

    const guard = "guard000001";
    const complete = join(dir, "raw", `${guard}.live_chat.json`);
    const neighbor = join(dir, "raw", "other000001.live_chat.json.part-Frag1");
    writeFileSync(complete, "complete chat");
    writeFileSync(neighbor, "other video");
    writeFileSync(join(dir, "raw", `${guard}.live_chat.json.part-Frag1`), "incomplete fragment");
    const archived = quarantinePartial(dir, guard);
    check("quarantine preserves complete chats and other videos", existsSync(complete) && existsSync(neighbor) && archived.length === 1);
    const preserved = [];
    const walk = (folder) => { for (const item of readdirSync(folder, { withFileTypes: true })) {
      const file = join(folder, item.name); if (item.isDirectory()) walk(file); else preserved.push(file);
    } };
    walk(join(dir, "partial-retries"));
    check("failed partial data is retained for inspection", preserved.some((file) => file.endsWith("stale000001.live_chat.json.part") &&
      readFileSync(file, "utf8") === "preserved incomplete chat"));
  }
} catch (error) {
  check("the recovery fixture finishes", false);
  console.log(String(error.message).replaceAll(dir, "<fixture>"));
} finally {
  process.env.PATH = originalPath;
  rmSync(dir, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
