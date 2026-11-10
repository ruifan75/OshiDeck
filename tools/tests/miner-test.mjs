// Run the whole miner against chat exports, including the call that passes
// the sender's badges into token conversion. A lifted converter cannot say
// whether that context actually reaches it.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const root = new URL("../..", import.meta.url).pathname;
const source = process.env.OD_MINER ?? join(root, "tools", "mine-chat.mjs");
const dir = mkdtempSync(join(tmpdir(), "oshideck-miner-"));
const channel = `UC${"a".repeat(22)}`;
const member = { liveChatAuthorBadgeRenderer: {
  customThumbnail: { thumbnails: [{ url: "https://private.example.com/member.png" }] },
  tooltip: "Member"
} };
const moderator = { liveChatAuthorBadgeRenderer: { icon: { iconType: "MODERATOR" } } };
const verified = { liveChatAuthorBadgeRenderer: { icon: { iconType: "VERIFIED" } } };
const stamp = { emoji: {
  emojiId: `${channel}/live`, shortcuts: [":_live:"],
  image: { thumbnails: [{ url: "https://private.example.com/live.png" }] }
} };
const text = (value) => ({ type: "text", value });
const emoji = {
  type: "youtubeEmoji", emojiId: `${channel}/live`, alt: "",
  sharedTooltipText: ":_live:", src: "https://private.example.com/live.png"
};

const cases = [
  { label: "an unbadged sender keeps a square inside an emoticon", prefix: "visitor-face ",
    runs: [{ text: "（・" }, { text: "□" }, { text: "・；）" }],
    expected: [text("（・"), text("□"), text("・；）")] },
  { label: "a moderator badge alone does not make the sender a member", prefix: "moderator-face ",
    badges: [moderator], runs: [{ text: "（・" }, { text: "□" }, { text: "・；）" }],
    expected: [text("（・"), text("□"), text("・；）")] },
  { label: "a verified badge alone does not make the sender a member", prefix: "verified-face ",
    badges: [verified], runs: [{ text: "□" }], expected: [text("□")] },
  { label: "a member's deleted emoji leave the live emoji intact", prefix: "member-live ",
    badges: [member], runs: [{ text: "□" }, stamp, { text: "□" }], expected: [emoji] },
  { label: "a membership badge still counts after a moderator badge", prefix: "moderator-member ",
    badges: [moderator, member], runs: [{ text: "□" }, stamp], expected: [emoji] },
  { label: "a member's multi-square text run stays intact", prefix: "member-multiple ",
    badges: [member], runs: [{ text: "□□□" }], expected: [text("□□□")] },
  { label: "a square inside a longer text run stays intact", prefix: "member-inside ",
    badges: [member], runs: [{ text: "□✨□" }], expected: [text("□✨□")] },
  { label: "the black square inside a cat emoji stays intact", prefix: "member-cat ",
    badges: [member], runs: [{ text: "🐈‍⬛" }], expected: [text("🐈‍⬛")] },
  { label: "a standalone black square is not a deleted emoji", prefix: "member-black ",
    badges: [member], runs: [{ text: "⬛" }], expected: [text("⬛")] },
  { label: "live emoji do not supply a missing membership badge", prefix: "visitor-live ",
    runs: [{ text: "□" }, stamp], expected: [text("□"), emoji] },
  { label: "literal Unicode separators stay inside their JSON message", prefix: "unicode-lines ",
    runs: [{ text: "first\u2028second\u2029third" }], expected: [text("first\u2028second\u2029third")] }
];

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

try {
  mkdirSync(join(dir, "tools"));
  mkdirSync(join(dir, "src"));
  for (const file of ["tokens.js", "backup.js", "store.js", "trending.js"]) {
    copyFileSync(join(root, "src", file), join(dir, "src", file));
  }
  copyFileSync(source, join(dir, "tools", "mine-chat.mjs"));
  copyFileSync(join(root, "tools", "chat-lines.mjs"), join(dir, "tools", "chat-lines.mjs"));

  // The real miner requires three streams and more than one sender. Every
  // case meets those rules so a missing candidate points at token conversion.
  const files = [];
  for (let stream = 0; stream < 3; stream++) {
    const rows = [];
    const add = (runs, badges, who) => rows.push({ replayChatItemAction: { actions: [
      { addChatItemAction: { item: { liveChatTextMessageRenderer: {
        authorExternalChannelId: who,
        ...(badges ? { authorBadges: badges } : {}), message: { runs }
      } } } }
    ] } });
    for (const [i, c] of cases.entries()) {
      for (let who = 0; who < 2; who++) {
        add([{ text: c.prefix }, ...c.runs], c.badges, `viewer-${i}-${who}`);
      }
    }
    for (let who = 0; who < 2; who++) {
      add([{ text: "□" }, { text: "□" }], [member], `ghost-${who}`);
    }
    const file = join(dir, `chat-${stream}.json`);
    writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    files.push(file);
  }

  execFileSync(process.execPath, [join(dir, "tools", "mine-chat.mjs"), channel, ...files], {
    cwd: dir, stdio: "pipe"
  });
  const { candidates } = JSON.parse(readFileSync(join(dir, "tools", "candidates", `${channel}.json`), "utf8"));
  for (const c of cases) {
    const found = candidates.find((card) => card.text.startsWith(c.prefix.trimEnd()));
    check(c.label, !!found && isDeepStrictEqual(found.tokens, [text(c.prefix), ...c.expected]));
  }
  check("deleted member emoji alone do not become a candidate",
    !candidates.some((card) => card.tokens.length === 0 || /^□+$/.test(card.text)));
} catch (error) {
  check("the miner finishes on chat exports", false);
  console.log(String(error.stderr || error.message).replaceAll(dir, "<fixture>"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exitCode = fail ? 1 : 0;
