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

// The bundled presets, read once. They are the extension's own file, so the
// worker reads it rather than exposing it to youtube.com through
// web_accessible_resources — a content script would need that, and nothing on
// the page has any business with this.
let bundled = null;

async function readPresets() {
  if (bundled) return bundled;
  try {
    const response = await fetch(chrome.runtime.getURL("presets/presets.json"));
    const raw = await response.json();
    // Hand-edited, so a broken one is skipped by name rather than taking the
    // rest down with it.
    bundled = (Array.isArray(raw) ? raw : []).filter((preset) => !presets.validate(preset));
  } catch (_) {
    bundled = [];
  }
  return bundled;
}

// The toolbar button. With no `action` in the manifest there is no button to
// press, and with no popup declared the press arrives here — which is what we
// want, since everything this extension has to configure lives on one page.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === "presets") {
    readPresets().then((list) => respond({ ok: true, value: list }), () => respond({ ok: false }));
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
      if (message.clear) return chrome.storage.local.remove(journal.KEY);
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
