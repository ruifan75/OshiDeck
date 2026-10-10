// The words, and which one comes out.
//
// The table itself is checked by tools/check-i18n.mjs — that every key says it
// in every language, that nothing asks for a key that is not there, and that
// nothing is still written into the code. What is left for here is the part
// with decisions in it: which language answers, and what happens when the one
// asked for has nothing to say.
import { readFileSync } from "node:fs";
import { checkI18n } from "../check-i18n.mjs";

const src = process.env.OD_I18N
  ?? new URL("../../src/i18n.js", import.meta.url).pathname;

// A browser whose own language is not the source one. Without this the guess
// and the fallback are the same string, and a table that ignored the browser
// entirely would look exactly like one that asked it.
globalThis.chrome = { i18n: { getUILanguage: () => "zh-TW" } };
globalThis.OshiDeck = {};
await import(`file://${src}`);
const { i18n } = globalThis.OshiDeck;

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

/* ---------- which language answers ---------- */

check("asked for Japanese, Japanese", i18n.use("ja") === "ja");
check("asked for Traditional Chinese, that", i18n.use("zh-TW") === "zh-TW");

// Nobody has written Simplified, and Traditional is far closer to it than
// Japanese is. A reader of one can read the other; a reader of neither is no
// worse off than before.
check("a nearby Chinese falls to the Chinese there is", i18n.use("zh-CN") === "zh-TW");
check("and zh on its own does too", i18n.use("zh") === "zh-TW");

// English is written now, and a dialect of it is still English: en-US and
// en-GB are the same table, the way zh-CN reaches the Chinese there is.
check("asked for English, English", i18n.use("en") === "en");
check("and a dialect of it falls to the English there is", i18n.use("en-US") === "en");

// A language nobody has written falls to the source, which is a language.
check("and so does something nobody has heard of", i18n.use("xx") === "ja");

// A name every object answers to is not a language. `MESSAGES[key][code]`
// said yes to "toString", so it was taken for one — and then t() reached for
// that entry, found a function and called .replace on it. A backup carries
// the setting, so a file was enough to break the page.
// A refusal quotes the value it refused, and a file can hold one of any
// length with nothing to break it on. Bounded at 48, which is long enough for
// a channel id or a uuid to arrive whole — recognising which value it means
// is all the quote is there for.
{
  const long = i18n.t("validation.presetScopeInvalid", "x".repeat(400));
  check("a quoted value is bounded", long.length < 160 && long.includes("…"));
  check("while a channel id arrives whole",
    i18n.t("validation.presetChannelInvalid", "UCeqIMtLuGc3YgwkhEaG8oDg")
      .includes("UCeqIMtLuGc3YgwkhEaG8oDg"));
  check("and so does a uuid",
    i18n.t("validation.presetScopeInvalid", "f47ac10b-58cc-4372-a567-0e02b2c3d479")
      .includes("0e02b2c3d479"));
}

for (const borrowed of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
  check(`${borrowed} is not a language`, i18n.use(borrowed) === "ja");
  let said = null;
  try { said = i18n.t("bar.global"); } catch (_) { said = null; }
  check(`and asking for a word after it still answers`, typeof said === "string" && !!said);
}

/* ---------- what comes out ---------- */

i18n.use("ja");
check("Japanese is the Japanese", i18n.t("bar.global") === "共通");
i18n.use("zh-TW");
check("Chinese is the Chinese", i18n.t("bar.global") === "通用");

check("what goes in the hole comes out of it",
  i18n.t("count.cards", 7).includes("7"));
check("and the second hole is the second argument",
  i18n.t("preset.loadedReused", "さくら", 3).includes("さくら") &&
  i18n.t("preset.loadedReused", "さくら", 3).includes("3"));

// A hole with nothing for it should leave a gap, not the word "undefined" —
// and it has to be a message with *more* holes than arguments, since a call
// with no arguments at all never reaches the filling.
check("a hole nobody filled is empty, not 'undefined'",
  !i18n.t("preset.loadedReused", "さくら").includes("undefined"));

/* ---------- when it has nothing to say ---------- */

