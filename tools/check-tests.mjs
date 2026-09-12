// Checks that the tests can fail.
//
// A review found three cases in channel-test.mjs passing with the behaviour
// they named deliberately broken — the info-card fallback was quietly
// answering for them. Green meant nothing there, which is worse than having no
// test, because it invites trusting the code.
//
// So each guarantee gets a mutation: the smallest edit to content.js that
// reintroduces a bug this project has actually shipped. The named test must go
// red for it.
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
const source = readFileSync(join(root, "content.js"), "utf8");

const CHANNEL = "channel-test.mjs";
const VISIBILITY = "visibility-test.mjs";

// [test, name, find, replace] — `find` must appear exactly once, so a mutation
// cannot quietly stop applying when the code around it moves.
const MUTATIONS = [
  [CHANNEL, "a handle that rejects non-ASCII names",
    'if (!path.startsWith("/@")) return null;',
    'if (!path.startsWith("/@") || !/^[\\x00-\\x7F]*$/.test(path)) return null;'],

  [CHANNEL, "a handle compared as a whole path",
    'const name = path.split("/")[1];',
    "const name = path.slice(1);"],

  [CHANNEL, "the owner selectors collapsed into one document-order list",
    `const OWNER_BLOCKS = [
    "ytd-video-owner-renderer",
    "ytd-watch-metadata #owner",
    "#owner"
  ];`,
    'const OWNER_BLOCKS = ["ytd-video-owner-renderer, ytd-watch-metadata #owner, #owner"];'],

  [CHANNEL, "the owner block no longer read for an id",
    'ownerId = ownerId || channelFromHref(link.getAttribute("href"));',
    "ownerId = ownerId || null;"],

  [CHANNEL, "buttons allowed to supply the channel name",
    "if (el.closest(NOT_A_NAME)) continue;",
    "if (false) continue;"],

  [CHANNEL, "the mid-navigation freshness guard removed",
    "if (!showsCurrentVideo(doc)) return null;",
    "if (false) return null;"],

  [CHANNEL, "unanimity allowed to answer over a known handle",
    "    if (handle) return null;",
    "    if (false) return null;"],

  [CHANNEL, "a remembered channel no longer tied to its video",
    "return video && video === lastSeen.video ? lastSeen.channel : null;",
    "return lastSeen.channel || null;"],

  [CHANNEL, "the parent document no longer consulted from the chat frame",
    "if (window.top !== window) found = readChannel(window.top.document);",
    "if (false) found = readChannel(window.top.document);"],

  [CHANNEL, "a leftover player response believed",
    'if (/"videoId"\\s*:\\s*"([\\w-]{11})"/.exec(text)?.[1] !== video) return null;',
    "if (false) return null;"],

  [VISIBILITY, "an unmounted panel never asked for",
    "      if (!hide) scheduleRender();",
    "      if (false) scheduleRender();"],

  [VISIBILITY, "the hover freeze left on after hiding",
    `    // Nothing is under the pointer any more, and no pointerleave is owed.
    frozen = false;`,
    "    // (freeze deliberately left on)"],
];

const dir = mkdtempSync(join(tmpdir(), "oshideck-mutation-"));
const testPath = (name) => join(root, "tools", "tests", name);

function run(file, mutant) {
  const env = mutant ? { ...process.env, OD_SOURCE: mutant } : process.env;
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
for (const file of [CHANNEL, VISIBILITY]) {
  if (run(file, null).failed) {
    console.log(`FAIL ${file} is red before any mutation`);
    failed = 1;
  }
}
if (failed) process.exit(1);

for (const [file, name, find, replace] of MUTATIONS) {
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

  const { reported } = run(file, mutant);
  console.log(`${reported ? "ok  " : "FAIL"} ${file.padEnd(20)} caught: ${name}`);
  if (!reported) failed = 1;
}

process.exit(failed);
