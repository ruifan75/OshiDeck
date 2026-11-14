// The actual options HTML and all of its scripts, with only Chrome's storage
// and worker boundary replaced. Input events and page repaints stay real.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";

const root = new URL("../../", import.meta.url);
export const NUHU = "UCj63OWl-HQ-I6ORzUWF1EDg";
export const NONO = "UCVKWgVm8BSlMkGZIDGaoElw";
const overrides = { "src/channel-marks.js": "OD_MARKS", "src/journal.js": "OD_JOURNAL", "options.js": "OD_OPTIONS" };

export async function optionsPage({ channel = NUHU, channelMeta, fakeTime = false,
                                    url = "https://extension.test/options.html", initialData } = {}) {
  const errors = [];
  const output = new VirtualConsole();
  output.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(readFileSync(new URL("options.html", root), "utf8"), {
    url, runScripts: "outside-only", virtualConsole: output
  });
  const { window } = dom;
  const { document } = window;
  window.crypto.randomUUID = randomUUID;
  let clock = 0, nextTimer = 0;
  const timers = new Map();
  if (fakeTime) {
    window.Date.now = () => 1_700_000_000_000 + clock;
    window.performance.now = () => clock;
    window.setTimeout = (fn, ms = 0) => {
      const id = ++nextTimer;
      timers.set(id, { fn, at: clock + ms });
      return id;
    };
    window.clearTimeout = (id) => timers.delete(id);
  }
  const clone = (value) => JSON.parse(JSON.stringify(value));
  let stored = { settings: { language: "zh-TW" }, cards: [], decks: { [channel]: [], [NONO]: [] },
    channelMeta: { [channel]: { name: "虹深°ぬふ", hue: 30 }, [NONO]: { name: "彩雲のの", hue: 100 } } };
  if (channelMeta) stored.channelMeta = clone(channelMeta);
  if (initialData) stored = { ...stored, ...clone(initialData) };
  const listeners = new Set();
  const ops = [];
  const logs = [];
  const set = async (patch) => {
    const changes = {};
    for (const [key, value] of Object.entries(patch)) changes[key] = { oldValue: stored[key], newValue: clone(value) };
    stored = { ...stored, ...clone(patch) };
    for (const listener of listeners) listener(changes, "local");
  };
  window.chrome = {
    i18n: { getUILanguage: () => "zh-TW" },
    runtime: { id: "fixture", getManifest: () => ({ version: "test" }), sendMessage: async (message) => {
      if (message.type === "journal") {
        if (message.read === true) return { ok: true, value: clone(logs), states: [] };
        if (message.clear === true) logs.length = 0;
        else if (message.entry) {
          logs.push(clone(message.entry));
          await set({ journal: clone(logs) });
        }
        return { ok: true };
      }
      if (message.type === "mutate") {
        ops.push(clone(message));
        return window.OshiDeck.store.runOp(message.op, message.args);
      }
      return { ok: true, value: [] };
    } },
    storage: { local: { get: async () => clone(stored), set },
      onChanged: { addListener: (listener) => listeners.add(listener) } }
  };
  for (const script of document.querySelectorAll("script[src]")) {
    const path = script.getAttribute("src");
    const source = readFileSync(process.env[overrides[path]] || new URL(path, root), "utf8");
    window.eval(`${source}\n//# sourceURL=${path}`);
  }
  async function settle() {
    for (let i = 0; i < 12; i++) await new Promise((done) => setImmediate(done));
    if (errors.length) throw errors[0];
  }
  async function advance(ms) {
    if (!fakeTime) throw new Error("advance requires fakeTime");
    await settle();
    const until = clock + ms;
    for (let step = 0; step < 100; step++) {
      const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) { clock = until; await settle(); return; }
      const [id, timer] = due;
      timers.delete(id);
      clock = timer.at;
      await timer.fn();
      await settle();
    }
    throw new Error("options page did not settle");
  }
  await settle();
  return { window, document, settle, advance, ops, logs, read: () => clone(stored), close: () => { timers.clear(); window.close(); } };
}
