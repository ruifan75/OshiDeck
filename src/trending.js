// Watches the live chat and keeps a rolling count of what people are posting,
// so cards matching the current wave can float to the front.
(() => {
  const OD = (globalThis.OshiDeck ||= {});
  const { collectTokens, harvestEmoji } = OD.tokens;

  const WINDOW_MS = 90_000;
  const RECENT_MAX = 600;
  const NOTIFY_MS = 8_000; // reordering more often than this is just noise

  const DECORATION = /[!\uFF01?\uFF1F~\u301C\u30FC\u30FB.\u3002,\u3001;\uFF1B:\uFF1A\u266A\u2606\u2605\u5F61*_+\-()\uFF08\uFF09\u300C\u300D]+/g;
  const SPACES = /[\s\u3000]+/g;
  const EMOJI_MARK = "\u0001"; // keeps an emoji id from colliding with text
  const JOINER = "\u0002";

  const clean = (text) =>
    text.toLowerCase().replace(SPACES, "").replace(DECORATION, "");

  // One atom per character or per emoji, so a run of emoji and a run of "8"
  // collapse by the same rule and an emoji is never split by the text rules.
  function atoms(tokenList) {
    const out = [];
    for (const token of tokenList || []) {
      if (token.type === "text") {
        for (const ch of clean(token.value || "")) out.push(ch);
      } else if (token.type === "youtubeEmoji" && token.emojiId) {
        out.push(EMOJI_MARK + token.emojiId);
      }
    }
    return out;
  }

  // Every length of the same reaction is that reaction: 8, 88 and 88888888
  // all reduce to one atom, and so does a run of the same emoji.
  function collapseRuns(list, max = 1) {
    const out = [];
    let run = 0;
    for (let i = 0; i < list.length; i++) {
      run = i > 0 && list[i] === list[i - 1] ? run + 1 : 0;
      if (run < max) out.push(list[i]);
    }
    return out;
  }

  // A call repeated any number of times is that call once.
  function collapseCycle(list, max = 1) {
    const n = list.length;
    for (let k = 1; k <= n / 2; k++) {
      if (n % k) continue;
      let repeats = true;
      for (let i = k; i < n && repeats; i++) repeats = list[i] === list[i % k];
      if (repeats) return list.slice(0, k * Math.min(max, n / k));
    }
    return list;
  }

  const signature = (tokenList) =>
    collapseCycle(collapseRuns(atoms(tokenList))).join(JOINER);

  /* ---------- the watcher ---------- */

  function createWatcher({ onChange } = {}) {
    let recent = [];
    let observer = null;
    let host = null;
    let notifyTimer = null;
    let dirty = false;

    const findHost = () =>
      document.querySelector("yt-live-chat-item-list-renderer #items") ||
      document.querySelector("#chat #items") ||
      document.querySelector("#item-scroller #items");

    function record(node) {
      // Every message is a chance to refresh an emoji url, whatever the mode.
      harvestEmoji(node);

      const message = node.querySelector?.("#message");
      if (!message) return;

      const sig = signature(collectTokens(message));
      if (!sig) return;

      recent.push({ sig, at: Date.now() });
      if (recent.length > RECENT_MAX) recent = recent.slice(-RECENT_MAX);
      dirty = true;
    }

    function notify() {
      // Entries ageing out of the window changes the order just as much as new
      // ones arriving. Without this the panel stayed sorted by a burst that
      // ended minutes ago, because nothing else was going to trigger a render.
      const before = recent.length;
      const expired = prune() !== before;

      if (!dirty && !expired) return;
      dirty = false;
      onChange?.();
    }

    function prune() {
      const cutoff = Date.now() - WINDOW_MS;
      recent = recent.filter((entry) => entry.at >= cutoff);
      return recent.length;
    }

    function start() {
      const found = findHost();
      if (!found || found === host) return !!host;

      observer?.disconnect();
      host = found;
      observer = new MutationObserver((records) => {
        for (const entry of records) {
          for (const node of entry.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) record(node);
          }
        }
      });
      observer.observe(host, { childList: true });

      clearInterval(notifyTimer);
      notifyTimer = setInterval(notify, NOTIFY_MS);
      return true;
    }

    function stop() {
      observer?.disconnect();
      clearInterval(notifyTimer);
      observer = null;
      host = null;
    }

    // signature -> how many messages carried it inside the window
    function ranking() {
      prune();
      const counts = new Map();
      for (const entry of recent) counts.set(entry.sig, (counts.get(entry.sig) || 0) + 1);
      return counts;
    }

    return { start, stop, ranking, get attached() { return !!host; } };
  }

  OD.trending = { signature, createWatcher, WINDOW_MS };
})();
