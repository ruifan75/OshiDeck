// The actual CLI must apply the karaoke rule and the ordinary fill together.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "oshideck-karaoke-"));
const channel = `UC${"a".repeat(22)}`;
const other = `UC${"b".repeat(22)}`;
let failed = 0, number = 0;
const check = (label, ok) => { if (!ok) failed++; console.log(`${ok ? "ok   " : "FAIL "}${label}`); };
const exportChat = (entries, size = 100) => {
  const rows = [];
  const add = (who, runs) => rows.push({ replayChatItemAction: { actions: [
    { addChatItemAction: { item: { liveChatTextMessageRenderer: {
      authorExternalChannelId: `viewer-${who}`, message: { runs }
    } } } }
  ] } });
  // All these people spoke, even though their foreign emoji are not candidates.
  for (let who = 0; who < size; who++) add(who, [{ emoji: { emojiId: `${other}/guest` } }]);
  for (const [text, people, repeats = 1] of entries) {
    for (let who = 0; who < people; who++) {
      for (let n = 0; n < repeats; n++) add(who, [{ text }]);
    }
  }
  const file = `chat${String(number++).padStart(7, "0")}.json`;
  writeFileSync(join(dir, file), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return file;
};
const mine = (streams) => {
  const manifest = { channel, output: "result.json", streams: streams.map(([kind, entries, size]) => {
    const file = exportChat(entries, size);
    return { kind, file, id: file.slice(0, -5) };
  }) };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  execFileSync(process.execPath, [join(dir, "tools", "mine-chat.mjs"), "--manifest", join(dir, "manifest.json")],
    { cwd: dir, stdio: "pipe" });
  return JSON.parse(readFileSync(join(dir, "result.json")));
};
const picked = (result) => result.candidates.filter((card) => result.selected.includes(card.signature));

try {
  mkdirSync(join(dir, "tools"));
  mkdirSync(join(dir, "src"));
  for (const file of ["tokens.js", "backup.js", "store.js", "trending.js"]) {
    copyFileSync(join(root, "src", file), join(dir, "src", file));
  }
  copyFileSync(process.env.OD_MINER || join(root, "tools", "mine-chat.mjs"), join(dir, "tools", "mine-chat.mjs"));
  copyFileSync(join(root, "tools", "chat-lines.mjs"), join(dir, "tools", "chat-lines.mjs"));
  const one = [["cheer", 10], ["average", 1], ["below", 9], ["spam", 1, 200]];
  const two = [["cheer", 10], ["average", 19], ["below", 10], ["spam", 1, 200], ["one evening", 30]];
  const talk = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
  const result = mine([["singing", one], ["singing", two], ...Array.from({ length: 3 }, (_, index) =>
    ["ordinary", [["cheer", 30], ...talk.map((text) => [text, 8]), ["steady", 9],
      ["event", index === 0 ? 40 : 2], ["one person", 1], ...(index < 2 ? [["two nights", 10]] : [])]])]);
  const songs = picked(result).filter((card) => card.source === "singing");
  check("karaoke uses the average of both streams", songs.some((card) => card.text === "average"));
  check("a karaoke phrase must appear in both streams", !picked(result).some((card) => card.text === "one evening"));
  check("the ten percent denominator includes rejected messages", !picked(result).some((card) => card.text === "below"));
  check("repeated posts do not become distinct people", !picked(result).some((card) => card.text === "spam"));
  check("ordinary cards fill to ten after skipping karaoke duplicates", picked(result).length === 10 &&
    picked(result).filter((card) => card.text === "cheer").length === 1 && songs.length === 2);
  check("ordinary cards retain the three-night rule", !picked(result).some((card) => card.text === "two nights"));
  check("ordinary cards retain the more-than-one-person rule", !picked(result).some((card) => card.text === "one person"));
  const ordinary = result.candidates.filter((card) => card.source === "ordinary");
  check("ordinary ranking uses the second busiest crowd", ordinary.findIndex((card) => card.text === "steady") <
    ordinary.findIndex((card) => card.text === "event"));
  const many = mine([["singing", [...talk, "kilo", "lima"].map((text) => [text, 1]), 1]]);
  check("all karaoke cards survive above ten without a people floor", picked(many).length === 12);
  copyFileSync(process.env.OD_SCOPE || join(root, "tools", "scope.mjs"), join(dir, "tools", "scope.mjs"));
  mkdirSync(join(dir, "candidates"));
  writeFileSync(join(dir, "candidates", `${channel}.json`), JSON.stringify(many));
  const legacy = { ...many, channel: other };
  delete legacy.selected;
  writeFileSync(join(dir, "candidates", `${other}.json`), JSON.stringify(legacy));
  execFileSync(process.execPath, [join(dir, "tools", "scope.mjs"), "--all", "--dir", join(dir, "candidates"),
    "--out", join(dir, "previews")], { cwd: dir, stdio: "pipe" });
  const scoped = JSON.parse(readFileSync(join(dir, "previews", `${channel}.preset.json`)));
  check("scope keeps every chosen karaoke card", scoped.cards.length === 12);
  const oldScoped = JSON.parse(readFileSync(join(dir, "previews", `${other}.preset.json`)));
  check("scope retains the legacy top-ten behavior", oldScoped.cards.length === 10);
  const single = mine([["singing", [["boundary", 1]], 10]]);
  check("one karaoke stream keeps the same ten percent threshold", picked(single).some((card) => card.text === "boundary"));
  const fallback = mine(Array.from({ length: 3 }, () => ["ordinary", [["fallback", 2]], 10]));
  check("no karaoke falls back to the ordinary rule", picked(fallback).length === 1 && picked(fallback)[0].text === "fallback");
} catch (error) {
  check("the whole mixed-stream miner finishes", false);
  console.log(String(error.stderr || error.message).replaceAll(dir, "<fixture>"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
