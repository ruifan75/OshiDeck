// The single writer.
//
// Content scripts and the options page both want to change stored state, and
// chrome.storage has no compare-and-set: two contexts can each finish reading
// before either writes, and the loser's change vanishes. So neither writes.
// They send a named operation here, and this worker — one context, one queue —
// applies them strictly one at a time.
import "./src/tokens.js";
import "./src/backup.js";
import "./src/store.js";
import "./src/journal.js";

const { store, journal } = globalThis.OshiDeck;

let queue = Promise.resolve();

// Serialises regardless of how the operation ends, so one failure cannot
// wedge every later write.
function enqueue(work) {
  const result = queue.then(work, work);
  queue = result.then(() => {}, () => {});
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
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
