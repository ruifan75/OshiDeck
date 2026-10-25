// Run the complete content script in a DOM. Only browser boundaries are faked:
// Chrome's worker/storage, time and layout. Selectors, listeners, rendering and
// the chat watcher are the production modules, never reconnected by a test.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";

export const CHANNEL = "UC" + "a".repeat(22);
const root = new URL("../../", import.meta.url);
const overrides = { tokens: "OD_TOKENS", store: "OD_STORE", trending: "OD_TRENDING",
  layout: "OD_LAYOUT", presets: "OD_PRESETS", i18n: "OD_I18N" };

export async function contentPage({ source, mode = "hand", cards = [], folded = false,
                                    channel = true, preset = true, start = true } = {}) {
  const errors = [];
  const output = new VirtualConsole();
  output.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(`<!doctype html><html><head>
    ${channel ? `<meta itemprop="channelId" content="${CHANNEL}">` : ""}
    </head><body><div id="chat"><yt-live-chat-item-list-renderer>
    <div id="item-scroller"><div id="items"></div></div>
    </yt-live-chat-item-list-renderer></div><div id="input-panel">
    <yt-live-chat-message-input-renderer>
    <yt-live-chat-text-input-field-renderer id="input"><div contenteditable="true"></div>
    </yt-live-chat-text-input-field-renderer></yt-live-chat-message-input-renderer>
    </div></body></html>`, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    runScripts: "outside-only", virtualConsole: output });
  const { window } = dom;
  const { document } = window;
  let clock = 1_700_000_000_000;
  let nextTimer = 0;
  const timers = new Map();
  window.Date.now = () => clock;
  window.setTimeout = (fn, ms = 0) => {
    const id = ++nextTimer;
    timers.set(id, { fn, at: clock + ms });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  window.setInterval = (fn, ms) => {
    const id = ++nextTimer;
    timers.set(id, { fn, at: clock + ms, every: ms });
    return id;
  };
  window.clearInterval = window.clearTimeout;
  window.requestAnimationFrame = (fn) => window.setTimeout(fn, 16);
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.crypto.randomUUID = randomUUID;
  window.HTMLElement.prototype.getClientRects = function () {
    return this.isConnected && !this.closest("[hidden]") ? [new window.DOMRect(0, 0, 400, 24)] : [];
  };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.getClientRects()[0] || new window.DOMRect();
  };
  Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { get: () => 400 });
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { get: () => 100 });

  const changed = new Set();
  const stored = { settings: { mode, folded, sortBy: "manual", suggest: true, language: "en" },
    cards: cards.map((value, i) => ({ id: `card-${i}`, tokens: [{ type: "text", value }],
      scope: "global", createdAt: clock, by: {} })),
    decks: {}, channelMeta: { [CHANNEL]: { name: "Fixture channel", hue: 100 } } };
  stored.decks[CHANNEL] = stored.cards.map((card) => card.id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  async function write(patch) {
    const changes = {};
    for (const [key, value] of Object.entries(patch)) {
      changes[key] = { oldValue: stored[key], newValue: clone(value) };
      stored[key] = clone(value);
    }
    for (const listener of changed) listener(changes, "local");
  }
  const bundled = { format: 2, name: "Fixture preset", channel: CHANNEL,
    cards: [{ tokens: [{ type: "text", value: "preset card" }], scope: "channel" }] };
  let alive = true;
  window.chrome = {
    i18n: { getUILanguage: () => "en" },
    runtime: { get id() { return alive ? "fixture" : undefined; },
      sendMessage: async (message) => {
        if (message.type === "presets") return { ok: true, value: preset ? [bundled] : [] };
        if (message.type === "mutate") return window.OshiDeck.store.runOp(message.op, message.args);
        return { ok: true };
      } },
    storage: { local: { get: async () => clone(stored), set: write },
      onChanged: { addListener: (listener) => changed.add(listener) } }
  };
  for (const name of ["i18n", "tokens", "layout", "backup", "store", "journal", "presets", "trending"]) {
    const file = process.env[overrides[name]] || new URL(`src/${name}.js`, root);
    window.eval(`${readFileSync(file, "utf8")}\n//# sourceURL=src/${name}.js`);
  }
  window.eval(`${source || readFileSync(process.env.OD_SOURCE || new URL("content.js", root), "utf8")}\n//# sourceURL=content.js`);

  // Flush real DOM observers and promises between timer callbacks. Only timers
  // due by the requested time run; the watcher's interval cannot spin forever.
  async function advance(ms = 500) {
    const until = clock + ms;
    for (let steps = 0; steps < 100; steps++) {
      await new Promise((done) => setImmediate(done));
      const due = [...timers].filter(([, job]) => job.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) {
        clock = until;
        if (errors.length) throw errors[0];
        return;
      }
      const [id, job] = due;
      timers.delete(id);
      clock = job.at;
      if (job.every) timers.set(id, { ...job, at: clock + job.every });
      await job.fn();
    }
    throw new Error("content page did not settle");
  }
  function comment(text, tag = "yt-live-chat-text-message-renderer", { message = true } = {}) {
    const row = document.createElement(tag);
    if (message) {
      const body = document.createElement("span");
      body.id = "message";
      body.textContent = text;
      row.appendChild(body);
    }
    document.querySelector("#items").appendChild(row);
    return row;
  }
  function point(target) {
    target.dispatchEvent(new window.Event("pointerover", { bubbles: true }));
    return document.querySelector(".od-grab")?.parentElement || null;
  }
  if (start) await advance();
  return { window, document, advance, comment, point,
    get root() { return document.querySelector("#oshideck-root"); },
    async update(patch) { await write(patch); await advance(); },
    async settings(patch) { await write({ settings: { ...stored.settings, ...patch } }); await advance(); },
    async draw(value = "drawn reaction") {
      for (let i = 0; i < 6; i++) comment(value);
      await advance(4500);
      return document.querySelector(".od-drawn");
    },
    stop() { alive = false; },
    close() { timers.clear(); window.close(); }
  };
}
