// The journal has to stay small and stay readable: a stream open for an hour
// must not push the interesting entry off the end, and a report must not carry
// anything the viewer wrote.
globalThis.OshiDeck = {};
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => ({}),
  set: async () => {}
} } };
await import(new URL("../../src/journal.js", import.meta.url).href);
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
  log = journal.append(log, entry({ at: i, video: "v".repeat(10) + i }));
}
check("the log is capped", log.length === journal.LIMIT);
check("and it is the OLDEST that is dropped", log[log.length - 1].at === journal.LIMIT + 119);

/* --- what a report actually carries -------------------------------------- */

const text = journal.format(
  [entry(), { at: 2000, kind: "unresolved", video: "zzzzzzzzzzz", ownerBlock: "none", cards: 0 }],
  "9.9.9"
);
check("the file names the version", text.includes("9.9.9"));
check("undefined fields are left out", !text.includes("undefined"));
check("a repeat of one is not shown", !journal.line(entry()).includes("×"));
check("a real repeat is shown", journal.line(entry({ repeat: 12 })).includes("×12"));

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
