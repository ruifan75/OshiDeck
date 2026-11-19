(() => {
  const OD = (globalThis.OshiDeck ||= {});
  const KEY = "privacyConsent";
  const VERSION = 1;

  async function enabled() {
    try {
      const data = await chrome.storage.local.get(KEY);
      return data[KEY] === VERSION;
    } catch (_) {
      return false;
    }
  }

  function whenEnabled(start, waiting) {
    let started = false;
    function begin() {
      if (started) return;
      started = true;
      chrome.storage.onChanged.removeListener(changed);
      start();
    }
    function changed(changes, area) {
      if (area === "local" && changes[KEY]?.newValue === VERSION) begin();
    }
    chrome.storage.onChanged.addListener(changed);
    enabled().then((allowed) => {
      if (allowed) begin();
      else if (!started) waiting?.();
    });
  }

  async function get(keys) {
    const reply = await chrome.runtime.sendMessage({ type: "readStorage", keys });
    if (!reply?.ok) throw new Error("Local data unavailable");
    return reply.value;
  }

  OD.privacy = { KEY, VERSION, enabled, whenEnabled, get };
})();
