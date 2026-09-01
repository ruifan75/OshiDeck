(() => {
  const STORAGE_KEYS = {
    SETTINGS: "settings",
    PRESETS: "presets"
  };

  const DEFAULT_SETTINGS = {
    autoSend: false
  };

  let currentInput = null;
  let rootEl = null;
  let refreshTimer = null;

  function log(...args) {
    console.debug("[OshiDeck]", ...args);
  }

  function getChatInput() {
    // Current YouTube Live Chat structure is typically:
    // <yt-live-chat-text-input-field-renderer id="input">
    //   <div id="input" contenteditable="true">...</div>
    // </yt-live-chat-text-input-field-renderer>
    const renderer =
      document.querySelector('yt-live-chat-text-input-field-renderer#input') ||
      document.querySelector('yt-live-chat-text-input-field-renderer');

    const editable =
      renderer?.querySelector('[contenteditable="true"]') ||
      renderer?.querySelector('[contenteditable]');

    return (
      editable ||
      document.querySelector('yt-live-chat-message-input-renderer [contenteditable="true"]') ||
      document.querySelector('yt-live-chat-message-input-renderer [contenteditable]')
    );
  }

  function getSendButton() {
    return (
      document.querySelector('yt-live-chat-message-input-renderer #send-button button') ||
      document.querySelector('#send-button button') ||
      document.querySelector('yt-button-renderer#send-button button')
    );
  }

  function normalizeChannelId(value) {
    return typeof value === "string" && value.startsWith("UC") ? value : null;
  }

  function findChannelIdInDocument(doc) {
    const meta = doc.querySelector('meta[itemprop="channelId"]');
    if (meta?.content) return normalizeChannelId(meta.content);

    const ownerLink = doc.querySelector(
      'ytd-video-owner-renderer a[href^="/channel/"], ' +
      '#owner a[href^="/channel/"], ' +
      'a.yt-simple-endpoint[href^="/channel/"]'
    );

    if (ownerLink) {
      const match = ownerLink.getAttribute("href")?.match(/^\/channel\/([^/?#]+)/);
      if (match) return normalizeChannelId(match[1]);
    }

    return null;
  }

  function getChannelId() {
    let id = findChannelIdInDocument(document);
    if (id) return id;

    try {
      if (window.top !== window) {
        id = findChannelIdInDocument(window.top.document);
        if (id) return id;
      }
    } catch (_) {}

    return null;
  }

  async function getStoredData() {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.PRESETS
    ]);

    return {
      settings: {
        ...DEFAULT_SETTINGS,
        ...(result[STORAGE_KEYS.SETTINGS] || {})
      },
      presets: result[STORAGE_KEYS.PRESETS] || {
        global: [],
        channels: {}
      }
    };
  }

  async function savePresets(presets) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.PRESETS]: presets
    });
  }

  function collectTokens(node) {
    const tokens = [];

    function pushText(text) {
      if (!text) return;
      const last = tokens[tokens.length - 1];
      if (last?.type === "text") {
        last.value += text;
      } else {
        tokens.push({ type: "text", value: text });
      }
    }

    function readEmojiToken(element) {
      if (!(element instanceof Element)) return null;

      const img =
        element.tagName === "IMG"
          ? element
          : element.querySelector?.("img[data-emoji-id]");

      if (!img) return null;

      const emojiId =
        img.getAttribute("data-emoji-id") ||
        img.dataset?.emojiId ||
        null;

      if (!emojiId) return null;

      return {
        type: "youtubeEmoji",
        emojiId,
        alt: img.getAttribute("alt") || "",
        src: img.currentSrc || img.getAttribute("src") || "",
        className: img.getAttribute("class") || "",
        sharedTooltipText: img.getAttribute("shared-tooltip-text") || "",
        ariaLabel: img.getAttribute("aria-label") || ""
      };
    }

    function walk(current) {
      if (current.nodeType === Node.TEXT_NODE) {
        pushText(current.textContent || "");
        return;
      }

      if (current.nodeType !== Node.ELEMENT_NODE) return;

      const emoji = readEmojiToken(current);
      if (emoji) {
        tokens.push(emoji);
        return;
      }

      if (current.tagName === "IMG") {
        // Non-YouTube image: keep its textual fallback only.
        pushText(current.getAttribute("alt") || "");
        return;
      }

      if (current.tagName === "BR") {
        pushText("\n");
        return;
      }

      current.childNodes.forEach(walk);
    }

    node.childNodes.forEach(walk);

    log("Collected preset tokens:", tokens);
    return tokens;
  }

  function tokensToPlainText(tokens) {
    return tokens.map(token => {
      if (token.type === "text") return token.value;
      if (token.type === "youtubeEmoji") return token.alt || "😀";
      return "";
    }).join("");
  }

  function shortLabel(tokens) {
    const text = tokensToPlainText(tokens).replace(/\s+/g, " ").trim();
    return text.length > 24 ? text.slice(0, 24) + "…" : (text || "絵文字プリセット");
  }

  function createEmojiNode(token, { preview = false } = {}) {
    const img = document.createElement("img");

    if (preview) {
      img.className = "ytcp-preview-emoji";
    } else {
      // Match the markup YouTube itself puts into the chat editor.
      img.className =
        "emoji yt-formatted-string style-scope yt-live-chat-text-input-field-renderer";
    }

    if (token.src) img.setAttribute("src", token.src);
    img.setAttribute("alt", token.alt || "");
    img.setAttribute("data-emoji-id", token.emojiId || "");

    return img;
  }

  function buildPresetHtml(tokens) {
    const holder = document.createElement("div");

    for (const token of tokens) {
      if (token.type === "text") {
        holder.appendChild(document.createTextNode(token.value || ""));
      } else if (token.type === "youtubeEmoji") {
        holder.appendChild(createEmojiNode(token));
      }
    }

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

  function fireInputEvents(input) {
    // Keep this deliberately close to the common YouTube Live Chat technique:
    // update the contenteditable DOM, then notify the renderer with InputEvent.
    input.dispatchEvent(new InputEvent("input"));
  }

  function insertPreset(tokens) {
    const input = getChatInput();
    if (!input) {
      alert("チャット入力欄が見つかりませんでした。");
      return false;
    }

    input.focus();

    const html = buildPresetHtml(tokens);

    // Set exactly the markup we want before YouTube observes the input event.
    input.innerHTML = html;

    log("HTML before InputEvent:", input.innerHTML);

    placeCaretAtEnd(input);
    fireInputEvents(input);

    // Observe whether YouTube rewrites/sanitizes the editor DOM.
    queueMicrotask(() => {
      log("HTML after InputEvent (microtask):", input.innerHTML);
    });

    requestAnimationFrame(() => {
      log("HTML after InputEvent (animation frame):", input.innerHTML);
    });

    return true;
  }

  async function usePreset(preset) {
    const ok = insertPreset(preset.tokens || []);
    if (!ok) return;

    const { settings } = await getStoredData();

    if (settings.autoSend) {
      const started = performance.now();

      const trySend = () => {
        const button = getSendButton();

        if (button && !button.disabled &&
            button.getAttribute("aria-disabled") !== "true") {
          button.click();
          return;
        }

        if (performance.now() - started < 800) {
          setTimeout(trySend, 50);
        } else {
          log("Send button did not become available in time.");
        }
      };

      setTimeout(trySend, 80);
    }
  }

  async function addCurrentInputPreset(scope) {
    const input = getChatInput();
    if (!input) return;

    const tokens = collectTokens(input);
    if (!tokens.length || !tokensToPlainText(tokens).trim()) {
      alert("保存するコメントを入力してください。");
      return;
    }

    const channelId = getChannelId();
    if (scope === "channel" && !channelId) {
      alert("チャンネルIDを取得できませんでした。グローバル保存を使ってください。");
      return;
    }

    const name = prompt("プリセット名（空欄なら自動）", shortLabel(tokens));
    if (name === null) return;

    const { presets } = await getStoredData();

    const preset = {
      id: crypto.randomUUID(),
      name: name.trim() || shortLabel(tokens),
      tokens,
      createdAt: Date.now()
    };

    if (scope === "global") {
      presets.global ||= [];
      presets.global.push(preset);
    } else {
      presets.channels ||= {};
      presets.channels[channelId] ||= [];
      presets.channels[channelId].push(preset);
    }

    await savePresets(presets);
    await render();
  }

  async function removePreset(scope, presetId) {
    const channelId = getChannelId();
    const { presets } = await getStoredData();

    if (scope === "global") {
      presets.global = (presets.global || []).filter(x => x.id !== presetId);
    } else if (channelId) {
      presets.channels ||= {};
      presets.channels[channelId] = (presets.channels[channelId] || [])
        .filter(x => x.id !== presetId);
    }

    await savePresets(presets);
    await render();
  }

  function buildPresetButton(preset, scope) {
    const wrap = document.createElement("div");
    wrap.className = "ytcp-preset-wrap";

    const button = document.createElement("button");
    button.className = "ytcp-preset";
    button.type = "button";
    button.title = preset.name;
    button.addEventListener("click", () => usePreset(preset));

    for (const token of preset.tokens || []) {
      if (token.type === "text") {
        const span = document.createElement("span");
        span.textContent = token.value || "";
        button.appendChild(span);
      } else if (token.type === "youtubeEmoji") {
        const img = createEmojiNode(token, { preview: true });
        button.appendChild(img);
      }
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ytcp-remove";
    remove.textContent = "×";
    remove.title = "削除";
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (confirm(`「${preset.name}」を削除しますか？`)) {
        await removePreset(scope, preset.id);
      }
    });

    wrap.append(button, remove);
    return wrap;
  }

  function buildSection(title, presets, scope, canSave) {
    const section = document.createElement("section");
    section.className = "ytcp-section";

    const header = document.createElement("div");
    header.className = "ytcp-section-header";

    const titleEl = document.createElement("div");
    titleEl.className = "ytcp-section-title";
    titleEl.textContent = title;

    header.appendChild(titleEl);

    if (canSave) {
      const save = document.createElement("button");
      save.type = "button";
      save.className = "ytcp-save";
      save.textContent = "＋ 現在の入力を保存";
      save.addEventListener("click", () => addCurrentInputPreset(scope));
      header.appendChild(save);
    }

    const list = document.createElement("div");
    list.className = "ytcp-list";

    if (!presets.length) {
      const empty = document.createElement("div");
      empty.className = "ytcp-empty";
      empty.textContent = "まだプリセットがありません";
      list.appendChild(empty);
    } else {
      for (const preset of presets) {
        list.appendChild(buildPresetButton(preset, scope));
      }
    }

    section.append(header, list);
    return section;
  }

  async function render() {
    const input = getChatInput();
    if (!input) return;

    currentInput = input;

    if (!rootEl || !rootEl.isConnected) {
      rootEl = document.createElement("div");
      rootEl.id = "ytcp-root";

      const messageInput =
        input.closest("yt-live-chat-message-input-renderer") ||
        document.querySelector("yt-live-chat-message-input-renderer");

      const inputPanel =
        document.querySelector("#input-panel") ||
        messageInput ||
        input.parentElement;

      if (!inputPanel) {
        log("Input found, but insertion container was not found.");
        return;
      }

      inputPanel.appendChild(rootEl);
      log("Preset UI mounted.", { input, inputPanel });
    }

    const channelId = getChannelId();
    const { presets, settings } = await getStoredData();

    const globalPresets = presets.global || [];
    const channelPresets =
      channelId && presets.channels?.[channelId]
        ? presets.channels[channelId]
        : [];

    rootEl.replaceChildren();

    const topbar = document.createElement("div");
    topbar.className = "ytcp-topbar";

    const title = document.createElement("div");
    title.className = "ytcp-title";
    title.textContent = "チャットプリセット";

    const status = document.createElement("div");
    status.className = "ytcp-status";
    status.textContent = settings.autoSend
      ? "クリックで送信"
      : "クリックで入力";

    const optionsLink = document.createElement("button");
    optionsLink.type = "button";
    optionsLink.className = "ytcp-options";
    optionsLink.textContent = "設定";
    optionsLink.addEventListener("click", () => chrome.runtime.openOptionsPage());

    topbar.append(title, status, optionsLink);
    rootEl.appendChild(topbar);

    rootEl.appendChild(buildSection("共通", globalPresets, "global", true));

    const channelTitle = channelId
      ? `このチャンネル`
      : "このチャンネル（ID取得待ち）";

    rootEl.appendChild(
      buildSection(channelTitle, channelPresets, "channel", !!channelId)
    );
  }

  function scheduleRender() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(render, 250);
  }

  const observer = new MutationObserver(() => {
    const input = getChatInput();
    if (input && (input !== currentInput || !rootEl?.isConnected)) {
      scheduleRender();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" &&
        (changes[STORAGE_KEYS.SETTINGS] || changes[STORAGE_KEYS.PRESETS])) {
      scheduleRender();
    }
  });

  window.addEventListener("yt-navigate-finish", scheduleRender);
  window.addEventListener("load", scheduleRender);

  log("Content script loaded.", location.href);
  scheduleRender();
})();
