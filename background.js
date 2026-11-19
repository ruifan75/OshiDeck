// The single writer.
//
// Content scripts and the options page both want to change cards/settings, and
// chrome.storage has no compare-and-set: two contexts can each finish reading
// before either writes, and the loser's change vanishes. So neither writes.
// They send a named operation here, and this worker — one context, one queue —
// applies them strictly one at a time.
import "./src/i18n.js";
import "./src/tokens.js";
import "./src/backup.js";
import "./src/store.js";
import "./src/journal.js";
import "./src/presets.js";
import "./src/privacy.js";
import "./src/vault.js";

const { store, journal, presets, privacy, vault } = globalThis.OshiDeck;
const localData = vault || chrome.storage.local;
const storeKeys = Object.values(store.KEYS);

let queue = Promise.resolve();

// Serialises regardless of how the operation ends, so one failure cannot
// wedge every later write.
function enqueue(work) {
  const result = queue.then(work, work);
  queue = result.then(() => {}, () => {});
  return result;
}

// Diagnostics touch separate keys and have their own queue. Even a log write
// that never settles cannot hold up the queue for cards/settings.
// Several observations can share a write. A failed write keeps the bounded
// batch in memory, available to an export or the next retry.
let pendingLog = [];
let logQueued = false;
let logQueue = Promise.resolve();
function enqueueLog(work) {
  const result = logQueue.then(work, work);
  logQueue = result.then(() => {}, () => {});
  return result;
}
async function flushLog() {
  logQueued = false;
  if (!pendingLog.length) return;
  const batch = pendingLog;
  pendingLog = [];
  try {
    const raw = await localData.get([journal.KEY, journal.STATE_KEY]);
    await localData.set({
      [journal.KEY]: batch.reduce(journal.append, raw[journal.KEY]),
      [journal.STATE_KEY]: journal.states(raw[journal.STATE_KEY], batch)
    });
  } catch (_) {
    pendingLog = [...batch, ...pendingLog].slice(-journal.LIMIT);
  }
}
function queueLog(entry) {
  const clean = journal.clean(entry);
  if (!clean) return;
  pendingLog.push(clean);
  pendingLog = pendingLog.slice(-journal.LIMIT);
  if (!logQueued) {
    logQueued = true;
    enqueueLog(flushLog);
  }
}
journal.setSink(queueLog);
let recording = false;
function observeWorker() {
  if (recording) return;
  recording = true;
  journal.observe("worker");
}
if (!privacy) observeWorker();

async function mutate(message) {
  const op = message.op;
  const args = message.args && typeof message.args === "object" ? message.args : {};
  const started = performance.now();
  let reply;
  try {
    reply = Object.hasOwn(store.OPS, op)
      ? await store.runOp(op, args) : { ok: false, reason: "unknown-op" };
  } catch (error) {
    reply = { ok: false, reason: "exception" };
    journal.record({ kind: "error", op, reason: "exception", stage: "apply", errorType: error?.name });
  }
  if (op !== "decksHolding") {
    journal.record({ kind: "operation", op, channelId: args.channelId,
      card: journal.cardId(reply.value?.id ?? args.id ?? args.cardId ?? args.movedId ?? args.card?.id ?? args.snapshot?.card?.id),
      status: reply.ok ? "ok" : "failed", reason: reply.reason,
      added: typeof reply.value?.added === "number" ? reply.value.added : undefined,
      duplicate: reply.value?.duplicate, reused: reply.value?.reused, count: reply.value?.count,
      linked: reply.value?.linked, importMode: op === "importBackup" ? args.mode : undefined,
      durationMs: Math.round(performance.now() - started) });
    if (reply.ok && op === "setSettings") journal.record({ kind: "settings", settings: reply.value });
  }
  return reply;
}

// One file per channel, and an index naming them.
//
// It was a single file holding every preset, fetched and parsed whole on
// every cold start. That file grows with the number of channels anyone has
// ever mined, while what one viewer needs stays at one preset: at 262 it was
// a megabyte, and the list it is built from runs to 2893 active channels.
// Now the worker reads an index of a few tens of kilobytes and then the one
// file the channel in front of you asks for.
//
// The worker reads them rather than exposing them to youtube.com through
// web_accessible_resources — a content script would need that, and nothing
// on the page has any business with this.
let index = null;

async function readIndex() {
  if (index) return index;
  try {
    const response = await fetch(chrome.runtime.getURL("presets/index.json"));
    const raw = await response.json();
    index = Array.isArray(raw?.presets) ? raw.presets : [];
    journal.record({ kind: "preset", source: "bundled", stage: "read",
      status: Array.isArray(raw?.presets) ? "loaded" : "index-invalid", count: index.length });
  } catch (_) {
    index = [];
    journal.record({ kind: "preset", source: "bundled", stage: "read", status: "index-unreadable" });
  }
  return index;
}

// A name from the index becomes a url, so it has to be a name and not a path.
const NAMED = /^[A-Za-z0-9_-]+\.json$/;

// Read once each, and remembered either way: a file that is missing or
// broken should be asked for once, not on every render.
const bundled = new Map();

