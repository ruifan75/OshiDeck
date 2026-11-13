// Watches the live chat and keeps a rolling count of what people are posting,
// so cards matching the current wave can float to the front.
(() => {
  const OD = (globalThis.OshiDeck ||= {});
  const { cardKey, collectTokens, harvestEmoji } = OD.tokens;

  // Keep messages for 4.5 of the chosen half-lives, when their weight is about
  // 4%, so falling out of the window is no longer a visible event. Always
  // keep at least the burst window, which also reads these messages.
  const WINDOW_HALF_LIVES = 4.5;

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

  // A longer pace keeps more history in time, not more captured wording:
  // retain at most 600 tokenized messages to bound memory even in a busy chat.
  const RECENT_MAX = 600;

  // Just the times, for the share. Keeping wording costs memory, so `recent`
  // is capped at 600 — but that cap was also the denominator, so in a chat
  // fast enough to fill it inside twelve seconds a reaction looked like a far
  // larger share of the room than it was. Numbers are cheap, so the count of
  // what was said is kept separately and much further back. The numerator
  // still comes from `recent`, so an extreme chat understates a share rather
  // than inventing one — the safe direction.
  const SAID_MAX = 4000;

  // Which rows are somebody talking.
  //
  // Not every row in the chat is a comment. A membership gift puts out one
  // announcement per recipient — `@ようかん-MP さんからメンバーシップを受け
  // 取りました` — and a batch of fifty of them lands in a few seconds, all
  // saying the same thing because they all name the same giver. That is a
  // burst by every measure this file has, so the panel held the announcement
  // out as a card to save. The same goes for 新規メンバー rows, Super Sticker
  // rows and YouTube's own notices.
  //
  // Read by the element, never by the words. The wording is YouTube's and
  // changes with the viewer's language — matching it would mean a list in
  // every language YouTube has, which would still be wrong the next time they
  // reword one. What kind of row it is does not change: the custom element is
  // the same for every viewer. So this is an allow list of the two kinds that
  // carry something a viewer typed, and everything else is left alone without
  // this file needing to know what it was.
  //
  // The same two the ＋ offers itself on, for the same reason, which is why
  // content.js reads this one rather than keeping a second copy.
  const COMMENT_ROWS =
    "yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer";

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

  // A call repeated any number of times is that call once — including when
  // the last turn is cut short, which is what letting go of the key looks
  // like. `n % k` had to be zero, so a cycle only collapsed when it happened
  // to come out even: `:_penlight1::_penlight2:` three times was one card and
  // two and a half times was another, 🎶💮 collapsed at four repeats and not
  // at three and a half, and a cycle of two never collapsed at any odd
  // length. One channel spent two of its ten slots on the same penlight.
  //
  // `k <= n / 2` stays: a cycle has to go round at least twice before it is
  // one. Without it `なるほどな` reads as `なるほど` and a quarter, and 3743
  // pairs of candidates across the mined channels merged that way — `わかる`
  // with `わかるわ`, `だれ？` with `だれだ`.
  function collapseCycle(list, max = 1) {
    const n = list.length;
    for (let k = 1; k <= n / 2; k++) {
      let repeats = true;
      for (let i = k; i < n && repeats; i++) repeats = list[i] === list[i % k];
      if (repeats) return list.slice(0, k * Math.min(max, n / k));
    }
    return list;
  }

  // The cycle is looked for first. Collapsing runs beforehand joins the end
  // of one turn to the start of the next whenever they are the same atom,
  // which destroys the real cycle and leaves a shorter false one: `いたい`
  // said twice is い-た-い-い-た-い, flattening the doubled い makes it
  // い-た-い-た-い, and that reads as `いた` two and a half times — so `いた`
  // and `いたいいたい` were the same card, as were `ya` and `yay yay`.
  // If there is no cycle to preserve, flatten runs and look again: AABBAB
  // and ABAB are the same call with different lengths of each note.
  // Runs still collapse afterwards, so 888 and 88888888 stay one card too.
  function signature(tokenList) {
    const list = atoms(tokenList);
    const cycle = collapseCycle(list);
    const unit = cycle === list ? collapseCycle(collapseRuns(list)) : cycle;
    return collapseRuns(unit).join(JOINER);
  }

  /* ---------- the watcher ---------- */

  // `tuning` says what the viewer has chosen. The constants above remain the
  // answer when nobody has said otherwise, so the watcher still works standing
  // on its own — which is how the tests drive it.
  function createWatcher({ onChange, tuning = () => ({}) } = {}) {
    const halfLife = () => tuning().halfLife || HALF_LIFE_MS;
    const windowMs = () => Math.max(BURST_MS, halfLife() * WINDOW_HALF_LIVES);
    const burstMin = () => tuning().burstMin || BURST_MIN;
    const burstShare = () => tuning().burstShare || BURST_SHARE;

    let recent = [];
    let saidAt = [];
    let observer = null;
    let host = null;
    let notifyTimer = null;
    let dirty = false;
    let lastBurst = {};

    const findHost = () =>
      document.querySelector("yt-live-chat-item-list-renderer #items") ||
      document.querySelector("#chat #items") ||
      document.querySelector("#item-scroller #items");

    function record(node) {
      // Every row is a chance to refresh an emoji url, whatever the mode and
      // whatever the row — a member emoji in a milestone message is the same
      // picture at the same address, and the url is all that is taken.
      harvestEmoji(node);

      // ...but only a comment counts as something the chat is doing. The row
      // itself, or the one inside it: YouTube has wrapped these before, and a
      // wrapper that still holds one comment is still that comment.
      const row = node.matches?.(COMMENT_ROWS) ? node : node.querySelector?.(COMMENT_ROWS);
      if (!row) return;

      const message = row.querySelector?.("#message");
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
      const cutoff = Date.now() - windowMs();
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
      lastBurst = {};
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
      const cutoff = now - windowMs();
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
      const stats = { messages: said, candidates: counts.size, min: floor, share,
        belowMin: 0, belowShare: 0, ineligible: 0, qualified: 0, maxCount: 0 };
      for (const seen of counts.values()) {
        stats.maxCount = Math.max(stats.maxCount, seen.count);
        if (seen.count < floor) { stats.belowMin += 1; continue; }
        if (seen.count < said * share) { stats.belowShare += 1; continue; }
        if (accept && !accept(seen)) { stats.ineligible += 1; continue; }
        stats.qualified += 1;
        if (!best || seen.count > best.count) best = seen;
      }
      lastBurst = stats;
      return best;
    }

    return { start, stop, forget, ranking, burst, diagnostics: () => ({ ...lastBurst }), get attached() { return !!host; } };
  }

  OD.trending = {
    signature, createWatcher, COMMENT_ROWS,
    WINDOW_HALF_LIVES, HALF_LIFE_MS, BURST_MS, BURST_MIN, BURST_SHARE
  };
})();