// A key nobody wrote is a bug in the code, and showing the key is how it gets
// noticed. Showing nothing would hide it; showing the source language would
// hide it too.
check("a key that does not exist says so", i18n.t("no.such.key") === "no.such.key");

// A missing *translation* is not a bug in the same way — the Japanese is still
// a sentence, and a sentence in the wrong language beats `bar.global`.
const { MESSAGES, SOURCE } = i18n;
const borrowed = { ...MESSAGES["bar.global"] };
delete MESSAGES["bar.global"]["zh-TW"];
i18n.use("zh-TW");
check("a missing translation falls through to the source, not to the key",
  i18n.t("bar.global") === borrowed[SOURCE]);
Object.assign(MESSAGES["bar.global"], borrowed);

/* ---------- and what the setting means ---------- */

// "" is not a language: it means nobody chose, and the browser's own is the
// opening guess. Reading it as a language would pin everyone to the source —
// and the browser here is in Chinese, so the two answers differ.
i18n.use("ja");
check("an empty setting goes back to guessing, not to the last choice",
  i18n.use("") === "zh-TW");
check("which is what the browser is in", i18n.current() === "zh-TW");

/* ---------- validator errors follow the display language ---------- */

await import(new URL("../../src/tokens.js", import.meta.url));
await import(process.env.OD_BACKUP ?? new URL("../../src/backup.js", import.meta.url).href);
await import(process.env.OD_PRESETS ?? new URL("../../src/presets.js", import.meta.url).href);
const { backup, presets } = globalThis.OshiDeck;
const CH = "UC" + "a".repeat(22);
const OTHER = "UC" + "b".repeat(22);
const text = (value = "hello") => [{ type: "text", value }];
const stamp = (channel) => [{ type: "youtubeEmoji", emojiId: `${channel}/wave` }];
const card = (over = {}) => ({ id: "card-a", tokens: text(), scope: "global", ...over });
const saved = (over = {}) => ({ cards: [card()], decks: {}, ...over });
const preset = (over = {}) => ({ name: "Test", cards: [{ tokens: text(), scope: "global" }], ...over });
const withPresetCard = (over) => preset({ cards: [{ tokens: text(), scope: "global", ...over }] });

check("valid backup and preset still return null",
  backup.validate(saved()) === null && presets.validate(preset()) === null);

