// Reading the chat editor into tokens, and writing tokens back into it.
(() => {
  const OD = (globalThis.OshiDeck ||= {});

  const EMOJI_CLASS =
    "emoji yt-formatted-string style-scope yt-live-chat-text-input-field-renderer";

  const NOT_CONTENT = new Set([
    "TP-YT-PAPER-TOOLTIP", "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"
  ]);

  function collectTokens(node) {
    const tokens = [];

    function pushText(text) {
      if (!text) return;
      const last = tokens[tokens.length - 1];
      if (last?.type === "text") last.value += text;
      else tokens.push({ type: "text", value: text });
    }

    function readEmojiToken(element) {
      if (!(element instanceof Element)) return null;

      const img =
        element.tagName === "IMG" ? element : element.querySelector?.("img[data-emoji-id]");
      if (!img) return null;

      const emojiId = img.getAttribute("data-emoji-id") || img.dataset?.emojiId || null;
      if (!emojiId) return null;

      return {
        type: "youtubeEmoji",
        emojiId,
        alt: img.getAttribute("alt") || "",
        src: img.currentSrc || img.getAttribute("src") || "",
        sharedTooltipText: img.getAttribute("shared-tooltip-text") || "",
        ariaLabel: img.getAttribute("aria-label") || ""
      };
    }

    function walk(current) {
      if (current.nodeType === Node.TEXT_NODE) return pushText(current.textContent || "");
      if (current.nodeType !== Node.ELEMENT_NODE) return;

      // Chrome, not content. YouTube appends a <tp-yt-paper-tooltip> inside
      // the message the first time it is hovered, and that tooltip's text is
      // the emoji shortcode — so every comment taken with the ＋ button, which
      // can only be reached by hovering, arrived with `:musical_notes:` stuck
      // on the end. It also quietly changed the chat-trend signature of any
      // message the pointer had crossed.
      if (NOT_CONTENT.has(current.tagName) || current.hasAttribute?.("hidden")) return;

      const emoji = readEmojiToken(current);
      if (emoji) return tokens.push(emoji);

      // Non-YouTube image: keep its textual fallback only.
      if (current.tagName === "IMG") return pushText(current.getAttribute("alt") || "");
      if (current.tagName === "BR") return pushText("\n");

      current.childNodes.forEach(walk);
    }

    node.childNodes.forEach(walk);
    return tokens;
  }

  const toPlainText = (tokens) =>
    tokens.map((t) =>
      t.type === "text" ? t.value : t.type === "youtubeEmoji" ? t.alt || "" : ""
    ).join("");

  // ---- member emoji ----

  // A member emoji's id is its home channel followed by a slash. A channel id
  // is exactly "UC" plus 22 characters, and the match must be anchored: emoji
  // ids are long random strings, and an unanchored search finds a stray "UC"
  // in the middle of an ordinary one and invents an owner that matches nobody.
  const OWNER = /^(UC[A-Za-z0-9_-]{22})\//;
  const emojiOwner = (emojiId) => OWNER.exec(emojiId || "")?.[1] || null;

  // An owner prefix is not the same as needing a membership. YouTube hands
  // out free emoji packs — `:shelterin:`, `:face-red-heart-shape:` — and
  // those carry a channel prefix too: an ordinary viewer's account, not a
  // creator's. Reading the prefix alone locked a card anyone could send, and
  // locked it everywhere, forever.
  //
  // What separates them is the shortcut: YouTube writes a member emoji's as
  // `:_name:` and a free one's without the underscore. Measured in two
  // places, because they do not agree — the live DOM's `alt` is a display
  // name (`ぺここ`), and the shortcut is in `shared-tooltip-text`
  // (`:_ぺここ:`); a chat export calls it `shortcuts`.
  const MEMBERS_ONLY = /^:_/;

  // Cards saved before any of this was collected have no shortcut to read.
  // Treating those as free would unlock a card that fails when pressed, which
  // is the failure the locks exist to prevent — so silence means membership,
  // the same answer the code gave before there was a way to ask.
  function needsMembership(token) {
    const shortcut = token.sharedTooltipText || "";
    return !shortcut || MEMBERS_ONLY.test(shortcut);
  }

  // Which channels' member emoji a card needs. Empty means it works anywhere.
  function requiredChannels(tokenList) {
    const owners = new Set();
    for (const token of tokenList || []) {
      if (token.type !== "youtubeEmoji") continue;
      if (!needsMembership(token)) continue;
      const owner = emojiOwner(token.emojiId);
      if (owner) owners.add(owner);
    }
    return [...owners];
  }

  // Stored CDN urls go stale. Whatever the live page is showing right now for
  // an emoji id is always fresher than what we saved months ago.
  const liveSrc = new Map();
  // A long session hops channels and sees thousands of distinct emoji. Keep
  // the most recent; a Map preserves insertion order, so the oldest key is
  // the first one.
  const LIVE_SRC_MAX = 500;

  function harvestEmoji(node) {
    if (!(node instanceof Element)) return;
    const images = node.tagName === "IMG" ? [node] : node.querySelectorAll?.("img[data-emoji-id]");
    for (const img of images || []) {
      const id = img.getAttribute("data-emoji-id");
      const src = img.currentSrc || img.getAttribute("src");
      if (!id || !src) continue;

      liveSrc.delete(id); // re-insert so a seen-again emoji counts as recent
      liveSrc.set(id, src);
      if (liveSrc.size > LIVE_SRC_MAX) liveSrc.delete(liveSrc.keys().next().value);
    }
  }

  const freshSrc = (token) => liveSrc.get(token.emojiId) || token.src || "";

  function createEmojiNode(token, { preview = false } = {}) {
    const img = document.createElement("img");
    // Outside a preview this has to match the markup YouTube itself writes.
    img.className = preview ? "od-emoji" : EMOJI_CLASS;
    const src = freshSrc(token);
    if (src) img.setAttribute("src", src);
    img.setAttribute("alt", token.alt || "");
    img.setAttribute("data-emoji-id", token.emojiId || "");
    // Written back because it is read back: a card staged into the editor and
    // collected again would otherwise lose the one thing that says whether it
    // needs a membership.
    if (token.sharedTooltipText) {
      img.setAttribute("shared-tooltip-text", token.sharedTooltipText);
    }
    return img;
  }

  // A DocumentFragment for previews; innerHTML for the chat editor, which is
  // what YouTube's renderer expects to observe.
  function toFragment(tokens, options) {
    const frag = document.createDocumentFragment();
    for (const token of tokens) {
      if (token.type === "text") frag.appendChild(document.createTextNode(token.value || ""));
      else if (token.type === "youtubeEmoji") frag.appendChild(createEmojiNode(token, options));
    }
    return frag;
  }

  function toHtml(tokens) {
    const holder = document.createElement("div");
    holder.appendChild(toFragment(tokens));
    return holder.innerHTML;
  }

  function placeCaretAtEnd(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // Identity of a card's content. Exact enough that "888" and "8888" stay
  // different cards, forgiving only about whitespace. (trending.signature is
  // the loose comparison — it deliberately treats those two as one reaction.)
  const cardKey = (tokenList) =>
    (tokenList || [])
      .map((token) =>
        token.type === "youtubeEmoji" ? "\u0001" + token.emojiId : token.value || ""
      )
      .join("")
      .replace(/\s+/g, " ")
      .trim();

  // An emoji-only comment is a perfectly good card, and a member emoji may
  // carry no alt text at all — so "is there anything here" can never be
  // decided on the plain text alone.
  const hasSubstance = (tokenList) =>
    (tokenList || []).some(
      (token) =>
        token.type === "youtubeEmoji" ||
        (token.type === "text" && token.value && token.value.trim())
    );

  const hasContent = (input) =>
    !!input.textContent?.trim() || !!input.querySelector("img[data-emoji-id]");

  // Update the contenteditable, then tell the renderer. The event has to
  // bubble and cross the shadow boundary or YouTube never sees it and the
  // send button stays disabled.
  function writeToInput(input, tokens, { replace = false } = {}) {
    input.focus();
    const html = toHtml(tokens);
    input.innerHTML = replace || !hasContent(input) ? html : input.innerHTML + html;
    placeCaretAtEnd(input);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
  }

  OD.tokens = {
    collectTokens, toPlainText, toFragment, toHtml, cardKey, hasContent, hasSubstance, writeToInput,
    emojiOwner, requiredChannels, needsMembership, harvestEmoji, freshSrc
  };
})();
