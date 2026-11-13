// The real worker and production modules. Only Chrome's boundaries are faked.
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const root = new URL("../../", import.meta.url);
export function backgroundPage({ files = {} } = {}) {
  let disk = { cards: [], decks: {}, settings: {}, channelMeta: {} };
  const writes = [], events = new Map();
  let listener;
  let heldLog = null;
  let heldClear = null;
  const faults = { log: false, cards: false, read: false, clear: false };
  const clone = (v) => structuredClone(v);
  const chrome = {
    action: { onClicked: { addListener() {} } },
    runtime: { id: "fixture", getURL: (path) => `chrome-extension://fixture/${path}`,
      getManifest: () => ({ version: "test" }), openOptionsPage() {},
      onMessage: { addListener(fn) { listener = fn; } },
      sendMessage: (message) => send(message) },
    storage: { local: {
      get: async () => { if (faults.read) throw new Error("read failed"); return clone(disk); },
      set: async (patch) => {
        if ("journal" in patch && heldLog) await heldLog;
        if (faults.log && "journal" in patch || faults.cards && "cards" in patch) throw new Error("write failed");
        writes.push(clone(patch)); Object.assign(disk, clone(patch));
      },
      remove: async (keys) => {
        if (heldClear) await heldClear;
        if (faults.clear) throw new Error("remove failed");
        for (const key of Array.isArray(keys) ? keys : [keys]) delete disk[key];
      }
    } }
  };
  const context = vm.createContext({ chrome, console, performance, crypto: { randomUUID },
    addEventListener: (name, fn) => events.set(name, fn),
    fetch: async (url) => {
      const file = url.replace("chrome-extension://fixture/", "");
      if (!(file in files) || files[file] instanceof Error) throw new Error("missing fixture");
      return { json: async () => clone(files[file]) };
    } });
  const overrides = { store: "OD_STORE", journal: "OD_JOURNAL", presets: "OD_PRESETS" };
  for (const name of ["i18n", "tokens", "backup", "store", "journal", "presets"]) {
    const path = `src/${name}.js`;
    vm.runInContext(readFileSync(process.env[overrides[name]] || new URL(path, root), "utf8"), context, { filename: path });
  }
  const source = readFileSync(process.env.OD_BACKGROUND || new URL("background.js", root), "utf8");
  vm.runInContext(source.replace(/^import "\.\/src\/[^"\n]+";\n/gm, ""), context, { filename: "background.js" });
  async function send(message) {
    return new Promise((resolve, reject) => {
      try { if (listener(message, {}, resolve) === false) resolve(undefined); } catch (error) { reject(error); }
    });
  }
  async function settle() { for (let i = 0; i < 15; i++) await new Promise((done) => setImmediate(done)); }
  return { send, settle, faults, writes, journal: context.OshiDeck.journal,
    pauseLog() {
      let release;
      heldLog = new Promise((done) => { release = done; });
      return () => { heldLog = null; release(); };
    },
    pauseClear() {
      let release;
      heldClear = new Promise((done) => { release = done; });
      return () => { heldClear = null; release(); };
    },
    emit: (name, value) => events.get(name)?.(value), read: () => clone(disk) };
}
