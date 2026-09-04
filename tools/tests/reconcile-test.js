// the exact situation from the export, replayed
const requiredChannels = (list) => [...new Set((list || [])
  .map((t) => /^(UC[A-Za-z0-9_-]{22})\//.exec(t.emojiId || "")?.[1])
  .filter(Boolean))];

function reconcileChannel(channel, captured) {
  const required = requiredChannels(captured);
  if (required.length !== 1 || required[0] === channel?.id) return channel;
  return { id: required[0], name: "" };
}

const MUSIC  = "UC-9-kyTW8ZkZNDHQJ6FgpwQ";
const SHINO  = "UCTbEua7o1f8I7EMBQlLjTpQ";
const stamp  = (o) => [{ type: "youtubeEmoji", emojiId: o + "/zabc" }];

let fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "ok   " : "FAIL "}${label.padEnd(46)} -> ${got}`);
};

check("scrape wrong, stamps say Shino",
  reconcileChannel({ id: MUSIC, name: "幽音しの…" }, stamp(SHINO)).id, SHINO);
check("scrape right, stamps agree",
  reconcileChannel({ id: SHINO, name: "幽音しの…" }, stamp(SHINO)).id, SHINO);
check("plain text card, scrape is all we have",
  reconcileChannel({ id: SHINO, name: "x" }, [{ type: "text", value: "888" }]).id, SHINO);
check("no channel detected, stamps supply it",
  reconcileChannel(null, stamp(SHINO)).id, SHINO);
check("stamps from two channels, do not guess",
  reconcileChannel({ id: MUSIC, name: "x" }, [...stamp(SHINO), ...stamp("UCother00000000000000000")]).id, MUSIC);
check("corrected id drops the untrusted name",
  reconcileChannel({ id: MUSIC, name: "幽音しの…" }, stamp(SHINO)).name, "");
process.exit(fail);
