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
const COLOUR = "colour-test.mjs";
const PRESET = "preset-test.mjs";
const MEMBER = "member-test.mjs";

// Which file a mutation edits, and how its test is told to load the copy.
const CONTENT = { file: "content.js", env: "OD_SOURCE" };
const TRENDING = { file: "src/trending.js", env: "OD_TRENDING" };
const LAYOUT = { file: "src/layout.js", env: "OD_LAYOUT" };
const TOKENS = { file: "src/tokens.js", env: "OD_TOKENS" };
const OPTIONS = { file: "options.js", env: "OD_OPTIONS" };
const STORE = { file: "src/store.js", env: "OD_STORE" };
const PRESETS = { file: "src/presets.js", env: "OD_PRESETS" };

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
    "seen.score += 2 ** (-(now - entry.at) / halfLife());",
    "seen.score += 1;"],

  [DRAW, CONTENT, "a reaction already in the deck offered again",
    "    !mine.has(seen.key) &&",
    "    true &&"],

  [DRAW, CONTENT, "a drawn card replaced the moment anything louder arrives",
    "    if (drawn) return drawn.card;",
    "    if (false) return drawn.card;"],

  [TREND, TRENDING, "a burst with no floor under it",
    "        if (seen.count < floor) continue;",
    "        if (false) continue;"],

  [TREND, TRENDING, "a burst that ignores how busy the chat is",
    "        if (seen.count < said * share) continue;",
    "        if (false) continue;"],

  [TREND, TRENDING, "bursts counted by the loose signature",
    "recent.push({ sig, key: cardKey(captured), at, tokens: captured });",
    "recent.push({ sig, key: sig, at, tokens: captured });"],

  [DRAW, LAYOUT, "a hand that refuses to squeeze",
    "return Math.min(MAX_OVERLAP, Math.max(OVERLAP, cardWidth - step));",
    "return OVERLAP;"],

  [DRAW, LAYOUT, "a drawn card costed as if it overlapped the hand",
    "const besideDrawn = (availWidth, cardWidth, gap) => availWidth - cardWidth - gap;",
    "const besideDrawn = (availWidth, cardWidth, gap) => availWidth - gap;"],

  [TREND, TOKENS, "tooltips read as part of the comment",
    'if (NOT_CONTENT.has(current.tagName) || current.hasAttribute?.("hidden")) return;',
    "if (false) return;"],

  [VISIBILITY, CONTENT, "a description left behind by a removed control",
    "if (!peekOwner || peekOwner.isConnected) return;",
    "if (true) return;"],

  [VISIBILITY, CONTENT, "a panel that cannot tell its hand has been reordered",
    'shown.map(each).join(",")',
    "shown.length"],

  [VISIBILITY, CONTENT, "a chat count counted as a change in its own right",
    '      card.hits ? "*" : ""',
    "      card.hits || 0"],

  [VISIBILITY, CONTENT, "a card edited in place going unnoticed",
    '      tokens.cardKey(card.tokens || []),',
    "      \"\","],

  [VISIBILITY, CONTENT, "a resize that the fan is never told about",
    "      rootEl?.clientWidth || 0,",
    "      0,"],

  [VISIBILITY, CONTENT, "presets arriving after the panel has given up asking",
    "      pool.length, presetsOnHand().length,",
    "      pool.length,"],

  [VISIBILITY, CONTENT, "a panel that never actually skips",
    "    if (next === painted && rootEl.firstChild) return;",
    "    // (no skip)"],

  [CONFIRM, OPTIONS, "a second press of the same button counting as consent",
    "  if (el?.dataset.confirming) return;",
    "  if (el?.dataset.confirming) return deleteCardNow(card);"],

  [CONFIRM, OPTIONS, "a shared card deleted without asking",
    "  if (!held.length) return deleteCardNow(card);",
    "  return deleteCardNow(card);"],

  [COLOUR, STORE, "a hand-picked colour ignored in favour of the hash",
    "    const known = OSHI_HUES[channelId];\n    if (known != null) return known;",
    "    const known = undefined;\n    if (known != null) return known;"],

  [PRESET, PRESETS, "member emoji carried into a preset",
    "      if (OD.tokens.requiredChannels(card.tokens).length) continue;",
    "      if (false) continue;"],

  [PRESET, PRESETS, "a preset that carries its ids along with its content",
    "        tokens: card.tokens,\n        scope:",
    "        id: card.id,\n        tokens: card.tokens,\n        scope:"],

  [PRESET, STORE, "a card that works only elsewhere counted as a match",
    "        const existing = family.find((held) => usableOn(held, channelId));",
    "        const existing = family[0];"],

  [PRESET, PRESETS, "channel-only losing its meaning on the way in",
    'scope: card.scope === "channel" && channelId ? channelId : OD.store.GLOBAL,',
    "scope: OD.store.GLOBAL,"],

  [DRAW, STORE, "a card held for a different time than anyone was told",
    "      normal: 45_000,",
    "      normal: 20_000,"],

  [DRAW, STORE, "a wave redefined without saying so",
    "      normal: { min: 6, share: 0.30 },",
    "      normal: { min: 3, share: 0.10 },"],

  [DRAW, STORE, "an unset step falling through to nothing",
    "    TUNING[group]?.[settings?.[group]] ?? TUNING[group]?.normal;",
    "    TUNING[group]?.[settings?.[group]];"],

  [VISIBILITY, CONTENT, "the skip decided after the panel has been torn down",
    `    if (next === painted && rootEl.firstChild) return;
    painted = next;

    keepChatPinned(() => {
      rootEl.replaceChildren();`,
    `    painted = next;

    keepChatPinned(() => {
      rootEl.replaceChildren();
      if (next === painted && rootEl.firstChild) return;`],

  [VISIBILITY, CONTENT, "a card becoming channel-only going unnoticed",
    '      card.bound ? "b" : "",',
    '      "",'],

  [VISIBILITY, CONTENT, "a card that can no longer be played looking the same",
    '      card.locked ? "l" : "",',
    '      "",'],

  [VISIBILITY, CONTENT, "the channel name left out of the signature",
    'channel?.id || "", channel?.name || "", hue ?? "",',
    'channel?.id || "", "", hue ?? "",'],

  [VISIBILITY, CONTENT, "a pool that can gain a card unnoticed",
    "      pool.length, presetsOnHand().length,",
    "      presetsOnHand().length,"],

  [VISIBILITY, CONTENT, "a drawn card the list offers no way to keep",
    "    el.append(play, drawnTools(card));",
    "    el.append(play);"],

  [DRAW, CONTENT, "a stream change that keeps the last chat's card",
    "    if (stream === watching) return false;",
    "    if (true) return false;"],

  [DRAW, CONTENT, "a new stream ranked by the old one's messages",
    "    watcher.forget();",
    "    // (the old chat is kept)"],

  [DRAW, CONTENT, "a new stream skipped on the old one's signature",
    `    drawn = null;
    painted = null;`,
    "    drawn = null;"],

  [DRAW, CONTENT, "a hold that never wakes the panel",
    "    holdTimer = setTimeout(() => scheduleRender(), hold + 250);",
    "    holdTimer = null;"],

  [DRAW, CONTENT, "the hold read from the wrong setting",
    'const hold = store.tuning(settingsCache, "hold");',
    'const hold = store.tuning(settingsCache, "pace");'],

  [TREND, TRENDING, "a busy chat forgotten wholesale at the cap",
    "        saidAt = saidAt.filter((seen) => seen >= at - BURST_MS);",
    "        saidAt = [];"],

  [PRESET, STORE, "one wording allowed only one card",
    "        (byKey.get(key) || byKey.set(key, []).get(key)).push(card);",
    "        byKey.set(key, [card]);"],

  [PRESET, STORE, "a preset that loads without learning the name",
    "      if (name) {",
    "      if (false) {"],

  // The five below are call sites. Every one of them was found by pointing out
  // that a helper can be tested to the hilt while the line that calls it
  // quietly passes the wrong thing — and all five went green until the tests
  // above them were written.
  [DRAW, CONTENT, "a wake-up that comes straight away instead of at the end",
    "    holdTimer = setTimeout(() => scheduleRender(), hold + 250);",
    "    holdTimer = setTimeout(() => scheduleRender(), 1);"],

  [DRAW, CONTENT, "a second stream on one channel treated as the same chat",
    '    const stream = video || channel?.id || "";',
    '    const stream = channel?.id || "";'],

  [VISIBILITY, CONTENT, "an editor whose member emoji nobody notices",
    "    const pinned = filled && tokens.requiredChannels(tokens.collectTokens(input)).length > 0;",
    "    const pinned = false;"],

  [VISIBILITY, CONTENT, "a stale description cleared after the decision, not before",
    `    dropStalePeek();

    const next = panelSignature(data, channel, hue, shown, pool, drawn);`,
    "    const next = panelSignature(data, channel, hue, shown, pool, drawn);"],

  [PRESET, CONTENT, "a preset loaded without passing the name along",
    "      name: channel.name,\n",
    ""],

  // Membership. Every one of these is a signal that was measured on a real
  // stream and could plausibly have been read the other way.
  [MEMBER, CONTENT, "a badge read from anywhere in the chat",
    `    const chip = document.querySelector(MY_CHIP);
    if (!chip) return null;
    return !!chip.querySelector("yt-live-chat-author-badge-renderer[type='member']");`,
    `    return !!document.querySelector("yt-live-chat-author-badge-renderer[type='member']");`],

  [MEMBER, CONTENT, "a hidden chip read as not being a member",
    "    if (!chip) return null;",
    "    if (!chip || chip.hidden) return false;"],

  [MEMBER, CONTENT, "a page that has not answered read as a no",
    "  function membership() {\n    const chip = document.querySelector(MY_CHIP);\n    if (!chip) return null;",
    "  function membership() {\n    const chip = document.querySelector(MY_CHIP);\n    if (!chip) return false;"],

  [MEMBER, CONTENT, "not knowing yet treated as not a member",
    '    return member === false ? "membership" : "";',
    '    return !member ? "membership" : "";'],

  [MEMBER, CONTENT, "a lock guessed before the channel is known",
    '    if (!channelId) return "";                    // no channel: cannot judge ownership',
    '    if (false) return "";'],

  [MEMBER, CONTENT, "a lapsed membership indistinguishable from the wrong channel",
    '      card.lapsed = why === "membership";',
    "      card.lapsed = false;"],

  [MEMBER, CONTENT, "a locked card left where the sort put it",
    '    if (settings.sortBy !== "trend") return playableFirst(store.sortCards(cards, settings.sortBy));',
    '    if (settings.sortBy !== "trend") return store.sortCards(cards, settings.sortBy);'],

  [MEMBER, CONTENT, "chat-driven order forgetting the lock",
    "    return playableFirst(ordered);",
    "    return ordered;"],

  [MEMBER, CONTENT, "a refusal that is asked for and then ignored",
    `    const why = whyNotSendable(captured, channel?.id, member);
    if (why) {`,
    `    const why = whyNotSendable(captured, channel?.id, member);
    if (false && why) {`],

  [MEMBER, CONTENT, "this chat's badge answering for another channel's emoji",
    "    const member = channel?.id && channel.id === seen.channel?.id ? seen.member : null;",
    "    const member = seen.member;"],

  [MEMBER, CONTENT, "a deck built without asking",
    "    markLocked(cards, channelId, membership());",
    "    markLocked(cards, channelId, true);"],

  [MEMBER, CONTENT, "a panel that never hears about joining",
    `    const member = membership();
    if (member === lastMembership) return;
    lastMembership = member;
    scheduleRender();`,
    "    return;"],

  [DRAW, CONTENT, "a held card exempt from the membership ending",
    `    if (drawn && (now >= drawn.until || mine.has(drawn.key) ||
        whyNotSendable(drawn.card.tokens, channelId, member))) drawn = null;`,
    "    if (drawn && (now >= drawn.until || mine.has(drawn.key))) drawn = null;"],

  [DRAW, CONTENT, "member emoji offered to someone who cannot send them",
    "    !whyNotSendable(seen.tokens, channelId, member);",
    "    true;"],

  // The callers again, and the fixtures that were letting them through.
  [MEMBER, CONTENT, "a chip that has to be hidden to count",
    'const MY_CHIP = "yt-live-chat-message-input-renderer yt-live-chat-author-chip";',
    'const MY_CHIP = "yt-live-chat-message-input-renderer yt-live-chat-author-chip[hidden]";'],

  [MEMBER, CONTENT, "a badge read after the page has moved",
    `    const seen = { channel: getChannel(), member: membership() };

    const data = await store.read();`,
    `    const data = await store.read();
    const seen = { channel: getChannel(), member: membership() };`],

  [MEMBER, CONTENT, "a pool that never asks",
    "      store.poolFor(data, channelId).map((card) => ({ ...card })), channelId, membership()));",
    "      store.poolFor(data, channelId).map((card) => ({ ...card })), channelId, true));"],

  [MEMBER, CONTENT, "a pool that keeps a locked card where it was",
    `    return playableFirst(markLocked(
      store.poolFor(data, channelId)`,
    `    return (markLocked(
      store.poolFor(data, channelId)`],

  [MEMBER, CONTENT, "an observer that is given something else to run",
    "  const observer = new MutationObserver(onPageChanged);",
    "  const observer = new MutationObserver(() => {});"],

  [MEMBER, CONTENT, "an observer deaf to a badge changing in place",
    `    childList: true, subtree: true, attributes: true, attributeFilter: ["type"]`,
    "    childList: true, subtree: true"],

  [DRAW, CONTENT, "an offer that takes the answer on trust",
    "    return drawFromChat(deck, { channelId: channel?.id, member: membership() });",
    "    return drawFromChat(deck, { channelId: channel?.id, member: true });"],

  [COLOUR, STORE, "an out-of-gamut hue clipped instead of desaturated",
    "    for (let c = chroma; c > 0.01 && found.some((v) => v < -0.0005 || v > 1.0005); c -= 0.005) {\n      found = rgb(c);\n    }",
    "    // (clipped below instead)"],
];