// Check the reason and its arguments, rather than just that something failed.
// Each error is then displayed through the same wrapper used by options.js.
const cases = [
  [backup, [], ["validation.notObject"]],
  [backup, saved({ format: 99 }), ["validation.newBackupFormat", 99]],
  [backup, saved({ cards: null }), ["validation.cardsNotArray"]],
  [backup, saved({ decks: [] }), ["validation.decksInvalid"]],
  [backup, saved({ cards: [null] }), ["validation.cardInvalid"]],
  [backup, saved({ cards: [card({ id: "" })] }), ["validation.cardIdMissing"]],
  [backup, saved({ cards: [card({ id: 12 })] }), ["validation.cardIdMissing"]],
  [backup, saved({ cards: [card({ tokens: null })] }), ["validation.cardTokensMissing"]],
  [backup, saved({ cards: [card({ tokens: "hello" })] }), ["validation.cardTokensMissing"]],
  [backup, saved({ cards: [card({ tokens: [null] })] }), ["validation.cardTokenInvalid", "card-a"]],
  [backup, saved({ cards: [card({ tokens: text(12) })] }), ["validation.cardTextInvalid", "card-a"]],
  [backup, saved({ cards: [card({ tokens: [{ type: "youtubeEmoji" }] })] }), ["validation.emojiIdMissing", "card-a"]],
  [backup, saved({ cards: [card({ tokens: [{ type: "unknown" }] })] }), ["validation.tokenTypeUnknown", "card-a", "unknown"]],
  [backup, saved({ cards: [card(), card()] }), ["validation.cardIdDuplicate", "card-a"]],
  [backup, saved({ decks: { [CH]: null } }), ["validation.deckNotArray", CH]],
  [backup, saved({ decks: { [CH]: [12] } }), ["validation.deckIdInvalid", CH]],
  [backup, saved({ decks: { [CH]: ["absent"] } }), ["validation.deckCardMissing", CH]],
  [backup, saved({ decks: { [CH]: ["card-a", "card-a"] } }), ["validation.deckCardDuplicate", CH]],
  [backup, saved({ cards: [card({ scope: null })] }), ["validation.cardScopeInvalid", "card-a"]],
  [backup, saved({ cards: [card({ scope: "bad-scope" })] }), ["validation.cardScopeNotChannel", "card-a", "bad-scope"]],
  [backup, saved({ cards: [card({ tokens: stamp(CH) })] }), ["validation.cardEmojiScope", "card-a", CH, "global"]],
  [backup, saved({ cards: [card({ tokens: [...stamp(CH), ...stamp(OTHER)], scope: undefined })] }), ["validation.cardMixedChannels", "card-a"]],
  [backup, saved({ cards: [card({ tokens: stamp(CH), scope: CH })], decks: { [OTHER]: ["card-a"] } }), ["validation.deckEmojiChannel", "card-a", CH, OTHER]],
  [backup, saved({ cards: [card({ scope: CH })], decks: { [OTHER]: ["card-a"] } }), ["validation.deckScopeChannel", "card-a", CH, OTHER]],
  [presets, [], ["validation.notObject"]],
  [presets, preset({ format: 99 }), ["validation.newPresetFormat", 99]],
  [presets, preset({ name: "" }), ["validation.presetNameMissing"]],
  [presets, preset({ cards: [] }), ["validation.presetCardsEmpty"]],
  [presets, preset({ cards: null }), ["validation.presetCardsEmpty"]],
  [presets, preset({ cards: {} }), ["validation.presetCardsEmpty"]],
  [presets, preset({ channel: "bad-channel" }), ["validation.presetChannelInvalid", "bad-channel"]],
  [presets, preset({ cards: [null] }), ["validation.cardInvalid"]],
  [presets, withPresetCard({ tokens: null }), ["validation.presetTokensMissing"]],
  [presets, withPresetCard({ tokens: [] }), ["validation.presetTokensMissing"]],
  [presets, withPresetCard({ tokens: [null] }), ["validation.presetTokensMissing"]],
  [presets, withPresetCard({ tokens: ["hello"] }), ["validation.presetTokensMissing"]],
  [presets, withPresetCard({ tokens: text(12) }), ["validation.presetTokensMissing"]],
  [presets, withPresetCard({ tokens: [{ type: "youtubeEmoji", emojiId: "" }] }), ["validation.presetTokensMissing"]],
  [presets, withPresetCard({ tokens: text(" ") }), ["validation.presetCardEmpty"]],
  [presets, withPresetCard({ scope: "bad-scope" }), ["validation.presetScopeInvalid", "bad-scope"]],
  [presets, withPresetCard({ tokens: [...stamp(CH), ...stamp(OTHER)] }), ["validation.presetMixedChannels"]],
  [presets, withPresetCard({ tokens: stamp(CH) }), ["validation.presetChannelMissing"]],
  [presets, { ...withPresetCard({ tokens: stamp(OTHER) }), channel: CH }, ["validation.presetEmojiChannel", OTHER]],
  [presets, preset({ cards: [{ tokens: text(), scope: "global" }, { tokens: text(), scope: "global" }] }), ["validation.presetCardDuplicate"]]
];

for (const [validator, raw, expected] of cases) {
  i18n.use("ja");
  const problem = validator.validate(raw);
  let ok = JSON.stringify(problem) === JSON.stringify(expected);
  const rendered = [];
  for (const language of ["ja", "zh-TW"]) {
    i18n.use(language);
    ok &&= JSON.stringify(validator.validate(raw)) === JSON.stringify(expected);
    const entry = MESSAGES[expected[0]]?.[language];
    for (const wrapper of ["opt.cannotRead", "opt.cannotExport"]) {
      const message = i18n.t(wrapper, problem);
      ok &&= !!entry && message.includes(entry.split("$")[0]) &&
        !message.includes("validation.") && !/\$\d|undefined|\[object Object\]/.test(message) &&
        expected.slice(1).every((value) => message.includes(String(value)));
      if (language === "zh-TW") ok &&= !/[぀-ヿ]/.test(message);
      rendered.push(message);
    }
  }
  ok &&= rendered[0] !== rendered[2];
  check(`${validator === backup ? "backup" : "preset"}: ${expected[0]} translates at display time`, ok);
}