async function readPreset(file) {
  if (bundled.has(file)) return bundled.get(file);

  let preset = null;
  if (NAMED.test(file)) {
    try {
      const response = await fetch(chrome.runtime.getURL(`presets/${file}`));
      const raw = await response.json();
      // Hand-edited, so a broken one is skipped rather than taking the rest
      // down with it.
      const problem = presets.validate(raw);
      preset = problem ? null : raw;
      journal.record({ kind: "preset", source: "bundled", channelId: raw?.channel,
        stage: "validate", status: problem ? "invalid" : "loaded", code: problem?.[0],
        cards: preset?.cards.length });
    } catch (_) {
      journal.record({ kind: "preset", source: "bundled", stage: "fetch", status: "unreadable",
        channelId: file.slice(0, -5) });
    }
  } else {
    journal.record({ kind: "preset", source: "bundled", stage: "validate", status: "invalid" });
  }

  bundled.set(file, preset);
  return preset;
}

// Only what this channel could be offered. An entry naming no channel is
// offered anywhere, which is what offeredOn says on the other side.
async function readPresets(channelId) {
  const wanted = (await readIndex())
    .filter((entry) => entry && (!entry.channel || entry.channel === channelId));
  const got = await Promise.all(wanted.map((entry) => readPreset(entry.file)));
  if (!wanted.length) journal.record({ kind: "preset", source: "bundled", channelId, status: "absent" });
  return got.filter(Boolean);
}

// The toolbar button. With no `action` in the manifest there is no button to
// press, and with no popup declared the press arrives here — which is what we
// want, since everything this extension has to configure lives on one page.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onInstalled?.addListener(async ({ reason }) => {
  if (["install", "update"].includes(reason) && !await privacy.enabled()) {
    await chrome.runtime.openOptionsPage();
  }
});

async function openDeckOptions(message) {
  const { channelId, name } = message;
  if (typeof channelId !== "string" || !/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }
  // A channel with no saved cards still needs a deck to edit. Use the same
  // writer queue as card saves, so opening it cannot overwrite a concurrent save.
  const reply = await enqueue(() => mutate({ op: "ensureDeck", args: { channelId, name } }));
  if (!reply.ok) return reply;
  await chrome.tabs.create({
    url: `${chrome.runtime.getURL("options.html")}?channel=${encodeURIComponent(channelId)}`
  });
  return { ok: true };
}

function handleMessage(message, respond) {
  if (message?.type === "presets") {
    readPresets(message.channelId)
      .then((list) => respond({ ok: true, value: list }), () => respond({ ok: false }));
    return true; // respond asynchronously
  }

  if (message?.type === "openOptions") {
    openDeckOptions(message).then(respond, () => respond({ ok: false }));
    return true;
  }

  // Only diagnostics use these keys. Card mutations never write them.
  if (message?.type === "journal") {
    if (message.read === true) {
      enqueueLog(async () => {
        let raw = {};
        try { raw = await localData.get([journal.KEY, journal.STATE_KEY]); } catch (_) { /* use pending */ }
        const entries = (Array.isArray(raw[journal.KEY]) ? raw[journal.KEY] : []).reduce(journal.append, []);
        return { ok: true, value: pendingLog.reduce(journal.append, entries),
          states: journal.states(raw[journal.STATE_KEY], pendingLog) };
      }).then(respond, () => respond({ ok: false }));
      return true;
    }
    enqueueLog(async () => {
      // Exactly true. `clear: "false"` is a string, and a string is enough to
      // throw the diagnostics away on the way to asking for them.
      if (message.clear === true) {
        const before = pendingLog;
        pendingLog = [];
        try {
          await localData.remove([journal.KEY, journal.STATE_KEY]);
        } catch (error) {
          pendingLog = [...before, ...pendingLog].slice(-journal.LIMIT);
          throw error;
        }
        journal.reset();
        return;
      }
      const entry = journal.clean(message.entry);
      if (!entry) return;
      pendingLog.push(entry);
      pendingLog = pendingLog.slice(-journal.LIMIT);
      await flushLog();
    }).then(() => respond({ ok: true }), (error) => respond({ ok: false, error: String(error) }));
    return true; // respond asynchronously
  }

  if (message?.type === "mutate") {
    enqueue(() => mutate(message))
      .then(respond, (error) => respond({ ok: false, error: String(error) }));
    return true; // respond asynchronously
  }

  return false;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!privacy) return handleMessage(message, respond);
  const failed = () => respond({ ok: false });
  if (message?.type === "enablePrivacy") {
    if (sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL("options.html")) return false;
    enqueue(async () => {
      await vault.enable([...storeKeys, journal.KEY, journal.STATE_KEY]);
      observeWorker();
      return { ok: true };
    }).then(respond, failed);
    return true;
  }
  privacy.enabled().then((allowed) => {
    if (!allowed) return failed();
    observeWorker();
    if (message?.type === "readStorage") {
      const keys = Array.isArray(message.keys) ? message.keys : [message.keys];
      if (!keys.every((key) => storeKeys.includes(key))) return failed();
      vault.get(keys).then((value) => respond({ ok: true, value }), failed);
    } else if (!handleMessage(message, respond)) {
      failed();
    }
  }, failed);
  return true;
});
