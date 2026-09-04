// Reading the chat editor into tokens, and writing tokens back into it.
(() => {
  const OD = (globalThis.OshiDeck ||= {});

  const EMOJI_CLASS =
    "emoji yt-formatted-string style-scope yt-live-chat-text-input-field-renderer";

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

  // Which channels' member emoji a card needs. Empty means it works anywhere.
  function requiredChannels(tokenList) {
    const owners = new Set();
    for (const token of tokenList || []) {
      if (token.type !== "youtubeEmoji") continue;
      const owner = emojiOwner(token.emojiId);
      if (owner) owners.add(owner);
    }
    return [...owners];
  }

  // Stored CDN urls go stale. Whatever the live page is showing right now for
  // an emoji id is always fresher than what we saved months ago.
  const liveSrc = new Map();

  function harvestEmoji(node) {
    if (!(node instanceof Element)) return;
    const images = node.tagName === "IMG" ? [node] : node.querySelectorAll?.("img[data-emoji-id]");
    for (const img of images || []) {
      const id = img.getAttribute("data-emoji-id");
      const src = img.currentSrc || img.getAttribute("src");
      if (id && src) liveSrc.set(id, src);
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
    emojiOwner, requiredChannels, harvestEmoji, freshSrc
  };
})();