const future = backup.validate(saved({ format: 99 }));
i18n.use("zh-TW");
check("a Chinese status includes a Chinese validation reason and its format number",
  i18n.t("opt.cannotRead", future) === "無法載入：這份備份使用較新的格式。請先更新 OshiDeck，再載入檔案。（format: 99）");
i18n.use("ja");
check("the same error switches back to Japanese without revalidating",
  i18n.t("opt.cannotRead", future) === "読み込めません: このバックアップは新しい形式です。OshiDeckを更新してから読み込んでください。（format: 99）");
i18n.use("zh-TW");
check("interpolated file data is literal, even when it resembles a placeholder",
  i18n.t("opt.cannotRead", ["validation.cardScopeNotChannel", "card-$2", "scope-$1"]) ===
    "無法載入：有一張牌的適用範圍設定有誤。通用牌請指定 global；頻道專用牌請指定有效的頻道 ID。（牌: card-$2／scope: scope-$1）");
check("a malformed file value resembling an error tuple stays literal",
  i18n.t("opt.cannotRead", presets.validate(preset({ channel: ["validation.notObject"] }))) ===
    "無法載入：無法辨識這份預組的頻道。請指定有效的頻道 ID。（channel: validation.notObject）");

/* ---------- one of something ---------- */

// English needs a different word at one and the counting languages do not, so
// the choice is written into the string that needs it. The caller passes a
// number and nothing else: `count === 1 ? ... : ...` in content.js would be
// English grammar in a file no translator opens.
i18n.use("en");
check("one card is a card", i18n.t("count.cards", 1) === "1 card");
check("and two are cards", i18n.t("count.cards", 2) === "2 cards");
check("and none are cards", i18n.t("count.cards", 0) === "0 cards");
// 1.5 is one and a half of them, not one of them. The floor on these is a
// whole second, but the step above it is not.
check("and one and a half are cards", i18n.t("opt.holdNote", 1.5) ===
  "A drawn card stays for 1.5 seconds.");
check("the shortest hold the settings allow still reads as one second",
  i18n.t("opt.holdNote", 1) === "A drawn card stays for 1 second.");

// The counting languages never see the choice, and must not grow a stray
// space where the English has one.
i18n.use("ja");
check("Japanese counts with its own counter and no choice", i18n.t("count.cards", 1) === "1枚");
i18n.use("zh-TW");
check("and so does Chinese", i18n.t("count.cards", 1) === "1 張");

// Everything else is a plain $1, which is 235 of these.
i18n.use("en");
check("a placeholder with no choice after it is just the value",
  i18n.t("preset.loadedReused", "Sakura Miko", 3) ===
    "Added \u201cSakura Miko\u201d (3 already in your pool)");

/* ---------- refusals explain recovery before the diagnostic ---------- */

