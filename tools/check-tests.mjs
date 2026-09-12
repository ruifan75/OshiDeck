// Checks that the tests can fail.
//
// A review found three cases in channel-test.mjs passing with the behaviour
// they named deliberately broken — the info-card fallback was quietly
// answering for them. Green meant nothing there, which is worse than having no
// test, because it invites trusting the code.
//
// So each guarantee gets a mutation: the smallest edit to the file that owns
// it which reintroduces a bug this project has actually shipped. The named
// test must go red for it, and only that test is run.
//
// Two things this gets wrong if written carelessly, both found by review:
//
//   * A mutation that does not compile makes every test fail, which looks
//     exactly like being caught. So mutants are parsed first, and only a
//     reported FAIL counts — not merely a non-zero exit.
//   * A mutation killed by a test other than the one it is for proves nothing
//     about that test. The first version of the ASCII mutation also broke
//     channel-tab handles, and the tab cases killed it; removing every Unicode
//     case left the checker still green. So each mutation names its test and
//     only that test is run.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const CHANNEL = "channel-test.mjs";
const VISIBILITY = "visibility-test.mjs";
const TREND = "trend-test.js";
const DRAW = "draw-test.mjs";
const CONFIRM = "confirm-test.mjs";

// Which file a mutation edits, and how its test is told to load the copy.
const CONTENT = { file: "content.js", env: "OD_SOURCE" };
const TRENDING = { file: "src/trending.js", env: "OD_TRENDING" };
const LAYOUT = { file: "src/layout.js", env: "OD_LAYOUT" };
const TOKENS = { file: "src/tokens.js", env: "OD_TOKENS" };
const OPTIONS = { file: "options.js", env: "OD_OPTIONS" };

const sources = new Map();
const read = ({ file }) => {
  if (!sources.has(file)) sources.set(file, readFileSync(join(root, file), "utf8"));
  return sources.get(file);
};

// [test, subject, name, find, replace] — `find` must appear exactly once, so a
// mutation cannot quietly stop applying when the code around it moves.
const MUTATIONS = [
  [CHANNEL, CONTENT, "a handle that rejects non-ASCII names",
    'if (!path.startsWith("/@")) return null;',
    'if (!path.startsWith("/@") || !/^[\\x00-\\x7F]*$/.test(path)) return null;'],

  [CHANNEL, CONTENT, "a handle compared as a whole path",
    'const name = path.split("/")[1];',
    "const name = path.slice(1);"],

  [CHANNEL, CONTENT, "the owner selectors collapsed into one document-order list",
    `const OWNER_BLOCKS = [
    "ytd-video-owner-renderer",
    "ytd-watch-metadata #owner",
    "#owner"
  ];`,
    'const OWNER_BLOCKS = ["ytd-video-owner-renderer, ytd-watch-metadata #owner, #owner"];'],

  [CHANNEL, CONTENT, "the owner block no longer read for an id",
    'ownerId = ownerId || channelFromHref(link.getAttribute("href"));',
    "ownerId = ownerId || null;"],

  [CHANNEL, CONTENT, "buttons allowed to supply the channel name",
    "if (el.closest(NOT_A_NAME)) continue;",
    "if (false) continue;"],

  [CHANNEL, CONTENT, "the mid-navigation freshness guard removed",
    "if (!showsCurrentVideo(doc)) return null;",
    "if (false) return null;"],

  [CHANNEL, CONTENT, "unanimity allowed to answer over a known handle",
    "    if (handle) return null;",
    "    if (false) return null;"],

  [CHANNEL, CONTENT, "a remembered channel no longer tied to its video",
    "return video && video === lastSeen.video ? lastSeen.channel : null;",
    "return lastSeen.channel || null;"],

  [CHANNEL, CONTENT, "the parent document no longer consulted from the chat frame",
    "if (window.top !== window) found = readChannel(window.top.document);",
    "if (false) found = readChannel(window.top.document);"],

  [CHANNEL, CONTENT, "a leftover player response believed",
    'if (/"videoId"\\s*:\\s*"([\\w-]{11})"/.exec(text)?.[1] !== video) return null;',
    "if (false) return null;"],

  [VISIBILITY, CONTENT, "an unmounted panel never asked for",
    "      if (!hide) scheduleRender();",
    "      if (false) scheduleRender();"],

  [VISIBILITY, CONTENT, "the hover freeze left on after hiding",
    `    // Nothing is under the pointer any more, and no pointerleave is owed.
    frozen = false;`,
    "    // (freeze deliberately left on)"],

  [TREND, TRENDING, "a flat count instead of recency",
    "seen.score += 2 ** (-(now - entry.at) / HALF_LIFE_MS);",
    "seen.score += 1;"],

  [DRAW, CONTENT, "member emoji offered as a drawn card",
    "if (tokens.requiredChannels(seen.tokens).length) continue;",
    "if (false) continue;"],

  [DRAW, CONTENT, "a reaction already in the deck offered again",
    "if (!signature || held.has(signature)) continue;",
    "if (!signature) continue;"],

  [DRAW, CONTENT, "an old burst offered as though it were a wave",
    "if (seen.count < DRAW_MIN_COUNT || seen.score < DRAW_MIN_SCORE) continue;",
    "if (seen.count < DRAW_MIN_COUNT) continue;"],

  [DRAW, LAYOUT, "a hand that refuses to squeeze",
    "return Math.min(MAX_OVERLAP, Math.max(OVERLAP, cardWidth - step));",
    "return OVERLAP;"],

  [TREND, TOKENS, "tooltips read as part of the comment",
    'if (NOT_CONTENT.has(current.tagName) || current.hasAttribute?.("hidden")) return;',
    "if (false) return;"],

  [VISIBILITY, CONTENT, "a description left behind by a removed control",
    "if (!peekOwner || peekOwner.isConnected) return;",
    "if (true) return;"],

  [CONFIRM, OPTIONS, "a second press of the same button counting as consent",
    "  if (el?.dataset.confirming) return;",
    "  if (el?.dataset.confirming) return deleteCardNow(card);"],

  [CONFIRM, OPTIONS, "a shared card deleted without asking",
    "  if (!held.length) return deleteCardNow(card);",
    "  return deleteCardNow(card);"],
];

