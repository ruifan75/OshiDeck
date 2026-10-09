// What the panel decided, and what it had to work with when it decided it.
//
// Every wrong-channel report so far arrived as a screenshot, and answering it
// meant opening the same stream and guessing at what the page had looked like
// an hour earlier. The panel already knows which source answered and which
// ones were missing; this keeps that, so a report can carry the evidence.
//
// Deliberately NOT one of store.KEYS. The panel re-renders whenever those
// change, and a log written during a render that causes a render is a loop.
// Staying out of that write also means a long log can never delay, or fail,
// a write that carries cards.
(() => {
  const OD = (globalThis.OshiDeck = globalThis.OshiDeck || {});

  const KEY = "journal";
  const LIMIT = 300;

  // Everything except when it happened and how often. Two entries with the
  // same signature are the same observation, so the log says "×12" instead of
  // repeating it twelve times and pushing the interesting part off the end.
  const signature = (entry) => {
    const { at, repeat, ...rest } = entry;
    return JSON.stringify(rest);
  };

  function append(entries, entry) {
    const list = Array.isArray(entries) ? entries.slice() : [];
    const last = list[list.length - 1];

    if (last && signature(last) === signature(entry)) {
      list[list.length - 1] = { ...last, at: entry.at, repeat: (last.repeat || 1) + 1 };
      return list;
    }

    list.push(entry);
    return list.slice(-LIMIT);
  }

  async function read() {
    try {
      const raw = await chrome.storage.local.get(KEY);
      return Array.isArray(raw[KEY]) ? raw[KEY] : [];
    } catch (_) {
      return []; // extension reloaded out from under us
    }
  }

  // Sent, never written. The worker owns every write, so a log entry cannot
  // interleave with a card operation and cost someone a card.
  let lastSent = null;

  function record(entry) {
    const full = { at: Date.now(), ...entry };
    const sig = signature(full);
    if (sig === lastSent) return; // this context already said exactly this
    lastSent = sig;

    try {
      chrome.runtime.sendMessage({ type: "journal", entry: full })?.catch?.(() => {});
    } catch (_) { /* no worker to tell: losing a log line is not worth an error */ }
  }

  const pad = (n) => String(n).padStart(2, "0");

  const clock = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  function line(entry) {
    // The log is the thing you reach for when something has already gone
    // wrong, so it has to survive its own contents being wrong.
    if (!entry || typeof entry !== "object") return "";
    try {
      return written(entry);
    } catch (_) {
      return ""; // a value whose own toString throws is still not worth the log
    }
  }

  function written(entry) {
    const { at, kind, repeat, ...rest } = entry;
    const body = Object.entries(rest)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) =>
        `${key}=${typeof value === "object" ? JSON.stringify(value) : value}`)
      .join(" ");
    return `${clock(at)}  ${kind}${repeat > 1 ? ` ×${repeat}` : ""}  ${body}`;
  }

  function format(entries, version) {
    return [
      "OshiDeck 診断ログ",
      `バージョン: ${version}`,
      `ブラウザ: ${globalThis.navigator?.userAgent || "?"}`,
      `書き出し: ${clock(Date.now())}`,
      `件数: ${entries.length}`,
      "",
      "記録しているのは、チャンネルID・動画ID・どの手段で判定したか、",
      "そして判定できなかったときにページに何があったかだけです。",
      "札の中身も、チャットの内容も入っていません。",
      "-".repeat(64),
      ...entries.map(line).filter(Boolean),
      ""
    ].join("\n");
  }

  OD.journal = { KEY, LIMIT, signature, append, read, record, format, line };
})();
