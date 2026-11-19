// Only the extension worker opens this database. Page contexts use its messages.
(() => {
  const OD = globalThis.OshiDeck;
  const { KEY, VERSION } = OD.privacy;
  const encoder = new globalThis.TextEncoder();
  const decoder = new globalThis.TextDecoder();
  let database;
  let keyPromise;

  async function open() {
    if (!database) {
      database = new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open("oshideck", 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("keys");
          request.result.createObjectStore("data");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }).catch((error) => {
        database = null;
        throw error;
      });
    }
    return database;
  }

  async function transaction(table, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(table, mode);
      tx.onabort = () => reject(tx.error || new Error("Local database transaction was aborted"));
      try {
        const requests = work(tx.objectStore(table));
        tx.oncomplete = () => resolve(requests.map((request) => request.result));
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  }

  async function key(create = false) {
    if (!keyPromise) {
      keyPromise = (async () => {
        const [saved] = await transaction("keys", "readonly", (table) => [table.get("aes")]);
        if (saved) return saved;
        const [count] = await transaction("data", "readonly", (table) => [table.count()]);
        if (!create || count) throw new Error("Local encryption key is unavailable");
        const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        await transaction("keys", "readwrite", (table) => [table.add(generated, "aes")]);
        return generated;
      })().catch((error) => {
        keyPromise = null;
        throw error;
      });
    }
    return keyPromise;
  }

  const keyList = (keys) => Array.isArray(keys) ? keys : [keys];

  async function get(keys) {
    const names = keyList(keys);
    const values = await transaction("data", "readonly", (table) => names.map((name) => table.get(name)));
    const entries = await Promise.all(names.map(async (name, index) => {
      const sealed = values[index];
      if (sealed === undefined) return null;
      const bytes = await crypto.subtle.decrypt({
        name: "AES-GCM", iv: sealed.iv, additionalData: encoder.encode(name)
      }, await key(), sealed.bytes);
      return [name, JSON.parse(decoder.decode(bytes))];
    }));
    return Object.fromEntries(entries.filter(Boolean));
  }

  async function save(patch) {
    const entries = Object.entries(patch);
    if (!entries.length) return;
    const secret = await key(true);
    const sealed = await Promise.all(entries.map(async ([name, value]) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = await crypto.subtle.encrypt({
        name: "AES-GCM", iv, additionalData: encoder.encode(name)
      }, secret, encoder.encode(JSON.stringify(value)));
      return [name, { iv, bytes }];
    }));
    await transaction("data", "readwrite", (table) => sealed.map(([name, value]) => table.put(value, name)));
  }

  // Chrome storage keeps only consent and change signals. The data transaction
  // above commits the entire patch before other contexts are notified.
  const signals = (keys) => Object.fromEntries(keys.map((name) => [name, crypto.randomUUID()]));

  async function set(patch) {
    await save(patch);
    // A notification failure must not invite a retry of an already committed operation.
    await chrome.storage.local.set(signals(Object.keys(patch))).catch(() => {});
  }

  async function remove(keys) {
    const names = keyList(keys);
    await transaction("data", "readwrite", (table) => names.map((name) => table.delete(name)));
    await chrome.storage.local.remove(names).catch(() => {});
  }

  async function enable(keys) {
    if (await OD.privacy.enabled()) return;
    const legacy = await chrome.storage.local.get(keys);
    // Legacy records are arrays or objects. A renewed consent may see string
    // change signals instead, which must never replace encrypted records.
    const records = Object.entries(legacy).filter(([, value]) => value && typeof value === "object");
    await save(Object.fromEntries(records));
    // A failed migration leaves the original values and consent untouched.
    await chrome.storage.local.set({ ...signals(Object.keys(legacy)), [KEY]: VERSION });
  }

  OD.vault = { get, set, remove, enable };
})();
