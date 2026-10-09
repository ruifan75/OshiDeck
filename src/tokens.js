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

  // Every one of these walks a list that came from somewhere: storage, a
  // backup, a preset, the chat editor. A token that is not an object threw
  // here rather than being ignored, and the throw came out of read() — so one
  // null in one card meant the panel never loaded at all.
  const toPlainText = (tokens) =>
    (Array.isArray(tokens) ? tokens : []).map((t) =>
      t?.type === "text" ? t.value : t?.type === "youtubeEmoji" ? t.alt || "" : ""
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
    // A list, or nothing. `tokens: {}` is not iterable at all, and this is
    // reached from withScope before anything has had a chance to drop the
    // card — so it threw where it was meant to be describing.
    for (const token of Array.isArray(tokenList) ? tokenList : []) {
      if (token?.type !== "youtubeEmoji") continue;
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

  /* ---------- standard emoji ---------- */

  // YouTube does not draw 👏 in the system font. Live chat replaces every
  // standard emoji with Google's own picture, so the same message is one
  // drawing in the chat and a different one on the card beside it — and a
  // third one again on Windows, where the system font is Segoe UI Emoji. A
  // card is a picture of the message it is about to send, so it has to use
  // the chat's pictures.
  //
  // On the card only. These stay `text` tokens everywhere else, and what
  // goes into the chat editor stays characters: YouTube's own renderer is
  // what turns them into images there, and an <img> written in their place
  // carries no emoji id for it to resolve.
  const NOTO = "https://fonts.gstatic.com/s/e/notoemoji/15.1";

  // Regional indicators (🇯🇵) and keycaps (1️⃣) have to be named separately.
  // Underneath they are two letters and a digit, so Extended_Pictographic —
  // which is the test for every other emoji there is — says no to both.
  const IS_EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u20E3/u;

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

  // Text split into the pictures in it and the characters between them.
  //
  // Graphemes rather than code points, because a picture is not a character:
  // 👏🏻 is a hand and a skin tone, 😵‍💫 is two faces and a joiner, 👨‍👩‍👧 is
  // three people and two more, and every one of them is one drawing.
  function splitEmoji(text) {
    const parts = [];
    let plain = "";
    for (const { segment } of segmenter.segment(text || "")) {
      if (!IS_EMOJI.test(segment)) { plain += segment; continue; }
      if (plain) { parts.push({ emoji: false, value: plain }); plain = ""; }
      parts.push({ emoji: true, value: segment });
    }
    if (plain) parts.push({ emoji: false, value: plain });
    return parts;
  }

  // The picture's url is not worth storing anywhere: it falls out of the
  // characters. Checked against one stream's chat export, all 115 standard
  // emoji in it derived to the url YouTube itself had served.
  const notoSrc = (grapheme) =>
    `${NOTO}/${[...grapheme]
      // YouTube drops the variation selector from its own emoji ids, and the
      // file answers with or without it, so dropping it keeps one spelling.
      .filter((ch) => ch !== "\uFE0F")
      // The `1` of 1️⃣ is code point 31 and the file is `0031_20e3`.
      .map((ch) => ch.codePointAt(0).toString(16).padStart(4, "0"))
      .join("_")}/72.png`;

  function createStandardEmojiNode(grapheme) {
    const img = document.createElement("img");
    // No data-emoji-id: that names an emoji YouTube hosts for one channel,
    // and these belong to nobody. It is also what collectTokens reads, so
    // putting one here would turn 👏 into a member emoji on the way back.
    img.className = "od-emoji";
    img.setAttribute("src", notoSrc(grapheme));
    img.setAttribute("alt", grapheme);
    // Not everything that segments as one grapheme has a picture — ™, ♻,
    // the older dingbats — and the ones that do not answer 404. Falling back
    // to the characters is what the card showed before any of this.
    img.addEventListener("error", () => {
      img.replaceWith(document.createTextNode(grapheme));
    }, { once: true });
    return img;
  }

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
    //
    // The editor only. This is YouTube's own attribute — `tp-yt-paper-tooltip`
    // is what reads it, which is why collectTokens already has to skip that
    // element — and the panel is mounted inside the live chat renderer, so a
    // card face carrying one got YouTube's tooltip floating `:_ただいま:` over
    // the chat on hover. Nothing in this UI gets a native tooltip; what a card
    // has to say, the bar says.
    if (token.sharedTooltipText && !preview) {
      img.setAttribute("shared-tooltip-text", token.sharedTooltipText);
    }
    return img;
  }

  // A card that is one thing said over and over, as the thing and a count.
  //
  // Most cards are. Of the 2609 mined out of chat, 1150 are nothing but a
  // run of pictures repeated — three of a stamp, five of a stamp, 🦢✨ twice.
  // Drawn literally, a small card has to shrink to fit five of them, and the
  // stamps are the whole point of a card like that: 48% of cards held their
  // full size, against 85% once the repeat is counted instead of drawn.
  //
  // What repeats has to be a thing somebody said, not the shape of how they
  // said it.
  //
  // A picture always is: a stamp again is the stamp, again. A run of
  // characters usually is not — `www` is the word, `88888` is the clapping,
  // and `てぇてぇ`, `よしよし`, `そうそう`, `ぎゅっぎゅっ` are each one word
  // that happens to be a doubling. Writing any of those as `×N` takes the
  // word apart.
  //
  // A terminator is what separates them. `はい！はい！はい！はい！` is one
  // utterance said four times and reads exactly as `はい！×4`, and so do
  // `アンコール！×2`, `安心！×3`, `ちーよみ！×2`. Across the 354 cards of
  // repeated characters mined from chat the split is clean: all 14 with a
  // terminator read as a count, and none of the other 340 do.
  //
  // More than one atom, so `！×4` stays as it is — there the mark is the
  // whole of what was said, which puts it back with `www`.
  const ENDS_AN_UTTERANCE = /[！!？?。]/u;

  const saidAgain = (unit) =>
    unit.every((atom) => atom.picture) ||
    (unit.length > 1 && ENDS_AN_UTTERANCE.test(unit[unit.length - 1].key));

  function repeated(tokenList) {
    const atoms = [];
    for (const token of tokenList || []) {
      if (token?.type === "youtubeEmoji") {
        atoms.push({ picture: true, key: `\u0001${token.emojiId}`, token });
        continue;
      }
      if (token?.type !== "text") return null;
      for (const part of splitEmoji(token.value || "")) {
        if (part.emoji) {
          atoms.push({ picture: true, key: part.value, token: { type: "text", value: part.value } });
          continue;
        }
        for (const { segment } of segmenter.segment(part.value)) {
          atoms.push({ picture: false, key: segment, token: { type: "text", value: segment } });
        }
      }
    }
    if (atoms.length < 2) return null;

    // The shortest unit, so three of a stamp is ×3 and not a unit of three.
    for (let size = 1; size <= atoms.length / 2; size++) {
      if (atoms.length % size) continue;
      let same = true;
      for (let at = size; at < atoms.length && same; at++) {
        if (atoms[at].key !== atoms[at % size].key) same = false;
      }
      if (!same) continue;

      const unit = atoms.slice(0, size);
      if (!saidAgain(unit)) return null;

      // Back into tokens, with the characters joined up again: they were
      // taken apart one grapheme at a time only to find where the repeat was.
      const whole = [];
      for (const atom of unit) {
        const last = whole[whole.length - 1];
        if (atom.token.type === "text" && last?.type === "text") last.value += atom.token.value;
        else whole.push({ ...atom.token });
      }
      return { unit: whole, times: atoms.length / size };
    }
    return null;
  }

  // A DocumentFragment for previews; innerHTML for the chat editor, which is
  // what YouTube's renderer expects to observe.
  function toFragment(tokens, options) {
    const frag = document.createDocumentFragment();
    for (const token of Array.isArray(tokens) ? tokens : []) {
      if (token?.type === "text") appendText(frag, token.value || "", options);
      else if (token?.type === "youtubeEmoji") frag.appendChild(createEmojiNode(token, options));
    }
    return frag;
  }

  // Pictures on a card, characters in the editor.
  function appendText(frag, text, { preview = false } = {}) {
    if (!text) return;
    if (!preview) { frag.appendChild(document.createTextNode(text)); return; }
    for (const part of splitEmoji(text)) {
      frag.appendChild(
        part.emoji ? createStandardEmojiNode(part.value) : document.createTextNode(part.value)
      );
    }
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
  // Tolerant of a token that is not one. This runs over everything that
  // arrives — storage, a backup, a preset — and a null in the list used to
  // throw here, which meant the panel never loaded rather than the one bad
  // card being dropped.
  const cardKey = (tokenList) =>
    (Array.isArray(tokenList) ? tokenList : [])
      .map((token) =>
        token?.type === "youtubeEmoji" ? "\u0001" + token.emojiId : token?.value || ""
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
        token?.type === "youtubeEmoji" ||
        (token?.type === "text" && token.value && token.value.trim())
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
    emojiOwner, requiredChannels, needsMembership, harvestEmoji, freshSrc, splitEmoji, repeated
  };
})();
