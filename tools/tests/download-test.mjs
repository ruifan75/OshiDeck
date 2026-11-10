// Two real channel workers, a local downloader, and the real instrumented
// miner: downloads must overlap while the mining subprocesses take turns.
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync,
  readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../..", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "oshideck-downloads-"));
const originalPath = process.env.PATH;
let failed = 0;
const check = (label, ok) => { if (!ok) failed++; console.log(`${ok ? "ok   " : "FAIL "}${label}`); };
const peak = (events) => {
  let active = 0, maximum = 0;
  for (const event of events) {
    active += event.event === "start" ? 1 : -1;
    maximum = Math.max(maximum, active);
  }
  return maximum;
};
try {
  for (const folder of ["tools", "src", "bin", "fixtures", "plans"]) mkdirSync(join(dir, folder));
  for (const file of ["tokens.js", "backup.js", "store.js", "trending.js", "presets.js"]) {
    copyFileSync(join(root, "src", file), join(dir, "src", file));
  }
  for (const file of ["chat-lines.mjs", "scope.mjs"]) copyFileSync(join(root, "tools", file), join(dir, "tools", file));
  copyFileSync(process.env.OD_PRODUCTION || join(root, "tools", "produce-presets.mjs"), join(dir, "tools", "produce-presets.mjs"));
  const instrument = (event) => `recordParse(new URL("../parse-events.jsonl", import.meta.url), JSON.stringify({ event: "${event}", pid: process.pid }) + "\\n");`;
  writeFileSync(join(dir, "tools", "mine-chat.mjs"),
    'import { appendFileSync as recordParse } from "node:fs";\n' + instrument("start") +
    '\nawait new Promise((done) => setTimeout(done, 300));\n' +
    readFileSync(join(root, "tools", "mine-chat.mjs"), "utf8") + "\n" + instrument("end") + "\n");
  const downloader = join(dir, "bin", "yt-dlp");
  writeFileSync(downloader, `#!/usr/bin/env node
const fs = require("node:fs");
const id = process.argv.at(-1).split("=").at(-1);
const event = (kind) => fs.appendFileSync("download-events.jsonl", JSON.stringify({ event: kind, id }) + "\\n");
event("start");
setTimeout(() => {
  fs.copyFileSync("fixtures/" + id + ".json", "raw/" + id + ".live_chat.json");
  event("end");
  console.log("Download completed");
}, 500);
`);
  chmodSync(downloader, 0o755);
  process.env.PATH = `${join(dir, "bin")}:${originalPath}`;
  const { mineAll, save, RECIPE } = await import(pathToFileURL(join(dir, "tools", "produce-presets.mjs")).href);
  const channels = ["a", "b"].map((letter) => ({ id: `UC${letter.repeat(22)}`, name: letter, subscribers: 1 }));
  save(join(dir, "channels.json"), channels);
  for (const [index, channel] of channels.entries()) {
    const id = `song000000${index + 1}`;
    const row = { replayChatItemAction: { actions: [{ addChatItemAction: { item: {
      liveChatTextMessageRenderer: { authorExternalChannelId: "viewer", message: { runs: [{ text: "cheer" }] } }
    } } }] } };
    writeFileSync(join(dir, "fixtures", `${id}.json`), JSON.stringify(row) + "\n");
    save(join(dir, "plans", `${channel.id}.json`), { recipe: RECIPE, channel: channel.id, singing: [{ id }], ordinary: [] });
  }
  const result = await mineAll(dir, { jobs: 2, browser: null, cacheDirs: [] });
  const events = (file) => readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const downloads = events(join(dir, "download-events.jsonl"));
  const parses = events(join(dir, "code", "parse-events.jsonl"));
  check("two download workers overlap", downloads.length === 4 && peak(downloads) === 2);
  check("real mining subprocesses run one at a time", parses.length === 4 && peak(parses) === 1);
  check("both downloaded channels produce their cards", result.completed === 2 && channels.every((channel) =>
    JSON.parse(readFileSync(join(dir, "results", `${channel.id}.json`))).cards === 1));
} catch (error) {
  check("the concurrent download fixture finishes", false);
  console.log(String(error.message).replaceAll(dir, "<fixture>"));
} finally {
  process.env.PATH = originalPath;
  rmSync(dir, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