const dir = mkdtempSync(join(tmpdir(), "oshideck-mutation-"));
const testPath = (name) => join(root, "tools", "tests", name);

function run(file, mutant, subject) {
  const env = mutant ? { ...process.env, [subject.env]: mutant } : process.env;
  try {
    execFileSync(process.execPath, [testPath(file)], { stdio: "pipe", env });
    return { failed: false, reported: false };
  } catch (error) {
    const out = String(error.stdout || "");
    // A real catch says FAIL for a case. A mutant that will not parse, or a
    // harness that cannot find its subject, says neither.
    const reported = out.split("\n").some(
      (line) => line.startsWith("FAIL ") && !line.includes("could not lift")
    );
    return { failed: true, reported };
  }
}

let failed = 0;

// A suite already red would make every mutation look caught.
for (const file of [CHANNEL, VISIBILITY, TREND, DRAW, CONFIRM]) {
  if (run(file, null).failed) {
    console.log(`FAIL ${file} is red before any mutation`);
    failed = 1;
  }
}
if (failed) process.exit(1);

for (const [file, subject, name, find, replace] of MUTATIONS) {
  const source = read(subject);
  const count = source.split(find).length - 1;
  if (count !== 1) {
    console.log(`FAIL ${name} — the code it edits appears ${count} times, not once`);
    failed = 1;
    continue;
  }

  const mutant = join(dir, `${name.replace(/\W+/g, "-")}.js`);
  writeFileSync(mutant, source.replace(find, replace));

  try {
    execFileSync(process.execPath, ["--check", mutant], { stdio: "pipe" });
  } catch (_) {
    console.log(`FAIL ${name} — the mutation does not parse, so nothing was tested`);
    failed = 1;
    continue;
  }

  const { reported } = run(file, mutant, subject);
  console.log(`${reported ? "ok  " : "FAIL"} ${file.padEnd(20)} caught: ${name}`);
  if (!reported) failed = 1;
}

process.exit(failed);
