// The timeline keeps its newest entries within a fixed cap. Repeated adjacent
// observations merge, and a report must not carry anything the viewer wrote.
globalThis.OshiDeck = {};
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => ({}),
  set: async () => {}
} } };
await import(new URL("../../src/i18n.js", import.meta.url).href);
await import(process.env.OD_JOURNAL ? `file://${process.env.OD_JOURNAL}` : new URL("../../src/journal.js", import.meta.url).href);
const { journal } = globalThis.OshiDeck;

let fail = 0;
const check = (l, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + l); };

const entry = (over = {}) =>
  ({ at: 1000, kind: "channel", video: "abcdefghijk", id: "UC" + "a".repeat(22), via: "meta", ...over });

/* --- the same observation, over and over --------------------------------- */

let log = [];
for (let i = 0; i < 50; i++) log = journal.append(log, entry({ at: 1000 + i }));
check("a repeated observation stays one entry", log.length === 1);
check("and counts the repeats", log[0].repeat === 50);
check("keeping the newest time", log[0].at === 1049);

/* --- a real change ------------------------------------------------------- */

log = journal.append(log, entry({ at: 2000, id: "UC" + "b".repeat(22) }));
check("a different channel is a new entry", log.length === 2);
check("the first entry keeps its count", log[0].repeat === 50);

// Back to the first: the run was broken, so this is a new observation.
log = journal.append(log, entry({ at: 3000 }));
check("returning to an earlier channel records it again", log.length === 3);

/* --- the cap ------------------------------------------------------------- */

log = [];
for (let i = 0; i < journal.LIMIT + 120; i++) {
  log = journal.append(log, entry({ at: i, video: String(i).padStart(11, "v") }));
}
check("the log is capped", log.length === journal.LIMIT);
check("and it is the OLDEST that is dropped", log[log.length - 1].at === journal.LIMIT + 119);

/* --- what a report actually carries -------------------------------------- */

const text = journal.format(
  [entry(), { at: 2000, kind: "unresolved", video: "zzzzzzzzzzz", ownerBlock: "none", cards: 0 }],
  "9.9.9"
);
check("the file names the version", text.includes("9.9.9"));
const unavailable = journal.snapshot(null);
check("an unavailable store is not described as an empty deck", unavailable.status === "failed" && unavailable.reason === "storage-read" && !("cards" in unavailable));
check("old stored diagnostic contents are filtered at export",
  !journal.format([entry({ name: "private wording", message: "private wording", tokens: ["private wording"] })], "test").includes("private wording"));
check("undefined fields are left out", !text.includes("undefined"));
check("a repeat of one is not shown", !journal.line(entry()).includes("×"));
check("a real repeat is shown", journal.line(entry({ repeat: 12 })).includes("×12"));

for (const language of ["ja", "zh-TW", "en"]) {
  globalThis.OshiDeck.i18n.use(language);
  const disclosure = globalThis.OshiDeck.i18n.t("ui.journalPrivacy");
  check(`${language}: the export explains identifiers and membership before sharing`,
    journal.format([], "test").includes(disclosure) &&
    ({ ja: ["チャンネルID", "動画ID", "メンバー", "共有前"],
      "zh-TW": ["頻道 ID", "影片 ID", "會員", "分享前"],
      en: ["channel", "video IDs", "membership", "before sharing"] })[language]
      .every((word) => disclosure.includes(word)));
}

/* --- signature is what makes dedupe work --------------------------------- */

check(
  "time and count are not part of identity",
  journal.signature(entry({ at: 5, repeat: 9 })) === journal.signature(entry({ at: 900 }))
);
check(
  "the source that answered IS part of identity",
  journal.signature(entry()) !== journal.signature(entry({ via: "owner-link" }))
);

process.exit(fail);
