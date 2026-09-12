// Checks that the channel tests can fail.
//
// A review found three cases in channel-test.mjs passing with the behaviour
// they named deliberately broken — the info-card fallback was quietly
// answering for them. Green meant nothing there, which is worse than having no
// test, because it invites trusting the code.
//
// So each guarantee gets a mutation: the smallest edit to content.js that
// reintroduces a bug this project has actually shipped. The tests must go red.
// One that stays green is not testing what its name says.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const source = readFileSync(join(root, "content.js"), "utf8");

// Each is [name, find, replace] — `find` must appear exactly once, so a
// mutation cannot silently stop applying when the code around it moves.
const MUTATIONS = [
  [
    "a handle restricted to ASCII",
    'if (!path.startsWith("/@")) return null;',
    'if (!/^\\/@[\\w.-]{1,64}$/.test(path)) return null;'
  ],
  [
    "a handle compared as a whole path",
    'const name = path.split("/")[1];',
    "const name = path.slice(1);"
  ],
  [
    "the owner selectors collapsed into one document-order list",
    `const OWNER_BLOCKS = [
    "ytd-video-owner-renderer",
    "ytd-watch-metadata #owner",
    "#owner"
  ];`,
    'const OWNER_BLOCKS = ["ytd-video-owner-renderer, ytd-watch-metadata #owner, #owner"];'
  ],
  [
    "the owner block no longer read for an id",
    "ownerId = ownerId || channelFromHref(link.getAttribute(\"href\"));",
    "ownerId = ownerId || null;"
  ],
  [
    "buttons allowed to supply the channel name",
    "if (el.closest(NOT_A_NAME)) continue;",
    "if (false) continue;"
  ],
  [
    "the mid-navigation freshness guard removed",
    "if (!showsCurrentVideo(doc)) return null;",
    "if (false) return null;"
  ],
  [
    "unanimity allowed to answer over a known handle",
    "    if (handle) return null;",
    "    if (false) return null;"
  ],
  [
    "a remembered channel no longer tied to its video",
    "return video && video === lastSeen.video ? lastSeen.channel : null;",
    "return lastSeen.channel || null;"
  ]
];

const dir = mkdtempSync(join(tmpdir(), "oshideck-mutation-"));
const test = join(root, "tools", "tests", "channel-test.mjs");

// A mutation that does not compile, or a suite already red, would make every
// mutation look caught.
try {
  execFileSync(process.execPath, [test], { stdio: "pipe" });
} catch (_) {
  console.log("FAIL channel-test.mjs is red before any mutation");
  process.exit(1);
}

let failed = 0;

for (const [name, find, replace] of MUTATIONS) {
  const count = source.split(find).length - 1;
  if (count !== 1) {
    console.log(`FAIL ${name} — the code it edits appears ${count} times, not once`);
    failed = 1;
    continue;
  }

  const path = join(dir, `${name.replace(/\W+/g, "-")}.js`);
  writeFileSync(path, source.replace(find, replace));

  let caught = false;
  try {
    execFileSync(process.execPath, [test], { stdio: "pipe", env: { ...process.env, OD_SOURCE: path } });
  } catch (_) {
    caught = true; // the suite went red, which is the point
  }

  console.log(`${caught ? "ok  " : "FAIL"} caught: ${name}`);
  if (!caught) failed = 1;
}

process.exit(failed);
