// Bounded diagnostics, independent of the card store. Only explicitly allowed
// shapes leave a page; wording, filenames, raw exceptions and DOM never do.
(() => {
  const OD = (globalThis.OshiDeck ||= {});
  const KEY = "journal", STATE_KEY = "journalState", LIMIT = 300;
  const STATE_KINDS = new Set(["environment", "channel", "unresolved", "panel", "draw", "colour", "settings"]);
  const values = (text) => new Set(text.split(" "));
  const enums = Object.assign(Object.create(null), {
    kind: values("environment channel unresolved note error panel draw operation settings colour play preset file"),
    surface: values("watch chat popout options worker"),
    what: values("stepped-aside emoji-corrected no-send-button no-mount-point uncaught unhandled-rejection worker-unavailable storage-read storage-write stopped"),
    reason: values("input-not-rendered no-channel empty folded pool filter-empty ready disabled holding drawn no-burst below-min below-share ineligible membership elsewhere busy no-input leftover rejected storage-read storage-write worker-unavailable invalid-json invalid-file wrong-channel unknown-op exception context-invalidated"),
    status: values("ok failed rejected absent loaded invalid unreadable index-invalid index-unreadable clicked timeout filled refused requested"),
    source: values("bundled backup preset"),
    stage: values("read apply fetch validate send input render"),
    mode: values("hand list"), cardSize: values("small medium large"),
    sortBy: values("manual uses heat trend"), language: new Set(["", "ja", "zh-TW", "en"]),
    draw: values("shy normal eager"), hold: values("short normal long"), pace: values("quick normal slow"),
    colourSource: values("stored-neutral stored-hex stored-hue representative-neutral representative-hex representative-hue automatic"),
    filter: values("all channel global"), poolTab: values("mine offered"),
    membership: values("yes no unknown"),
    via: values("meta owner-link card-by-handle cards-agree player-response"),
    player: values("fresh stale-or-absent"),
    ownerBlock: new Set(["none", "ytd-video-owner-renderer", "ytd-watch-metadata #owner", "#owner"]),
    errorType: values("Error TypeError RangeError ReferenceError SyntaxError URIError EvalError AggregateError DOMException QuotaExceededError SecurityError NotFoundError AbortError InvalidStateError InvalidAccessError NetworkError TimeoutError DataCloneError NotAllowedError"),
    op: values("addCard loadPreset editCard markUsed addToDeck removeFromDeck insertIntoDeck addToDeckAt reorderDeck deleteCard restoreCard deleteDeck restoreDeck setScope setSettings setChannel importBackup"),
    importMode: values("merge replace")
  });
  const numbers = values("at firstAt repeat seq cards decks count added reused linked shown offered mine waiting width height dpr min share messages candidates belowMin belowShare ineligible qualified maxCount owned noSubstance membershipBlocked elsewhereBlocked holdMs paceMs hits hue line column durationMs rows");
  const bools = values("autoSend folded suggest empty pool input inputHasContent inputIsPinned member attached duplicate ownerLink handle meta framed drawn");
  const channelId = (v) => typeof v === "string" && /^UC[A-Za-z0-9_-]{22}$/.test(v);
  const settingKeys = values("autoSend mode folded cardSize rows sortBy suggest draw hold pace language");

  function settings(raw) {
    const out = {};
    for (const key of settingKeys) {
      const v = raw?.[key];
      if (enums[key]?.has(v) || bools.has(key) && typeof v === "boolean" ||
          key === "rows" && [1, 2].includes(v) ||
          ["hold", "pace"].includes(key) && typeof v === "number" && Number.isFinite(v) && v >= 1000 && v <= 600000) out[key] = v;
    }
    return out;
  }

  function clean(entry) {
    if (!entry || typeof entry !== "object" || !enums.kind.has(entry.kind)) return null;
    const out = { kind: entry.kind };
    for (const [key, value] of Object.entries(entry)) {
      if (enums[key]?.has(value)) out[key] = value;
      else if (numbers.has(key) && typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e15) out[key] = value;
      else if (bools.has(key) && typeof value === "boolean") out[key] = value;
      else if (["id", "channelId", "from", "to"].includes(key) && channelId(value)) out[key] = value;
      else if (key === "video" && typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value)) out.video = value;
      else if (key === "cardIds" && Array.isArray(value)) out.cardIds = value.filter(channelId).slice(0, 20);
      else if (key === "card" && typeof value === "string" && /^c\d{1,12}$/.test(value)) out.card = value;
      else if (key === "session" && typeof value === "string" && /^[a-z0-9-]{1,64}$/i.test(value)) out.session = value;
      else if (key === "code" && typeof value === "string" && /^validation\.[A-Za-z]{1,60}$/.test(value)) out.code = value;
      else if (key === "color" && typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) out.color = value.toUpperCase();
      else if (key === "settings") out.settings = settings(value);
      else if (key === "file" && typeof value === "string" && /^(?:content|options|background|src\/(?:store|tokens|backup|trending|journal|presets|i18n|layout|channel-marks))\.js$/.test(value)) out.file = value;
    }
    return out;
  }

  const signature = (entry) => {
    const { at, firstAt, repeat, seq, ...rest } = entry;
    return JSON.stringify(rest);
  };

  function append(entries, entry) {
    const next = clean(entry);
    const list = (Array.isArray(entries) ? entries : []).map(clean).filter(Boolean).slice(-LIMIT);
    if (!next) return list;
    const last = list.at(-1);
    if (last && signature(last) === signature(next)) {
      list[list.length - 1] = { ...next, firstAt: last.firstAt ?? last.at, repeat: (last.repeat || 1) + 1 };
    } else list.push(next);
    return list.slice(-LIMIT);
  }

  // Last observations survive a busy action log. Session ids distinguish tabs
  // and worker restarts; these are observations, not a claim a tab is still open.
  function states(previous, entries) {
    const map = new Map();
    for (const raw of [...(Array.isArray(previous) ? previous : []), ...entries]) {
      const entry = clean(raw);
      if (!entry || !STATE_KINDS.has(entry.kind)) continue;
      const key = `${entry.session || "legacy"}/${entry.kind}`;
      map.delete(key);
      map.set(key, entry);
    }
    return [...map.values()].slice(-64);
  }

  let surface = "watch", session = globalThis.crypto?.randomUUID?.() || `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let seq = 0, sink = null;
  const seen = new Map(), aliases = new Map();
  let nextAlias = 0;
  const fallback = [];

  function cardId(id) {
    if (id == null) return undefined;
    if (!aliases.has(id)) {
      if (aliases.size >= 1000) aliases.delete(aliases.keys().next().value);
      aliases.set(id, `c${++nextAlias}`);
    }
    return aliases.get(id);
  }

  function record(entry) {
    try {
      const full = clean({ ...entry, surface, session, at: Date.now() });
      if (!full) return;
      const key = `${full.kind}/${full.channelId || full.id || ""}`;
      const sig = signature(full), last = seen.get(key);
      const decision = JSON.stringify([full.reason, full.video, full.card, full.attached, full.membership,
        full.min, full.share, full.holdMs, full.paceMs]);
      if (STATE_KINDS.has(full.kind) && last?.sig === sig) return;
      // Counters can change on every chat row. A changed decision is immediate;
      // repeated counters for the same draw decision are sampled twice a minute.
      if (full.kind === "draw" && last?.decision === decision && full.at - last.at < 30000) return;
      if (seen.size >= 100) seen.delete(seen.keys().next().value);
      seen.set(key, { sig, at: full.at, decision });
      full.seq = ++seq;
      const lost = () => { fallback.push(full); if (fallback.length > LIMIT) fallback.shift(); };
      if (sink) { sink(full); return; }
      try {
        chrome.runtime.sendMessage({ type: "journal", entry: full })?.then?.((reply) => {
          if (!reply?.ok) lost();
        }, lost);
      } catch (_) { lost(); }
    } catch (_) { /* diagnostics must never break an action */ }
  }

  function snapshot(data, extra = {}) {
    if (!data) return clean({ kind: "environment", surface, session, at: Date.now(), status: "failed", reason: "storage-read", ...extra });
    return clean({ kind: "environment", surface, session, at: Date.now(),
      settings: settings(data?.settings), cards: Array.isArray(data?.cards) ? data.cards.length : 0,
      decks: Object.keys(data?.decks || {}).length, ...extra });
  }

  async function report() {
    try {
      const reply = await chrome.runtime.sendMessage({ type: "journal", read: true });
      if (reply?.ok && Array.isArray(reply.value)) return {
        entries: [...reply.value, ...fallback].reduce(append, []), states: states(reply.states, [])
      };
    } catch (_) { /* try the persisted report if the worker is unavailable */ }
    let raw = {};
    try { raw = await chrome.storage.local.get([KEY, STATE_KEY]); } catch (_) { /* local memory still helps */ }
    return { entries: [...(Array.isArray(raw[KEY]) ? raw[KEY] : []), ...fallback].reduce(append, []), states: states(raw[STATE_KEY], []) };
  }
  const read = async () => (await report()).entries;

  function observe(where) {
    surface = where;
    globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
      if (area === "local" && [KEY, STATE_KEY].some((key) => Object.hasOwn(changes, key) && changes[key].newValue === undefined)) reset();
    });
    const prefix = `chrome-extension://${globalThis.chrome?.runtime?.id}/`;
    const capture = (error, filename = "", line, column, what = "uncaught") => {
      const stack = typeof error?.stack === "string" ? error.stack : "";
      if (!["options", "worker"].includes(surface) && !filename.startsWith(prefix) && !stack.includes(prefix)) return;
      const frame = /\/(content|options|background|src\/(?:store|tokens|backup|trending|journal|presets|i18n|layout|channel-marks))\.js(?::(\d+):(\d+))?/.exec(filename || stack);
      record({ kind: "error", what, errorType: error?.name || "Error", file: frame ? `${frame[1]}.js` : undefined,
        line: line || Number(frame?.[2]) || undefined, column: column || Number(frame?.[3]) || undefined });
    };
    globalThis.addEventListener?.("error", (event) => capture(event.error, event.filename, event.lineno, event.colno));
    globalThis.addEventListener?.("unhandledrejection", (event) => capture(event.reason, "", 0, 0, "unhandled-rejection"));
  }

  function reset() {
    seen.clear();
    fallback.length = 0;
  }

  const pad = (n) => String(n).padStart(2, "0");
  const clock = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  function line(raw) {
    try {
      const entry = clean(raw);
      if (!entry) return "";
      const { at, kind, repeat, ...rest } = entry;
      const body = Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ");
      return `${clock(at)}  ${kind}${repeat > 1 ? ` ×${repeat}` : ""}  ${body}`;
    } catch (_) { return ""; }
  }
  function format(entries, version, current, observed = []) {
    const lines = (Array.isArray(entries) ? entries : []).map(line).filter(Boolean);
    return ["OshiDeck 診断ログ", `バージョン: ${version}`, `ブラウザ: ${globalThis.navigator?.userAgent || "?"}`,
      `書き出し: ${clock(Date.now())}`, `件数: ${lines.length}`, "",
      "パネルの状態・操作の結果・札を引くかどうかの判定・設定・読み込みや送信操作の結果を記録します。",
      "札やチャットの内容、閲覧者名、ファイル名、エラーの本文は入りません。札はセッションごとの仮の番号で表します。",
      OD.i18n.t("ui.journalPrivacy"),
      "clicked は送信ボタンを押した記録で、YouTubeが受理したことの確認ではありません。", "",
      "書き出し時の状態:", current ? line(current) : "", "",
      "最後に観察した状態（既に閉じたページを含む場合があります）:", ...states(observed, []).map(line),
      "-".repeat(64), ...lines, ""].join("\n");
  }

  OD.journal = { KEY, STATE_KEY, LIMIT, clean, settings, signature, append, states, record,
    cardId, snapshot, report, read, observe, reset, format, line, setSink: (fn) => { sink = fn; } };
})();