// Which assertion each mutation has to break.
//
// A mutant killed by some other assertion in the same file proves nothing
// about the one it is for. The reorder mutant also broke the trending
// assertion, so deleting the reorder case would have left the checker green —
// naming the assertion is what makes each mutation answer for its own.
const KILLS = {
  "a handle that rejects non-ASCII names": "encoded card handle matches a plain non-ASCII owner handle",
  "a handle compared as a whole path": "a card linking to a channel tab matches the plain owner handle",
  "the owner selectors collapsed into one document-order list": "an empty #owner earlier in the document does not win",
  "the owner block no longer read for an id": "the membership button still gives the right id",
  "buttons allowed to supply the channel name": "but its label is never the name",
  "the mid-navigation freshness guard removed": "a page still showing the previous video answers nothing",
  "unanimity allowed to answer over a known handle": "a known handle matching no card rejects the cards",
  "a remembered channel no longer tied to its video": "but the next video does not inherit it",
  "the parent document no longer consulted from the chat frame": "the owner is read from the parent document",
  "a leftover player response believed": "a player response describing another video is not used",

  "an unmounted panel never asked for": "with nothing mounted, a usable input asks for a render",
  "the hover freeze left on after hiding": "hiding releases the hover freeze",
  "a description left behind by a removed control": "and removing that control clears it",
  "a panel that cannot tell its hand has been reordered": "reordering the hand is",
  "a chat count counted as a change in its own right": "a chat count ticking up is not a change",
  "a card edited in place going unnoticed": "a card edited in place is a change",
  "a resize that the fan is never told about": "the panel being resized is a change",
  "presets arriving after the panel has given up asking": "the presets arriving is a change",
  "a panel that never actually skips": "render still decides whether to skip",

  "a flat count instead of recency": "so the new reaction takes the front",
  "a burst with no floor under it": "two of a thing is never a wave, however quiet the room",
  "a burst that ignores how busy the chat is": "six of a thing in a busy chat is just talk",
  "bursts counted by the loose signature": "each exact wording bursts on its own, unmerged",
  "tooltips read as part of the comment": "and carries no shortcode text",

  "a reaction already in the deck offered again": "a reaction already in the deck is not offered again",
  "a drawn card replaced the moment anything louder arrives": "a louder burst does not replace it while it is held",
  "a hand that refuses to squeeze": "by tightening the overlap",
  "a drawn card costed as if it overlapped the hand": "and the row, drawn card and all, still fits",

  "a second press of the same button counting as consent": "pressing the same button again does not delete",
  "a shared card deleted without asking": "a card another deck holds asks first",

  "a hand-picked colour ignored in favour of the hash": "a listed channel gets the colour it is listed with",
  "an out-of-gamut hue clipped instead of desaturated": "every hue survives the round trip",
  "a card held for a different time than anyone was told": "out of the box a card is held for 45 seconds",
  "a wave redefined without saying so": "a wave is six messages and three tenths of the room",
  "an unset step falling through to nothing": "an unset step falls back to the middle one",

  "member emoji carried into a preset": "member emoji are left behind",
  "a preset that carries its ids along with its content": "no ids, no counts, no history",
  "channel-only losing its meaning on the way in": "and channel-only means the channel it is loaded into",
  "a card that works only elsewhere counted as a match": "a card that only works on another channel is not treated as a match",
  "one wording allowed only one card": "a usable card is found even behind one that is not",
  "a preset that loads without learning the name": "loading a preset also names the channel",

  "the skip decided after the panel has been torn down": "and does it before tearing the panel down",
  "a card becoming channel-only going unnoticed": "a card becoming channel-only is",
  "a card that can no longer be played looking the same": "and a card becoming unplayable here is",
  "the channel name left out of the signature": "the channel being named at last is a change",
  "a pool that can gain a card unnoticed": "the pool gaining a card is a change",
  "a drawn card the list offers no way to keep": "and so can one in the list",

  "a stream change that keeps the last chat's card": "which takes the card away",
  "a new stream ranked by the old one's messages": "forgets what the last chat was saying",
  "a new stream skipped on the old one's signature": "and repaints rather than trusting the old signature",
  "a hold that never wakes the panel": "but the panel wakes itself once the hold has run out",
  "the hold read from the wrong setting": "a louder burst does not replace it while it is held",

  "a busy chat forgotten wholesale at the cap": "a chat too busy to remember in full is still measured in full",

  "a wake-up that comes straight away instead of at the end": "nor part of the way through the hold",
  "a second stream on one channel treated as the same chat": "but the same channel on a new video is a new chat",
  "an editor whose member emoji nobody notices": "a member emoji arriving rebuilds the bar",
  "a stale description cleared after the decision, not before": "and clears a stale description before deciding, not after",
  "a preset loaded without passing the name along": "and names the channel while it is there",

  "a badge read from anywhere in the chat": "a chat full of other people's members is not me",
  "a hidden chip read as not being a member": "a hidden chip still answers",
  "a page that has not answered read as a no": "no chip at all is not a no",
  "not knowing yet treated as not a member": "and a page that has not said yet refuses nothing",
  "a lock guessed before the channel is known": "with no channel known, nothing is refused",
  "a lapsed membership indistinguishable from the wrong channel": "and says that is what happened",
  "a locked card left where the sort put it": "the most-used card still goes last once it cannot be sent",
  "chat-driven order forgetting the lock": "and goes to the back when you cannot",
  "a refusal that is asked for and then ignored": "a member emoji you cannot send is not saved",
  "this chat's badge answering for another channel's emoji": "a badge here does not refuse another channel's emoji either",
  "a deck built without asking": "a deck built for someone who is not a member locks the card",
  "a panel that never hears about joining": "joining repaints the panel",
  "a held card exempt from the membership ending": "but loses it the moment the membership goes",
  "a chip that has to be hidden to count": "a chip on show answers the same way",
  "a badge read after the page has moved": "a membership found after the page moved does not answer for where we were",
  "a pool that never asks": "the pool locks what cannot be sent",
  "a pool that keeps a locked card where it was": "and puts it last there too",
  "an observer that is given something else to run": "the observer runs onPageChanged",
  "an observer deaf to a badge changing in place": "and watches attributes, not only nodes",
  "an offer that takes the answer on trust": "the panel does not offer what the page says you cannot send",
  "member emoji offered to someone who cannot send them": "nor this channel's while you are not a member"
};