for (const language of ["ja", "zh-TW"]) {
  i18n.use(language);
  const recovery = language === "ja" ? /。.*ください/ : /。.*請/;
  for (const key of new Set(cases.map(([, , [key]]) => key))) {
    const entry = MESSAGES[key][language];
    const at = entry.lastIndexOf("（");
    const sentence = entry.slice(0, at);
    check(`${language}: ${key} gives a recovery before its trailing diagnostic`,
      at > 0 && entry.endsWith("）") && recovery.test(sentence) &&
      !/\$\d/.test(sentence) &&
      !/\b(?:JSON|format|cards|decks|id|tokens|value|emojiId|type|scope)\b/.test(sentence));
  }

  // The validators deliberately share these reasons across several shapes.
  // Their wording must cover both empty and unreadable data, not diagnose
  // an existing list as a missing field or a non-list as an empty list.
  const tokensReason = i18n.t("validation.presetTokensMissing");
  const cardsReason = i18n.t("validation.presetCardsEmpty");
  const backupTokensReason = i18n.t("validation.cardTokensMissing");
  const emptyOrUnreadable = language === "ja" ? /空.*読み取れ/ : /空.*無法讀取/;
  const unreadable = language === "ja" ? /読み取れ/ : /無法讀取/;
  check(`${language}: shared preset reasons cover empty and unreadable data`,
    emptyOrUnreadable.test(tokensReason) && emptyOrUnreadable.test(cardsReason));
  check(`${language}: a non-list backup content field is described as unreadable`,
    unreadable.test(backupTokensReason) && !/空|ありません|缺少/.test(backupTokensReason));

  const duplicate = i18n.t("validation.presetCardDuplicate");
  check(`${language}: duplicate preset cards have both matching content and scope`,
    language === "ja" ? /同じ内容・同じ保存範囲/.test(duplicate)
      : /內容和適用範圍相同/.test(duplicate));

  // Unset and empty values are real validator arguments. They must not leave
  // an apparently unfinished sentence, and ordinary UI holes stay empty.
  for (const [problem, field] of [
    [presets.validate(withPresetCard({ scope: undefined })), "scope"],
    [presets.validate(withPresetCard({ scope: "" })), "scope"],
    [presets.validate(preset({ channel: null })), "channel"],
    [presets.validate(preset({ channel: "" })), "channel"],
    [backup.validate(saved({ cards: [card({ tokens: [{}] })] })), "type"]
  ]) {
    const message = i18n.t("opt.cannotRead", problem);
    check(`${language}: an absent ${field} value stays readable in its diagnostic`,
      message.includes(`${field}: —`) &&
      !/\$\d|undefined|validation\./.test(message));
  }
  check(`${language}: ordinary missing arguments still leave an empty hole`,
    i18n.t("count.cards", undefined) === i18n.t("count.cards", ""));

  // Both save targets take this path and share its space with Undo. Keep the
  // compact summary independent of the caller's longer success caption.
  const summaries = ["saved.global", "saved.channel"].map((key) =>
    i18n.t("saved.similar", i18n.t(key)));
  check(`${language}: both similar-card save notices keep the compact save and warning`,
    summaries[0] === summaries[1] &&
    (language === "ja" ? /保存しました.*似た札/.test(summaries[0])
      : /已儲存.*相近的牌/.test(summaries[0])));
}

/* ---------- the checker sees errors behind the status wrappers ---------- */

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
function audit(file, before, after) {
  const source = file ? read(file) : "";
  if (file && !source.includes(before)) throw new Error(`missing checker fixture: ${before}`);
  const output = [];
  const bad = checkI18n({
    ...i18n,
    read: (path) => path === file ? source.replace(before, after) : read(path),
    report: (message) => output.push(message)
  });
  return { bad, output: output.join("\n") };
}

check("the full i18n audit is green", audit().bad === 0);
for (const file of ["src/backup.js", "src/presets.js"]) {
  const before = 'return ["validation.notObject"];';
  const japanese = audit(file, before, 'return "JSONオブジェクトではありません";');
  check(`${file}: the checker catches a Japanese validator error`,
    japanese.bad > 0 && japanese.output.includes(`${file}:`));
  const english = audit(file, before, 'return "Not a JSON object";');
  check(`${file}: a hardcoded English error also fails`,
    english.bad > 0 && english.output.includes("not text"));
  const unknown = audit(file, before, 'return ["validation.notThere"];');
  check(`${file}: an unknown validator key fails`,
    unknown.bad > 0 && unknown.output.includes("知らない key: validation.notThere"));
}
const missingTranslation = {
  ...MESSAGES,
  "validation.notObject": { ja: MESSAGES["validation.notObject"].ja }
};
check("validator translations are required in every language",
  checkI18n({ ...i18n, MESSAGES: missingTranslation, read, report: () => {} }) > 0);

// A choice only means anything attached to a number. Loose, or cut into more
// pieces than English has, t() leaves it alone and the braces reach the bar.
const withChoice = (en) => checkI18n({
  ...i18n,
  MESSAGES: { ...MESSAGES, "count.cards": { ...MESSAGES["count.cards"], en } },
  read,
  report: () => {}
});
check("the audit is green with the choice written as it is", withChoice("$1{card|cards}") === 0);
check("a choice not attached to a number fails", withChoice("{card|cards} $1") > 0);
check("and one cut into three pieces fails", withChoice("$1{card|cards|more}") > 0);

process.exit(fail);
