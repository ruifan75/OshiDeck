// The single writer.
//
// Content scripts and the options page both want to change stored state, and
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

const { store, journal, presets } = globalThis.OshiDeck;

let queue = Promise.resolve();

// Serialises regardless of how the operation ends, so one failure cannot
// wedge every later write.
function enqueue(work) {
  const result = queue.then(work, work);
  queue = result.then(() => {}, () => {});
  return result;
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
  } catch (_) {
    index = [];
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
      preset = presets.validate(raw) ? null : raw;
    } catch (_) { /* missing or unreadable */ }
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
  return got.filter(Boolean);
}

// The toolbar button. With no `action` in the manifest there is no button to
// press, and with no popup declared the press arrives here — which is what we
// want, since everything this extension has to configure lives on one page.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === "presets") {
    readPresets(message.channelId)
      .then((list) => respond({ ok: true, value: list }), () => respond({ ok: false }));
    return true; // respond asynchronously
  }

  if (message?.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    respond({ ok: true });
    return false;
  }

  // Through the same queue as everything else: a log entry written beside a
  // card operation could otherwise drop it.
  if (message?.type === "journal") {
    enqueue(async () => {
      // Exactly true. `clear: "false"` is a string, and a string is enough to
      // throw the diagnostics away on the way to asking for them.
      if (message.clear === true) return chrome.storage.local.remove(journal.KEY);
      const raw = await chrome.storage.local.get(journal.KEY);
      return chrome.storage.local.set({
        [journal.KEY]: journal.append(raw[journal.KEY], message.entry)
      });
    }).then(() => respond({ ok: true }), (error) => respond({ ok: false, error: String(error) }));
    return true; // respond asynchronously
  }

  if (message?.type === "mutate") {
    enqueue(() => store.runOp(message.op, message.args))
      .then(respond, (error) => respond({ ok: false, error: String(error) }));
    return true; // respond asynchronously
  }

  return false;
});