const dir = mkdtempSync(join(tmpdir(), "oshideck-mutation-"));
const testPath = (name) => join(root, "tools", "tests", name);

function run(file, mutant, subject) {
  const env = mutant ? { ...process.env, [subject.env]: mutant } : process.env;
  try {
    execFileSync(process.execPath, [testPath(file)], { stdio: "pipe", env });
    return { failed: false, broke: [] };
  } catch (error) {
    // A real catch says FAIL for a case. A mutant that will not parse, or a
    // harness that cannot find its subject, says neither.
    const broke = String(error.stdout || "")
      .split("\n")
      .filter((line) => line.startsWith("FAIL ") && !line.includes("could not lift"));
    return { failed: true, broke };
  }
}

let failed = 0;

// A suite already red would make every mutation look caught.
for (const file of [CHANNEL, VISIBILITY, TREND, DRAW, CONFIRM, COLOUR, PRESET, MEMBER]) {
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

  const target = KILLS[name];
  if (!target) {
    console.log(`FAIL ${name} — does not say which assertion it must break`);
    failed = 1;
    continue;
  }

  const { broke } = run(file, mutant, subject);
  const caught = broke.some((line) => line.includes(target));

  console.log(`${caught ? "ok  " : "FAIL"} ${file.padEnd(20)} caught: ${name}`);
  if (!caught) {
    failed = 1;
    console.log(`     it had to break "${target}"; it broke ${broke.length ? broke.map((l) => JSON.stringify(l.slice(5, 60))).join(", ") : "nothing"}`);
  }
}

process.exit(failed);
