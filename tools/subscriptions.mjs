// the maintainer's own subscription list, in his own order, matched to Holodex.
//
//   node tools/subscriptions.mjs channels          # the saved YouTube page
//   node tools/subscriptions.mjs channels --all    # including ones Holodex lacks
//
// Writes tools/subscriptions.json: who to build a preset for, and in what
// order. The order is the point — it is the order the page lists them in,
// which is the order he arranged them, and that is a better answer to "which
// channel next" than subscriber counts are. 稀羽すう is first in the file and
// first in the work.
//
// The page is a saved copy of youtube.com/feed/channels, because the API has
// no way to ask for somebody's subscriptions on their behalf and scraping the
// signed-in page is the thing it replaces. Holodex fills in the organisation
// and the Japanese name; YouTube's own title is kept for the ones it has
// never heard of, which is about half of them, mostly small or
// unaffiliated.
import { readFileSync, writeFileSync } from "node:fs";
import { argv, exit } from "node:process";

const root = new URL("..", import.meta.url).pathname;

const [, , page, ...rest] = argv;
if (!page) {
  console.log("usage: node tools/subscriptions.mjs <saved youtube page> [--all]");
  exit(1);
}
const keepUnknown = rest.includes("--all");

/* ---------- the page ---------- */

const html = readFileSync(page, "utf8");
const blob = /var ytInitialData = (\{.+?\});<\/script>/s.exec(html)?.[1];
if (!blob) {
  console.log("FAIL ytInitialData が見つかりません。ログイン済みのページを保存してください");
  exit(1);
}

// Each row of the subscription list is a channelRenderer, and they arrive in
// the order the page shows them. Walking rather than indexing, because the
// shape around them changes and the renderer itself has not.
const found = [];
(function walk(node) {
  if (Array.isArray(node)) return node.forEach(walk);
  if (!node || typeof node !== "object") return;
  if (node.channelRenderer) {
    found.push({
      id: node.channelRenderer.channelId,
      youtube: node.channelRenderer.title?.simpleText || ""
    });
  }
  for (const value of Object.values(node)) walk(value);
})(JSON.parse(blob));

const subs = [];
const seen = new Set();
for (const row of found) {
  if (!row.id || seen.has(row.id)) continue;
  seen.add(row.id);
  subs.push(row);
}

/* ---------- what Holodex knows about them ---------- */

let known = new Map();
try {
  known = new Map(
    JSON.parse(readFileSync(`${root}tools/channels.json`, "utf8")).map((c) => [c.id, c])
  );
} catch (_) {
  console.log("FAIL tools/channels.json がありません。先に channels.mjs --all を回してください");
  exit(1);
}

const list = subs
  .map((row, at) => {
    const holo = known.get(row.id);
    return {
      order: at + 1,
      id: row.id,
      name: holo?.japanese || row.youtube,
      org: holo?.org || null,
      subscribers: holo?.subscribers ?? null,
      inactive: holo?.inactive ?? null,
      onHolodex: !!holo
    };
  })
  .filter((c) => keepUnknown || c.onHolodex);

const out = `${root}tools/subscriptions.json`;
writeFileSync(out, `${JSON.stringify(list, null, 2)}\n`);

const live = list.filter((c) => !c.inactive);
const orgs = new Map();
for (const c of live) orgs.set(c.org || "（無所属）", (orgs.get(c.org || "（無所属）") || 0) + 1);

console.log(`登録 ${subs.length} チャンネル`);
console.log(`  Holodex にいる  ${subs.filter((s) => known.has(s.id)).length}`);
console.log(`  いない          ${subs.filter((s) => !known.has(s.id)).length}` +
  (keepUnknown ? "（--all なので含めます）" : "（事務所も日本語名も分からないので外しました）"));
console.log(`\n書き出したうち活動中 ${live.length} 件:`);
for (const [org, n] of [...orgs].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${String(n).padStart(4)}  ${org}`);
}
console.log(`\n最初の10件（この順に掘ります）:`);
for (const c of live.slice(0, 10)) {
  console.log(`  ${String(c.order).padStart(3)}  ${c.id}  ${(c.org || "—").padEnd(14)} ${c.name.slice(0, 24)}`);
}
console.log(`\n${out.replace(root, "")} — ${list.length}件`);
