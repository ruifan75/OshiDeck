// Lists an organisation's channels from Holodex, into tools/channels.json.
//
//   node tools/channels.mjs "Re:AcT"
//   node tools/channels.mjs Hololive --limit 200
//   node tools/channels.mjs --orgs            # what organisations there are
//
// This is a working list, not something the extension ships: which channels
// to mine chat for, and the names to put against the ids that turn up in
// member emoji. Holodex is asked rather than YouTube because YouTube has no
// idea which channels belong together.
//
// The key goes in .env (see .env.example). It is read-only and free, but it
// is still a key: .env is git-ignored and nothing here prints it.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { argv, exit } from "node:process";

const root = new URL("..", import.meta.url).pathname;
const out = `${root}tools/channels.json`;

/* ---------- the key ---------- */

function env(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(`${root}.env`)) return null;
  for (const line of readFileSync(`${root}.env`, "utf8").split("\n")) {
    const at = line.indexOf("=");
    if (at < 0 || line.trim().startsWith("#")) continue;
    if (line.slice(0, at).trim() === name) return line.slice(at + 1).trim();
  }
  return null;
}

const key = env("HOLODEX_API_KEY");
if (!key) {
  console.log("HOLODEX_API_KEY がありません。");
  console.log("  cp .env.example .env");
  console.log("  holodex.net → Account Settings → API key を .env に書く");
  exit(1);
}

/* ---------- what was asked for ---------- */

const args = argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
};
const orgs = args.includes("--orgs");
const org = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--limit");
const limit = Number(flag("--limit", 100));

if (!orgs && !org) {
  console.log('usage: node tools/channels.mjs "<org>" [--limit N]');
  console.log("       node tools/channels.mjs --orgs");
  exit(1);
}

const ask = async (path) => {
  const response = await fetch(`https://holodex.net/api/v2/${path}`, {
    headers: { "X-APIKEY": key, Accept: "application/json" }
  });
  if (!response.ok) {
    // Never the key itself, and never the url it rode in on.
    console.log(`FAIL Holodex ${response.status} ${response.statusText}`);
    exit(1);
  }
  return response.json();
};

/* ---------- the list ---------- */

// Holodex has no endpoint for this, so the organisations are whatever the
// channels say they are. One page of them is sorted alphabetically and shows
// only the As — the whole list has to be walked.
if (orgs) {
  const seen = new Map();
  for (let offset = 0; ; offset += 100) {
    const page = await ask(`channels?type=vtuber&limit=100&offset=${offset}&sort=org`);
    for (const c of page) {
      if (!c.org) continue;
      seen.set(c.org, (seen.get(c.org) || 0) + 1);
    }
    if (page.length < 100) break;
    if (offset > 20000) break;   // a wrong answer is better than an endless one
  }
  for (const [name, count] of [...seen].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(count).padStart(5)}  ${name}`);
  }
  exit(0);
}

// Holodex pages; a large org runs past one request.
const channels = [];
for (let offset = 0; offset < limit; offset += 50) {
  const page = await ask(
    `channels?org=${encodeURIComponent(org)}&type=vtuber&limit=50&offset=${offset}` +
    "&sort=subscriber_count&order=desc"
  );
  channels.push(...page);
  if (page.length < 50) break;
}

const shaped = channels.map((c) => ({
  id: c.id,
  name: c.english_name || c.name,
  japanese: c.name,
  handle: c.twitter ? `@${c.twitter}` : null,
  org: c.org,
  group: c.group || null,
  subscribers: Number(c.subscriber_count) || 0,
  inactive: !!c.inactive
}));

// Merged, so listing a second org does not throw away the first.
let held = [];
if (existsSync(out)) {
  try { held = JSON.parse(readFileSync(out, "utf8")); } catch (_) { held = []; }
}
const byId = new Map(held.map((c) => [c.id, c]));
for (const c of shaped) byId.set(c.id, c);

const all = [...byId.values()].sort((a, b) =>
  (a.org || "").localeCompare(b.org || "") || b.subscribers - a.subscribers);

writeFileSync(out, `${JSON.stringify(all, null, 2)}\n`);

const added = shaped.filter((c) => !held.some((h) => h.id === c.id)).length;
console.log(`${org}: ${shaped.length}チャンネル（新規 ${added}）`);
console.log(`tools/channels.json — ${all.length}件`);
for (const c of shaped.slice(0, 8)) {
  console.log(`  ${c.id}  ${String(c.subscribers).padStart(8)}  ${c.japanese}`);
}
if (shaped.length > 8) console.log(`  … 残り ${shaped.length - 8}`);
