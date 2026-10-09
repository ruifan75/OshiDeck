// Watches the live chat and keeps a rolling count of what people are posting,
// so cards matching the current wave can float to the front.
(() => {
  const OD = (globalThis.OshiDeck ||= {});
  const { cardKey, collectTokens, harvestEmoji } = OD.tokens;

  // How far back messages are kept at all. With the decay below, anything
  // this old is worth about 4% of a message arriving now, so falling out of
  // the window is no longer a visible event — it is a bound on memory.
  const WINDOW_MS = 90_000;

  // What actually decides the order, when the panel has not said otherwise:
  // it passes the `pace` setting in, and this is the same as that setting's
  // middle step. A wave loses half its weight every half-life, so one that
  // ended a minute ago cannot hold the front against one happening now — 40
  // claps from 80 seconds ago are worth about 2.5, so three fresh messages
  // overtake them. A flat count could not do that: after a burst of applause
  // the next song would start and the applause was still first, because every
  // message in the window counted the same right up to the moment it fell off
  // the end.
  const HALF_LIFE_MS = 20_000;

  const RECENT_MAX = 600;

  // Just the times, for the share. Keeping wording costs memory, so `recent`
  // is capped at 600 — but that cap was also the denominator, so in a chat
  // fast enough to fill it inside twelve seconds a reaction looked like a far
  // larger share of the room than it was. Numbers are cheap, so the count of
  // what was said is kept separately and much further back. The numerator
  // still comes from `recent`, so an extreme chat understates a share rather
  // than inventing one — the safe direction.
  const SAID_MAX = 4000;

  // A burst is not the same as popular. Offering a card is about catching a
  // wave as it breaks, so it counts plain repetitions over a few seconds
  // rather than the decayed weight above — and it counts them by exact
  // wording, because `きちゃ` and `きちゃきちゃ` are not the same thing to say
  // even though the ordering deliberately treats them as one reaction.
  const BURST_MS = 12_000;

  // Two tests, because neither alone means anything. A plain count cannot
  // know how busy the chat is: four of a thing was a wave in a quiet room and
  // ordinary noise in a busy one, and it was the busy one that kept offering
  // things nobody was rallying behind. A share alone is worse — in a nearly
  // silent chat the first two messages are 100% of it.
  //
  // So: enough of it to be a wave anywhere, AND most of what is being said.
  // A real wave looks like this; people stop saying other things.
  const BURST_MIN = 6;
  const BURST_SHARE = 0.3;

  // Reordering is throttled because cards moving is disruptive, not because it
  // is expensive — and the pointer is protected separately, by freezing while
  // it rests on the deck. Each tick costs a storage read and a relayout, and
  // only in chat-driven mode.
  const NOTIFY_MS = 4_000;

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

  // `tuning` says what the viewer has chosen. The constants above remain the
  // answer when nobody has said otherwise, so the watcher still works standing
  // on its own — which is how the tests drive it.
  function createWatcher({ onChange, tuning = () => ({}) } = {}) {
    const halfLife = () => tuning().halfLife || HALF_LIFE_MS;
    const burstMin = () => tuning().burstMin || BURST_MIN;
    const burstShare = () => tuning().burstShare || BURST_SHARE;

    let recent = [];
    let saidAt = [];
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

      // The tokens are kept, not just their signature: a reaction can only be
      // offered as a card if there is something to put in the editor.
      const captured = collectTokens(message);
      const sig = signature(captured);
      if (!sig) return;

      const at = Date.now();
      saidAt.push(at);
      // Time first, and only when it has grown: slicing on every message once
      // full copied four thousand numbers per message for as long as the chat
      // ran, and with suggestions off nothing else ever pruned it.
      if (saidAt.length > SAID_MAX) {
        saidAt = saidAt.filter((seen) => seen >= at - BURST_MS);
        if (saidAt.length > SAID_MAX) saidAt = saidAt.slice(-SAID_MAX);
      }

      recent.push({ sig, key: cardKey(captured), at, tokens: captured });
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
      // YouTube can replace the message list without touching the input, and
      // the document observer only reacts to the input or our own root. A
      // watcher left on a detached subtree sees nothing and never recovers.
      if (host && !host.isConnected) {
        observer?.disconnect();
        observer = null;
        host = null;
      }

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
      notifyTimer = setInterval(() => {
        if (host && !host.isConnected) start(); // re-attach after a swap
        notify();
      }, NOTIFY_MS);
      return true;
    }

    // Nothing seen on one stream says anything about the next. YouTube can
    // replace the message list inside the same document, which leaves the
    // previous channel's messages ranking this one.
    function forget() {
      recent = [];
      saidAt = [];
      dirty = false;
    }

    function stop() {
      observer?.disconnect();
      clearInterval(notifyTimer);
      observer = null;
      host = null;
    }

    // signature -> { score, count }
    //
    // `score` orders the deck: every message is worth 2^(-age/half-life), so
    // recency is weighed rather than merely admitted.
    //
    // `count` is the plain number of messages, kept because that is what the
    // bar shows the viewer — 「いまチャットで4.35回」 is not a thing.
    //
    // `tokens` is the most recent wording of that reaction, which is what gets
    // offered when the chat is holding out a card. Signatures collapse `888`
    // and `88888888` together, so some wording has to be chosen, and the
    // latest is the one still on screen.
    // Reads without pruning. Pruning here meant a hover could consume the very
    // expiry that notify() was about to redraw for, leaving the order and the
    // trending marks as they were until another message happened along.
    function ranking() {
      const now = Date.now();
      const cutoff = now - WINDOW_MS;
      const out = new Map();

      for (const entry of recent) {
        if (entry.at < cutoff) continue;
        const seen = out.get(entry.sig) || { score: 0, count: 0, tokens: null };
        seen.score += 2 ** (-(now - entry.at) / halfLife());
        seen.count += 1;
        seen.tokens = entry.tokens || seen.tokens; // recent is in order: newest wins
        out.set(entry.sig, seen);
      }

      return out;
    }

    // The strongest thing being said over and over right now, by exact
    // wording. `accept` decides what is worth offering at all — the caller
    // knows about member emoji and about what the deck already holds.
    function burst(accept) {
      const since = Date.now() - BURST_MS;
      const counts = new Map();

      saidAt = saidAt.filter((at) => at >= since);
      const said = saidAt.length;

      for (const entry of recent) {
        if (entry.at < since || !entry.key) continue;
        const seen = counts.get(entry.key) || { key: entry.key, count: 0, tokens: null };
        seen.count += 1;
        seen.tokens = entry.tokens || seen.tokens;
        counts.set(entry.key, seen);
      }

      const floor = burstMin();
      const share = burstShare();

      let best = null;
      for (const seen of counts.values()) {
        if (seen.count < floor) continue;
        if (seen.count < said * share) continue;
        if (accept && !accept(seen)) continue;
        if (!best || seen.count > best.count) best = seen;
      }
      return best;
    }

    return { start, stop, forget, ranking, burst, get attached() { return !!host; } };
  }

  OD.trending = {
    signature, createWatcher, WINDOW_MS, HALF_LIFE_MS, BURST_MS, BURST_MIN, BURST_SHARE
  };
})();
