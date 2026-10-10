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
const I18N = "i18n-test.mjs";
const EMOJI = "emoji-test.mjs";
const STORED = "store-test.js";

// Which file a mutation edits, and how its test is told to load the copy.
const CONTENT = { file: "content.js", env: "OD_SOURCE" };
const TRENDING = { file: "src/trending.js", env: "OD_TRENDING" };
const LAYOUT = { file: "src/layout.js", env: "OD_LAYOUT" };
const TOKENS = { file: "src/tokens.js", env: "OD_TOKENS" };
const OPTIONS = { file: "options.js", env: "OD_OPTIONS" };
const STORE = { file: "src/store.js", env: "OD_STORE" };
const PRESETS = { file: "src/presets.js", env: "OD_PRESETS" };
const I18NSRC = { file: "src/i18n.js", env: "OD_I18N" };
// Not JavaScript, so `node --check` has nothing to say about it. Twice now a
// decision made correctly in JS was painted over by a rule in CSS, which no
// test could see.
const STYLE = { file: "content.css", env: "OD_CSS", js: false };

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
    "if (!peekOwner || peekOwner.isConnected) return false;",
    "if (true) return false;"],

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
    "      mine.length, offered.length, waiting, presetsOnHand(channel?.id).length,",
    "      mine.length, offered.length, waiting,"],

  [VISIBILITY, CONTENT, "a panel that never actually skips",
    `    if (next === painted && rootEl.firstChild) {
      // Nothing else changed, so nothing else needs drawing — but the bar is
      // still showing a description of something that is gone.
      if (dropped) refreshBar();
      return;
    }`,
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

  [PRESET, PRESETS, "another channel's member emoji carried into a preset",
    "      if (required.length && !required.every((id) => id === channelId)) continue;",
    "      if (false) continue;"],

  [PRESET, PRESETS, "a preset that carries member emoji without saying whose",
    "      if (required.length) bound = true;",
    "      if (false) bound = true;"],

  [PRESET, PRESETS, "member emoji accepted into a preset that names nobody",
    `      if (required.length && !raw.channel) {
        return ["validation.presetChannelMissing"];
      }`,
    "      // (allowed)"],

  [I18N, I18NSRC, "a quoted file value of any length at all",
    "        return shown.length > QUOTED_MAX ? `${shown.slice(0, QUOTED_MAX)}…` : shown;",
    "        return shown;"],

  [I18N, I18NSRC, "a language borrowed from Object.prototype",
    "    if (LANGUAGES.some((lang) => lang.code === code)) return code;",
    '    if (MESSAGES["bar.global"][code]) return code;'],

  [I18N, I18NSRC, "a validator reason left untranslated inside a translated status",
    '      Array.isArray(value) && typeof value[0] === "string" && value[0].startsWith("validation.")',
    '      false && Array.isArray(value) && typeof value[0] === "string" && value[0].startsWith("validation.")'],

  [I18N, I18NSRC, "a validator reason losing its arguments",
    "        ? t(...value)",
    "        ? t(value[0])"],

  [I18N, I18NSRC, "file data mistaken for a nested validator error",
    `      !String(key).startsWith("validation.") &&\n`,
    ""],

  [PRESET, PRESETS, "a preset offered to channels it was never for",
    "  const offeredOn = (preset, channelId) => !preset?.channel || preset.channel === channelId;",
    "  const offeredOn = () => true;"],

  [PRESET, STORE, "a preset forced onto a channel that cannot send it",
    "        if (required.length && !required.every((id) => id === channelId)) continue;",
    "        if (false) continue;"],

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
    "      normal: 30_000,\n      short: 15_000",
    "      normal: 20_000,\n      short: 15_000"],

  [DRAW, STORE, "a wave redefined without saying so",
    "      normal: { min: 6, share: 0.30 },",
    "      normal: { min: 3, share: 0.10 },"],

  [DRAW, STORE, "an unset step falling through to nothing",
    "    return TUNING[group]?.[chosen] ?? TUNING[group]?.normal;",
    "    return TUNING[group]?.[chosen];"],

  [VISIBILITY, CONTENT, "the skip decided after the panel has been torn down",
    `    if (next === painted && rootEl.firstChild) {
      // Nothing else changed, so nothing else needs drawing — but the bar is
      // still showing a description of something that is gone.
      if (dropped) refreshBar();
      return;
    }
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
    "      mine.length, offered.length, waiting, presetsOnHand(channel?.id).length,",
    "      offered.length, waiting, presetsOnHand(channel?.id).length,"],

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

  [PRESET, CONTENT, "a preset loaded without passing the name along",
    "      cards: presets.cardsFor(preset, channelId)",
    "      cards: presets.cardsFor(preset, channelId), name: undefined"],

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

  [MEMBER, STORE, "one use count shared by every channel",
    "  const countOn = (card, channelId) => (channelId && card.by?.[channelId]) || noCount();",
    "  const countOn = (card) => Object.values(card.by || {})[0] || noCount();"],

  [MEMBER, CONTENT, "a locked card left where the sort put it",
    "      return playableFirst(store.sortCards(cards, settings.sortBy, channelId));",
    "      return store.sortCards(cards, settings.sortBy, channelId);"],

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
    "    const ready = playableFirst(markLocked(cards, channelId, membership()));",
    "    const ready = playableFirst(markLocked(cards, channelId, true));"],

  [MEMBER, CONTENT, "a pool that keeps a locked card where it was",
    "    const ready = playableFirst(markLocked(cards, channelId, membership()));\n",
    "    const ready = markLocked(cards, channelId, membership());\n"],

  [MEMBER, CONTENT, "an observer that is given something else to run",
    "    const watcher = new Observer(onPageChanged);",
    "    const watcher = new Observer(() => {});"],

  [MEMBER, CONTENT, "an observer deaf to a badge changing in place",
    `      childList: true, subtree: true, attributes: true, attributeFilter: ["type"]`,
    "      childList: true, subtree: true"],

  [MEMBER, CONTENT, "an observer that watches one branch instead of the tree",
    `      childList: true, subtree: true, attributes: true, attributeFilter: ["type"]`,
    `      childList: true, subtree: false, attributes: true, attributeFilter: ["type"]`],

  [MEMBER, CONTENT, "an observer pointed at nothing",
    "  const observer = watchPage(document.documentElement);",
    "  const observer = watchPage({ nodeType: 1 });"],

  [MEMBER, CONTENT, "a stale lock overriding an answer the page can give",
    `    const why = here && member !== null
      ? whyNotSendable(card.tokens || [], here, member)
      : (card.locked ? (card.lapsed ? "membership" : "elsewhere") : "");`,
    `    const why = whyNotSendable(card.tokens || [], here, member) ||
      (card.locked ? (card.lapsed ? "membership" : "elsewhere") : "");`],

  [MEMBER, CONTENT, "a press that goes out unchecked",
    "    const why = here && member !== null",
    "    const why = false && here && member !== null"],

  [MEMBER, CONTENT, "the card checked and the comment sent",
    `    if (willSend && whyNotSendable(tokens.collectTokens(input), here, member)) {
      sending = false;
      return showToast(t("toast.leftover"));
    }
`, ""],

  [MEMBER, CONTENT, "a pool built for nobody",
    "    const mine = buildPool(data, channel?.id);",
    "    const mine = buildPool(data, null);"],

  [MEMBER, CONTENT, "an offer made about no channel at all",
    "poolOpen ? null : offerFromChat(deck, channel);",
    "poolOpen ? null : offerFromChat(deck, null);"],

  [DRAW, CONTENT, "an offer that refuses a page which has not answered",
    "    return drawFromChat(deck, { channelId: channel?.id, member: membership() });",
    "    return drawFromChat(deck, { channelId: channel?.id, member: membership() === true });"],

  [VISIBILITY, CONTENT, "a skip that can never hold",
    "    const next = panelSignature(data, channel, hue, shown, mine, offered, waiting, drawn);",
    "    const next = panelSignature(data, channel, hue, shown, mine, offered, waiting, drawn);\n    painted = null;"],

  // Counted together, a card leaving the pool as the preset starts offering
  // it moves one from each side and leaves the total alone — so the panel saw
  // nothing happen and the bar kept the tab counts from before.
  [VISIBILITY, CONTENT, "the way in counting entries instead of cards",
    "    return new Set([...mine, ...offered].map((card) => card.id)).size;",
    "    return mine.length + offered.length;"],

  [VISIBILITY, CONTENT, "two halves of the pool counted as one",
    "      mine.length, offered.length, waiting, presetsOnHand(channel?.id).length,",
    "      mine.length + offered.length, waiting, presetsOnHand(channel?.id).length,"],

  // One ask that nothing answered used to settle the question for the life of
  // the page.
  [PRESET, CONTENT, "a failed ask remembered as an answer",
    "    const unanswered = () => { asked.delete(channelId); };",
    "    const unanswered = () => {};"],

  [VISIBILITY, CONTENT, "a drawn card given nothing to press",
    `  function drawnTools(card) {
    const tools = document.createElement("div");
    tools.className = "od-card-tools";`,
    `  function drawnTools(card) {
    const tools = document.createElement("div");
    tools.className = "od-card-tools";
    return tools;`],

  [DRAW, CONTENT, "an offer that takes the answer on trust",
    "    return drawFromChat(deck, { channelId: channel?.id, member: membership() });",
    "    return drawFromChat(deck, { channelId: channel?.id, member: true });"],

  [I18N, I18NSRC, "a language nobody wrote answered with keys",
    "    const text = entry ? entry[current] || entry[SOURCE] : key;",
    "    const text = entry ? entry[current] || key : key;"],

  [I18N, I18NSRC, "a missing key answered with silence instead of its name",
    "    const text = entry ? entry[current] || entry[SOURCE] : key;",
    '    const text = entry ? entry[current] || entry[SOURCE] : "";'],

  [I18N, I18NSRC, "a nearby language given up on",
    "    const near = LANGUAGES.find((lang) => lang.code.split(\"-\")[0].toLowerCase() === primary);\n    return near ? near.code : SOURCE;",
    "    return SOURCE;"],

  [I18N, I18NSRC, "an unset language pinned to whatever was chosen last",
    '  const use = (want) => (current = want ? resolve(want) : fromBrowser());',
    "  const use = (want) => (current = resolve(want) || current);"],

  [I18N, I18NSRC, "a hole left saying undefined",
    '      ? text.replace(/\\$(\\d)/g, (_, n) => String(args[Number(n) - 1] ?? ""))',
    "      ? text.replace(/\\$(\\d)/g, (_, n) => String(args[Number(n) - 1]))"],

  [PRESET, OPTIONS, "the pool's stripe left on the stylesheet's default hue",
    '  el.style.setProperty("--hue", hueOf(selected));',
    '  if (where === "deck") el.style.setProperty("--hue", hueOf(selected));'],

  [PRESET, OPTIONS, "the stripe read from the stamps instead of the scope",
    "  if (store.scopeOf(card) === store.GLOBAL) el.dataset.universal = \"true\";",
    "  if (!tokens.requiredChannels(card.tokens).length) el.dataset.universal = \"true\";"],

  // The same hole as the bar's, in the page's own cache: one unanswered ask
  // and the channel was never offered a preset again.
  [PRESET, OPTIONS, "the builder remembering an answer of no",
    "    if (!reply?.ok || !Array.isArray(reply.value)) return [];",
    "    if (!reply?.ok || !Array.isArray(reply.value)) { bundled.set(channelId, []); return []; }"],

  [PRESET, OPTIONS, "a file taken in without asking whose it is",
    "  if (!presets.offeredOn(raw, selected)) return status(t(\"opt.importNotForHere\"));",
    "  if (false) return status(t(\"opt.importNotForHere\"));"],

  [PRESET, OPTIONS, "a file taken in without being read first",
    "  if (problem) return status(t(\"opt.cannotRead\", problem));",
    "  if (false) return status(t(\"opt.cannotRead\", problem));"],

  [EMOJI, TOKENS, "an owner prefix read as a membership on its own",
    "      if (!needsMembership(token)) continue;",
    "      if (false) continue;"],

  [EMOJI, TOKENS, "an underscore looked for anywhere in the shortcut",
    "  const MEMBERS_ONLY = /^:_/;",
    "  const MEMBERS_ONLY = /_/;"],

  [EMOJI, TOKENS, "a card from before the shortcut existed read as free",
    "    return !shortcut || MEMBERS_ONLY.test(shortcut);",
    "    return MEMBERS_ONLY.test(shortcut);"],

  [EMOJI, TOKENS, "a shortcut that does not survive the editor",
    `    if (token.sharedTooltipText && !preview) {
      img.setAttribute("shared-tooltip-text", token.sharedTooltipText);
    }
`, ""],

  [EMOJI, TOKENS, "a standard emoji kept as an emoji token",
    '      if (current.tagName === "IMG") return pushText(current.getAttribute("alt") || "");',
    '      if (current.tagName === "IMG") return tokens.push({ type: "youtubeEmoji", emojiId: current.getAttribute("alt") || "" });'],

  [EMOJI, TOKENS, "a card face handing YouTube a tooltip to float",
    "    if (token.sharedTooltipText && !preview) {",
    "    if (token.sharedTooltipText) {"],

  [EMOJI, TOKENS, "the chat editor given pictures instead of characters",
    "    if (!preview) { frag.appendChild(document.createTextNode(text)); return; }",
    "    if (false) { frag.appendChild(document.createTextNode(text)); return; }"],

  [EMOJI, TOKENS, "flags and keycaps left as text for not being pictographic",
    "  const IS_EMOJI = /\\p{Extended_Pictographic}|[\\u{1F1E6}-\\u{1F1FF}]|\\u20E3/u;",
    "  const IS_EMOJI = /\\p{Extended_Pictographic}/u;"],

  [EMOJI, TOKENS, "a picture asked for per code point rather than per emoji",
    "    for (const { segment } of segmenter.segment(text || \"\")) {",
    "    for (const segment of [...(text || \"\")]) {"],

  [EMOJI, TOKENS, "the variation selector kept in the filename",
    "      .filter((ch) => ch !== \"\\uFE0F\")",
    "      .filter(() => true)"],

  [EMOJI, TOKENS, "a code point left unpadded",
    "      .map((ch) => ch.codePointAt(0).toString(16).padStart(4, \"0\"))",
    "      .map((ch) => ch.codePointAt(0).toString(16))"],

  [EMOJI, TOKENS, "a standard emoji claiming an owner",
    "    img.setAttribute(\"alt\", grapheme);",
    "    img.setAttribute(\"alt\", grapheme);\n    img.setAttribute(\"data-emoji-id\", grapheme);"],

  [EMOJI, TOKENS, "an emoji with no picture left as a broken image",
    "      img.replaceWith(document.createTextNode(grapheme));",
    "      /* left showing nothing */"],

  [VISIBILITY, CONTENT, "the bar spelling a card out instead of carrying it",
    "    return { key: tokens.cardKey(list), tokens: list };",
    "    return { text: tokens.toPlainText(list).trim() };"],

  [VISIBILITY, CONTENT, "a card's contents written into the bar as text",
    '    if (list) readout.appendChild(tokens.toFragment(list, { preview: true }));\n    else readout.textContent = text;',
    '    readout.textContent = text || tokens.toPlainText(list || []);'],

  [VISIBILITY, CONTENT, "the bar's stamps built the way the editor's are",
    "tokens.toFragment(list, { preview: true })",
    "tokens.toFragment(list)"],

  [VISIBILITY, CONTENT, "a card drawn in full when it is one thing repeated",
    "    tokens.repeated(card.tokens || []) || { unit: card.tokens || [], times: 0 };",
    "    ({ unit: card.tokens || [], times: 0 });"],

  [VISIBILITY, CONTENT, "the count not taking any room on the card",
    "    ) + (times ? TIMES_WIDTH : 0);",
    "    ) + 0;"],

  [VISIBILITY, TOKENS, "a doubled word counted as a chant",
    "    (unit.length > 1 && ENDS_AN_UTTERANCE.test(unit[unit.length - 1].key));",
    "    unit.length > 1;"],

  [VISIBILITY, TOKENS, "a chant left as a wall of characters",
    "  const saidAgain = (unit) =>\n    unit.every((atom) => atom.picture) ||\n    (unit.length > 1 && ENDS_AN_UTTERANCE.test(unit[unit.length - 1].key));",
    "  const saidAgain = (unit) => unit.every((atom) => atom.picture);"],

  [VISIBILITY, TOKENS, "a terminator on its own read as something said",
    "    (unit.length > 1 && ENDS_AN_UTTERANCE",
    "    (unit.length > 0 && ENDS_AN_UTTERANCE"],

  [VISIBILITY, TOKENS, "the unit left in the pieces it was taken apart into",
    '        if (atom.token.type === "text" && last?.type === "text") last.value += atom.token.value;',
    "        if (false) last.value += atom.token.value;"],

  [VISIBILITY, TOKENS, "the longest repeating unit taken instead of the shortest",
    "    for (let size = 1; size <= atoms.length / 2; size++) {",
    "    for (let size = Math.floor(atoms.length / 2); size >= 1; size--) {"],

  [VISIBILITY, CONTENT, "a stamp measured by its width alone, not the room it takes",
    "  const EMOJI_WIDTH = 3;",
    "  const EMOJI_WIDTH = 2;"],

  [VISIBILITY, CONTENT, "an emoji measured by the length of its name",
    "      (wide, token) => wide + (token.type === \"text\" ? textWidth(token.value) : EMOJI_WIDTH),",
    "      (wide, token) => wide + (token.type === \"text\" ? textWidth(token.value) : (token.alt || \"\").length),"],

  [VISIBILITY, CONTENT, "an emoji in a sentence counted by its characters",
    "    tokens.splitEmoji((value || \"\").trim())\n      .reduce((wide, part) => wide + (part.emoji ? EMOJI_WIDTH : part.value.length), 0);",
    "    (value || \"\").trim().length;"],

  [VISIBILITY, CONTENT, "an empty description treated as something to say",
    "    const said = peekKey(next) ? next : null;",
    "    const said = next;"],

  [VISIBILITY, CONTENT, "no way into the pool from anywhere",
    "      if (waiting) {",
    "      if (false) {"],

  [VISIBILITY, STYLE, "the pool painting over the scope stripe",
    '#oshideck-root[data-pool="true"] .od-card,',
    '#oshideck-root[data-pool="true"] .od-card::before { background: var(--od-common); }\n#oshideck-root[data-pool="true"] .od-card,'],

  [VISIBILITY, CONTENT, "the hand reordered under the pointer",
    "    if (frozen) { pendingRender = true; return; }",
    "    if (false) { pendingRender = true; return; }"],

  [VISIBILITY, CONTENT, "a notice left sitting over the controls it names",
    "    if (notice) clearNotice();",
    "    if (false) clearNotice();"],

  [MEMBER, CONTENT, "a preset's cards never offered from the pool",
    "      for (const source of preset.cards || []) {",
    "      for (const source of []) {"],

  [MEMBER, CONTENT, "a card you own offered as a copy of itself",
    "        if (family) { offered.push({ ...family[0] }); continue; }",
    "        if (family) { offered.push({ ...family[0], id: `preset:${key}` }); continue; }"],

  // Asked by id, the preset went on offering the other copy of something the
  // deck already said — and pressing it put the same words in twice.
  [MEMBER, CONTENT, "what the hand says asked about by id rather than wording",
    "        if (inDeck.has(key)) continue; // the hand says it already",
    "        if (false) continue; // the hand says it already"],

  // The press itself. Everything else looks at the entry the pool built; the
  // add could go out under the wording and leave all of it true.
  [MEMBER, CONTENT, "a card added by what it says instead of which card it is",
    '    const { ok } = await store.apply("addToDeck", { channelId: channel.id, cardId: card.id });',
    '    const { ok } = await store.apply("addToDeck", { channelId: channel.id, cardId: tokens.cardKey(card.tokens || []) });'],

  [MEMBER, CONTENT, "an offer that is a different card every render",
    "                       id: `preset:${key}`, offered: source });",
    "                       id: `preset:${key}:${Math.random()}`, offered: source });"],

  [MEMBER, CONTENT, "the pool's scope stripe left grey on every card",
    "    for (const card of ready) card.bound = store.scopeOf(card) !== store.GLOBAL;",
    "    for (const card of ready) card.bound = false;"],

  [MEMBER, CONTENT, "a refusal with nothing to show for it where it happened",
    '      if (card.id) flashCard(card.id, "refused");',
    "      if (false) flashCard(card.id);"],

  [STORED, STORE, "a setting taken on trust, whatever it says",
    "      data.settings = { ...data.settings, ...cleanSettings(patch) };",
    "      data.settings = { ...data.settings, ...patch };"],

  [STORED, STORE, "a custom time left unbounded",
    "  const clampTime = (ms) => Math.min(LONGEST, Math.max(SHORTEST, Math.round(ms)));",
    "  const clampTime = (ms) => Math.round(ms);"],

  [DRAW, STORE, "a number of milliseconds read as a step name",
    "    if (BY_TIME.has(group) && typeof chosen === \"number\" && Number.isFinite(chosen)) {",
    "    if (false) {"],

  [STORED, STORE, "counts split only in the shape storage happens to be in",
    "    const whole = cards.filter(readable);\n    for (const card of whole) splitCounts(card, decks);",
    "    const whole = cards.filter(readable);"],

  [STORED, STORE, "a shelved card losing a count its scope could have placed",
    "    const where = held.length ? held : (scope === GLOBAL ? [] : [scope]);",
    "    const where = held;"],

  [STORED, STORE, "a deck list taken on trust while counts are migrated",
    "      .filter(([, ids]) => Array.isArray(ids) && ids.includes(card.id))",
    "      .filter(([, ids]) => (ids || []).includes(card.id))"],

  [STORED, TOKENS, "a token list walked before it is known to be a list",
    "    for (const token of Array.isArray(tokenList) ? tokenList : []) {",
    "    for (const token of tokenList || []) {"],

  [MEMBER, CONTENT, "the save path calling anything with the same words a duplicate",
    `      // existed on this channel, and nothing had been saved.
      if (!store.usableOn(card, channelId)) continue;`,
    `      // existed on this channel, and nothing had been saved.
      if (false) continue;`],

  [STORED, STORE, "an edit written without checking it is one",
    "      if (!wholeTokens(tokens)) return false;",
    "      if (false) return false;"],

  [STORED, STORE, "a card added that the next read would drop",
    "      if (!card || typeof card !== \"object\" || !wholeTokens(card.tokens)) return false;",
    "      if (false) return false;"],

  [STORED, STORE, "the oldest shape reading a card before it is one",
    "        if (!card || typeof card !== \"object\") continue;",
    "        if (false) continue;"],

  [STORED, STORE, "a card that is not a card carried into the panel",
    "    const whole = cards.filter(readable);",
    "    const whole = cards;"],

  [STORED, STORE, "a deck that is not a list read as one",
    "      if (!Array.isArray(ids)) { decks[channelId] = []; continue; }",
    "      if (false) { decks[channelId] = []; continue; }"],

  [STORED, STORE, "a file applied without the worker checking it",
    "      const wrong = OD.backup.validate(raw);\n      if (wrong) return false;",
    "      const wrong = null;\n      if (wrong) return false;"],

  [PRESET, PRESETS, "a token read before it is known to be one",
    "      if (!shapedCard(card)) return [\"validation.presetTokensMissing\"];",
    "      if (false) return [\"validation.presetTokensMissing\"];"],

  [PRESET, PRESETS, "two cards of the same words told apart by nothing",
    '      const key = `${card.scope === "channel" ? "channel" : "global"}\\u0000${OD.tokens.cardKey(card.tokens)}`;',
    "      const key = OD.tokens.cardKey(card.tokens);"],

  [STORED, STORE, "settings handed to a page without being checked",
    "      return { ...DEFAULT_SETTINGS, ...cleanSettings(raw?.[KEYS.SETTINGS]) };",
    "      return { ...DEFAULT_SETTINGS, ...(raw?.[KEYS.SETTINGS] || {}) };"],

  [STORED, STORE, "a file's settings taken as written",
    "      settings: { ...DEFAULT_SETTINGS, ...cleanSettings(raw[KEYS.SETTINGS]) },",
    "      settings: { ...DEFAULT_SETTINGS, ...(raw[KEYS.SETTINGS] || {}) },"],

  [STORED, STORE, "a setting accepted because it was written down",
    "      if (ALLOWED[key].includes(value)) clean[key] = value;",
    "      clean[key] = value;"],

  [STORED, STORE, "the same wording called a duplicate wherever it lives",
    "        (c) => OD.tokens.cardKey(c.tokens) === key && usableOn(c, channelId));",
    "        (c) => OD.tokens.cardKey(c.tokens) === key);"],

  [MEMBER, CONTENT, "an offer suppressed by a card that cannot be sent here",
    `    const owned = new Map(); // wording -> the cards here that say it
    for (const card of data.cards) {
      if (!store.usableOn(card, channelId)) continue;`,
    `    const owned = new Map(); // wording -> the cards here that say it
    for (const card of data.cards) {
      if (false) continue;`],

  [STORED, STORE, "an old count handed to every channel, not the decks holding it",
    "      .filter(([, ids]) => Array.isArray(ids) && ids.includes(card.id))",
    "      .filter(() => true)"],

  [STORED, STORE, "a count already split overwritten by the flat one it replaced",
    "    if (Object.keys(card.by || {}).length) return card;",
    "    if (false) return card;"],

  [STORED, STORE, "the flat count left on the card beside the split one",
    "    delete card.uses; delete card.heat; delete card.lastUsedAt;",
    "    /* kept */"],

  [TREND, TRENDING, "messages pruned at a fixed ninety seconds",
    "      const cutoff = Date.now() - windowMs();",
    "      const cutoff = Date.now() - 90_000;"],

  [TREND, TRENDING, "the ranking cut off at a fixed ninety seconds",
    "      const cutoff = now - windowMs();",
    "      const cutoff = now - 90_000;"],

  [TREND, TRENDING, "a long pace allowed unbounded captured history",
    "  const RECENT_MAX = 600;",
    "  const RECENT_MAX = Infinity;"],

  [TREND, TRENDING, "a short pace pruning a burst before it finishes",
    "Math.max(BURST_MS, halfLife() * WINDOW_HALF_LIVES)",
    "halfLife() * WINDOW_HALF_LIVES"],

  [VISIBILITY, STYLE, "a channel save target that refuses to shrink",
    ".od-save-channel {\n  min-width: 0;\n  flex-shrink: 1;\n}",
    ".od-save-channel {\n  min-width: 0;\n  flex-shrink: 0;\n}"],

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
  "a setting taken on trust, whatever it says": "a step that was never offered is refused too",
  "a custom time left unbounded": "too short is pulled up to a second",
  "a number of milliseconds read as a step name": "a hold given in milliseconds is used as given",
  "counts split only in the shape storage happens to be in": "a v0.3 card keeps the count it arrived with",
  "a shelved card losing a count its scope could have placed": "a channel-only card in no deck keeps its count anyway",
  "a file's settings taken as written": "a file's settings are cleaned when they are read",
  "a setting accepted because it was written down": "a mode nobody offers is refused",
  "the same wording called a duplicate wherever it lives": "saving it on another channel is not a duplicate",
  "an offer suppressed by a card that cannot be sent here": "so the preset still offers it here",
  "an old count handed to every channel, not the decks holding it": "a card in no deck has nowhere to put it",
  "a count already split overwritten by the flat one it replaced": "and a card already counted per channel is left alone",
  "the flat count left on the card beside the split one": "and the card stops carrying one of its own",
  "messages pruned at a fixed ninety seconds": "a ten-minute pace decays smoothly across the old 90-second cutoff",
  "the ranking cut off at a fixed ninety seconds": "a ten-minute pace decays smoothly across the old 90-second cutoff",
  "a long pace allowed unbounded captured history": "even the longest pace retains at most 600 captured messages",
  "a short pace pruning a burst before it finishes": "the shortest pace still keeps a burst for its full window",
  "a channel save target that refuses to shrink": "the channel save target can shrink below its long name",
  "an out-of-gamut hue clipped instead of desaturated": "every hue survives the round trip",
  "a card held for a different time than anyone was told": "out of the box a card is held for 30 seconds",
  "a wave redefined without saying so": "a wave is six messages and three tenths of the room",
  "an unset step falling through to nothing": "an unset step falls back to the middle one",

  "another channel's member emoji carried into a preset": "another channel's are still left behind",
  "a preset that carries member emoji without saying whose": "and the preset says whose they are",
  "a quoted file value of any length at all": "a quoted value is bounded",
  "a language borrowed from Object.prototype": "toString is not a language",
  "a deck list taken on trust while counts are migrated": "and a count migrates past a deck that is not a list",
  "a token list walked before it is known to be a list": "a tokens field that cannot be walked is dropped, not fatal",
  "the save path calling anything with the same words a duplicate": "a card of the same words tied elsewhere is not a duplicate here",
  "an edit written without checking it is one": "an edit to nothing is refused",
  "a card added that the next read would drop": "a card of nothing is not added",
  "the oldest shape reading a card before it is one": "and a null beside a card in the oldest shape is skipped",
  "a card that is not a card carried into the panel": "the card that is not a card is dropped",
  "a deck that is not a list read as one": "a deck that is not a list reads as empty",
  "a file applied without the worker checking it": "a file the validator refuses is refused here too",
  "a token read before it is known to be one": "an emoji with no id is reported, not thrown",
  "two cards of the same words told apart by nothing": "a deck with both kinds of the same words exports",
  "settings handed to a page without being checked": "a page asking for settings alone gets them checked",
  "a validator reason left untranslated inside a translated status": "a Chinese status includes a Chinese validation reason",
  "a validator reason losing its arguments": "a Chinese status includes a Chinese validation reason",
  "file data mistaken for a nested validator error": "a malformed file value resembling an error tuple stays literal",
  "member emoji accepted into a preset that names nobody": "nor can they ride in a preset that names nobody",
  "a preset offered to channels it was never for": "and nowhere else",
  "a preset forced onto a channel that cannot send it": "forced onto another channel, only what can be sent there loads",
  "the pool's stripe left on the stylesheet's default hue": "a card in the pool wears the deck's colour",
  "the stripe read from the stamps instead of the scope": "a card tied to a channel by its words is not universal here",
  "a file taken in without asking whose it is": "a file for another channel is refused, not half-loaded",
  "a file taken in without being read first": "a file that is not a preset is refused",
  "a preset that carries its ids along with its content": "no ids, no counts, no history",
  "channel-only losing its meaning on the way in": "and channel-only means the channel it is loaded into",
  "a card that works only elsewhere counted as a match": "a card that only works on another channel is not treated as a match",
  "one wording allowed only one card": "a usable card is found even behind one that is not",
  "a preset that loads without learning the name": "loading a preset also names the channel",

  "the skip decided after the panel has been torn down": "and does it before tearing the panel down",
  "a card becoming channel-only going unnoticed": "a card becoming channel-only is",
  "a card that can no longer be played looking the same": "and a card becoming unplayable here is",
  "the channel name left out of the signature": "the channel being named at last is a change",
  "a pool that can gain a card unnoticed": "saving a card the preset already offers is a change",
  "two halves of the pool counted as one":
    "a card crossing from one half of the pool to the other is a change",
  "a failed ask remembered as an answer": "an ask nothing answered is asked again",
  "the builder remembering an answer of no":
    "and after one the worker itself could not answer",
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
  "a preset loaded without passing the name along": "and names the channel while it is there",

  "a badge read from anywhere in the chat": "a chat full of other people's members is not me",
  "a hidden chip read as not being a member": "a hidden chip still answers",
  "a page that has not answered read as a no": "no chip at all is not a no",
  "not knowing yet treated as not a member": "and a page that has not said yet refuses nothing",
  "a lock guessed before the channel is known": "with no channel known, nothing is refused",
  "a lapsed membership indistinguishable from the wrong channel": "and says that is what happened",
  "one use count shared by every channel": "a habit on one channel does not order another",
  "a locked card left where the sort put it": "the most-used card still goes last once it cannot be sent",
  "chat-driven order forgetting the lock": "and goes to the back when you cannot",
  "a refusal that is asked for and then ignored": "a member emoji you cannot send is not saved",
  "this chat's badge answering for another channel's emoji": "a badge here does not refuse another channel's emoji either",
  "a deck built without asking": "a deck built for someone who is not a member locks the card",
  "a panel that never hears about joining": "joining repaints the panel",
  "a held card exempt from the membership ending": "but loses it the moment the membership goes",
  "a chip that has to be hidden to count": "a chip on show answers the same way",

  "an owner prefix read as a membership on its own": "a card of free emoji names nobody",
  "an underscore looked for anywhere in the shortcut": "an underscore in the middle is not the mark",
  "a card from before the shortcut existed read as free": "a card saved before the shortcut was collected still asks for a membership",
  "a shortcut that does not survive the editor": "writing a card keeps the shortcut with it",
  "a standard emoji kept as an emoji token": "a standard emoji comes back as text",
  "the bar spelling a card out instead of carrying it": "the bar carries the card's own tokens",
  "a card's contents written into the bar as text": "the bar draws the stamps rather than naming them",
  "the bar's stamps built the way the editor's are": "the way a card face draws them, not the way the editor does",
  "an empty description treated as something to say": "a peek with nothing in it leaves the bar to the deck",
  "no way into the pool from anywhere": "the way in is in the bar",
  "the pool painting over the scope stripe": "the pool does not paint over the scope stripe",
  "the hand reordered under the pointer": "the pointer on the panel holds the redraw",
  "a notice left sitting over the controls it names": "typing clears a notice that was in the way",
  "a preset's cards never offered from the pool": "the whole preset is offered, not what is left of it",
  "a card you own offered as a copy of itself": "as the card you own, not a copy of it",
  "what the hand says asked about by id rather than wording":
    "a preset does not offer what the hand already says",
  "a card added by what it says instead of which card it is":
    "pressing the card you own puts that very card in the deck",
  "the way in counting entries instead of cards": "a card in both halves is one card to add",
  "an offer that is a different card every render": "and the same offer has the same id every time",
  "the pool's scope stripe left grey on every card": "and a card of your own in the pool shows its scope too",
  "a refusal with nothing to show for it where it happened": "and marks the card that was pressed",
  "a card drawn in full when it is one thing repeated": "five of the same stamp draw as one picture and a count",
  "the count not taking any room on the card": "the count takes room on the card too",
  "a doubled word counted as a chant": "and a word that is a doubling",
  "a chant left as a wall of characters": "a chant with a terminator is counted",
  "a terminator on its own read as something said": "but a mark on its own is not something said",
  "the unit left in the pieces it was taken apart into": "and the unit keeps its mark",
  "the longest repeating unit taken instead of the shortest": "six of one stamp is six, not three twice",
  "a stamp measured by its width alone, not the room it takes": "seven shrink again, and that is the step that fades",
  "an emoji measured by the length of its name": "three stamps are nine wide, not twenty-one",
  "an emoji in a sentence counted by its characters": "a stamp inside text is a picture, not its characters",

  "a card face handing YouTube a tooltip to float": "but a card face hands YouTube nothing to pop up",
  "the chat editor given pictures instead of characters": "and the chat editor is still given the characters",
  "flags and keycaps left as text for not being pictographic": "a flag is a picture even though its letters are not",
  "a picture asked for per code point rather than per emoji": "a skin tone belongs to the hand in front of it",
  "the variation selector kept in the filename": "the variation selector is dropped",
  "a code point left unpadded": "a short code point is padded to four digits",
  "a standard emoji claiming an owner": "a standard picture claims no owner",
  "an emoji with no picture left as a broken image": "an emoji with no picture falls back to the character",

  "a language nobody wrote answered with keys": "a missing translation falls through to the source",
  "a missing key answered with silence instead of its name": "a key that does not exist says so",
  "a nearby language given up on": "a nearby Chinese falls to the Chinese there is",
  "an unset language pinned to whatever was chosen last": "an empty setting goes back to guessing",
  "a hole left saying undefined": "a hole nobody filled is empty",
  "a badge read after the page has moved": "a membership found after the page moved does not answer for where we were",
  "a pool that never asks": "the pool locks what cannot be sent",
  "a pool that keeps a locked card where it was": "and puts it last there too",
  "an observer that is given something else to run": "the observer is given the function that hears a membership change",
  "an observer deaf to a badge changing in place": "and a badge changing what it is",
  "an observer that watches one branch instead of the tree": "the whole tree under it",
  "an observer pointed at nothing": "and it is the document that is watched",
  "a stale lock overriding an answer the page can give": "a lock left over from before is not the answer once the page can give one",
  "a press that goes out unchecked": "and says which kind of no it is",
  "the card checked and the comment sent": "a plain card does not carry out what is already in the editor",
  "a pool built for nobody": "the pool is built for the channel we are on",
  "an offer made about no channel at all": "and the offer is made about it too",
  "an offer that refuses a page which has not answered": "and a page that cannot answer yet does not refuse",
  "a skip that can never hold": "and nothing rewrites the record in between",
  "a drawn card given nothing to press": "a drawn card is handed something to press",
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
for (const file of [CHANNEL, VISIBILITY, TREND, DRAW, CONFIRM, COLOUR, PRESET, MEMBER, I18N, EMOJI, STORED]) {
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

  const mutant = join(dir, `${name.replace(/\W+/g, "-")}.${subject.js === false ? "css" : "js"}`);
  writeFileSync(mutant, source.replace(find, replace));

  if (subject.js !== false) {
    try {
      execFileSync(process.execPath, ["--check", mutant], { stdio: "pipe" });
    } catch (_) {
      console.log(`FAIL ${name} — the mutation does not parse, so nothing was tested`);
      failed = 1;
      continue;
    }
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
