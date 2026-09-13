const { store, tokens } = globalThis.OshiDeck;

const DEFAULTS = {
  autoSend: false,
  suggest: true,
  mode: "hand",
  cardSize: "small",
  rows: 2,
  sortBy: "heat"
};

const SIZE_LABEL = { large: "大", medium: "中", small: "小" };

const SORT_LABEL = {
  trend: "チャット連動",
  heat: "最近よく使う順",
  uses: "使った回数順",
  manual: "自分で並べた順"
};

const SORT_NOTE = {
  trend: "いまチャットで流れている反応に合う札を前に出します。新しい発言ほど重く数え（半減期25秒）、4秒ごとに並べ替え。カーソルが札の上にある間は動きません。",
  heat: "古い使用ほど軽く数えます（半減期1週間）。",
  uses: "使った回数の合計。ずっと前によく使った札も上に残ります。",
  manual: "編成ページでドラッグして決めた順。勝手に動きません。"
};
const SIDEBAR_WIDTH = 400;
const PANEL_PADDING = 24;

let settings = { ...DEFAULTS };

function paint() {
  document.querySelector(`input[name="mode"][value="${settings.mode}"]`).checked = true;
  document.querySelector("#autoSend").checked = !!settings.autoSend;
  document.querySelector("#suggest").checked = settings.suggest !== false;

  for (const group of document.querySelectorAll(".segmented[data-setting]")) {
    const key = group.dataset.setting;
    for (const button of group.querySelectorAll("button")) {
      button.classList.toggle("on", String(settings[key]) === button.value);
    }
  }

  // Show what the current size and row count actually buy in a 400px sidebar.
  const { CARD_SIZE, cardsPerRow } = globalThis.OshiDeck.layout;
  const perRow = cardsPerRow(SIDEBAR_WIDTH - PANEL_PADDING, CARD_SIZE[settings.cardSize]);
  document.querySelector("#capacity").textContent =
    `${SIZE_LABEL[settings.cardSize]} × ${settings.rows}行 = 最大${perRow * settings.rows}枚`;

  document.querySelector("#sortNote").textContent = SORT_NOTE[settings.sortBy] || "";

  // Say the actual numbers. A step called ふつう tells nobody what it will do,
  // and these are the values the panel was reported as getting wrong.
  const draw = store.tuning(settings, "draw");
  document.querySelector("#drawNote").textContent =
    `12秒のあいだに同じ言葉が${draw.min}回以上、かつその間の発言の${Math.round(draw.share * 100)}%以上で引きます。` +
    "賑やかなチャットほど、ひかえめが要ります。";
  document.querySelector("#holdNote").textContent =
    `引いた札は${store.tuning(settings, "hold") / 1000}秒そのまま残ります。` +
    "短くすると入れ替わりが速く、カーソルの下で変わりやすくなります。";
  document.querySelector("#paceNote").textContent =
    `「チャット連動」の重みが半分になるまで${store.tuning(settings, "pace") / 1000}秒。` +
    "速いほど直前の波にすぐ反応し、遅いほど落ち着きます。";
}

async function commit(patch) {
  // Through the worker like everything else. Written directly, a settings
  // click racing a replace import lost whichever set() landed second.
  const { ok, value } = await store.apply("setSettings", { patch });
  if (!ok) return;
  settings = value;
  paint();

  const saved = document.querySelector("#saved");
  saved.textContent = "保存しました";
  clearTimeout(commit.timer);
  commit.timer = setTimeout(() => (saved.textContent = ""), 1200);
}

async function load() {
  const stored = await chrome.storage.local.get("settings");
  settings = { ...DEFAULTS, ...(stored.settings || {}) };
  paint();
}

for (const input of document.querySelectorAll('input[name="mode"]')) {
  input.addEventListener("change", () => commit({ mode: input.value }));
}

for (const group of document.querySelectorAll(".segmented[data-setting]")) {
  const key = group.dataset.setting;
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    commit({ [key]: key === "rows" ? Number(button.value) : button.value });
  });
}

document.querySelector("#suggest").addEventListener("change", (event) => {
  commit({ suggest: event.target.checked });
});

document.querySelector("#autoSend").addEventListener("change", (event) => {
  commit({ autoSend: event.target.checked });
});

load();

/* ---------------- deck browser ---------------- */

let decks = null;
let selected = null;   // channel id, or null when nothing is saved yet
let undo = null;
let query = "";
let dragging = null;   // { card, from: "deck" | "pool" }

// One list, in store.js — it had been written out here as well, and two
// copies of a palette only stay the same by luck.
const { HUES } = store;

async function loadDecks() {
  const data = await store.read();
  if (!data) return;

  decks = data;
  const known = deckIds();
  if (!known.includes(selected)) selected = known[0] ?? null;
  paintDecks();
}

const deckIds = () => Object.keys(decks.decks || {});

const cardsOf = (id) => (id ? store.deckOf(decks, id) : []);
const hueOf = (id) => (id ? decks.channelMeta[id]?.hue ?? store.defaultHue(id) : 320);
const nameOf = (id) => (id ? decks.channelMeta[id]?.name || id : "");

function paintDecks() {
  const ids = deckIds();

  const list = document.querySelector("#deckList");
  list.replaceChildren();

  if (!ids.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "配信ページで札を保存するとデッキができます。";
    list.appendChild(empty);
  }

  for (const id of ids) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "deck-row";
    if (id === selected) row.dataset.on = "true";

    const dot = document.createElement("span");
    dot.className = "deck-dot";
    dot.style.setProperty("--hue", hueOf(id));

    const name = document.createElement("span");
    name.className = "deck-name";
    name.textContent = nameOf(id);

    const count = document.createElement("span");
    count.className = "muted";
    count.textContent = cardsOf(id).length;

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "deck-delete";
    drop.textContent = "×";
    drop.title = "このデッキを削除（このチャンネル専用の札も一緒に消えます）";
    drop.setAttribute("aria-label", `${nameOf(id)} のデッキを削除`);
    drop.addEventListener("click", (event) => {
      event.stopPropagation();
      removeDeck(id);
    });

    row.append(dot, name, count, drop);
    row.addEventListener("click", () => { selected = id; paintDecks(); });
    list.appendChild(row);
  }

  paintHeader();
  paintCards();
  paintPool();
}

function paintHeader() {
  const header = document.querySelector("#deckHeader");
  header.replaceChildren();
  if (!selected) return;

  const title = document.createElement("strong");
  title.textContent = nameOf(selected);

  const swatches = document.createElement("div");
  swatches.className = "swatches";
  const label = document.createElement("small");
  label.textContent = "推し色";
  swatches.appendChild(label);

  const current = hueOf(selected);

  for (const hue of HUES) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.style.setProperty("--hue", hue);
    swatch.setAttribute("aria-label", `推し色 ${hue}`);
    if (hue === current) swatch.dataset.on = "true";
    swatch.addEventListener("click", () => setHue(selected, hue));
    swatches.appendChild(swatch);
  }

  // Any hue, not only the eight. What is stored is still a hue: the palette
  // fixes lightness and chroma so every channel reads the same against the
  // panel, and a colour picked from anywhere is asked only what hue it is.
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "hue-slider";
  slider.min = "0";
  slider.max = "359";
  slider.value = String(current);
  slider.style.setProperty("--hue", current);
  slider.setAttribute("aria-label", "推し色を細かく選ぶ");
  // The thumb follows the drag; the write waits for the release, or every
  // pixel of it would be an operation through the worker.
  slider.addEventListener("input", (event) =>
    event.target.style.setProperty("--hue", event.target.value));
  slider.addEventListener("change", (event) =>
    setHue(selected, Number(event.target.value)));

  // The native picker carries both of the other ways of asking: a colour code,
  // and the eyedropper in the system colour panel.
  const picker = document.createElement("input");
  picker.type = "color";
  picker.className = "hue-pick";
  picker.value = store.hexOfHue(current);
  picker.style.setProperty("--hue", current);
  picker.setAttribute("aria-label", "色から選ぶ（カラーコード・スポイト）");
  picker.addEventListener("change", (event) => {
    const hue = store.hueFromHex(event.target.value);
    if (hue != null) setHue(selected, hue);
  });

  swatches.append(slider, picker);
  header.append(title, swatches);
}

// Apply a change to the freshest stored state, never to the snapshot this page
// has been holding. The chat panel writes usage counts as cards are played, so
// saving a wholesale snapshot read minutes ago silently rolls them back.
// Every change is a named operation sent to the service worker, which applies
// them one at a time against freshly-read state. Nothing here writes storage.
async function mutate(op, args) {
  const reply = await store.apply(op, args);
  if (!reply.ok) {
    status("保存できませんでした");
    return reply;
  }
  const data = await store.read();
  if (data) decks = data;
  paintDecks();
  return reply;
}

const setHue = (id, hue) => mutate("setChannel", { channelId: id, hue });

// A card, rendered the same in either pane. `where` decides what dragging it
// means and which actions it offers.
function buildCard(card, where) {
  const el = document.createElement("div");
  el.className = "browse-card";
  el.draggable = true;
  if (where === "deck") el.style.setProperty("--hue", hueOf(selected));

  const body = document.createElement("div");
  body.className = "browse-body";
  body.appendChild(tokens.toFragment(card.tokens || [], { preview: true }));

  const meta = document.createElement("div");
  meta.className = "browse-meta";
  meta.textContent = card.uses ? `${card.uses}回` : "未使用";

  el.append(body, meta);
  wireDrag(el, card, where);

  const bound = tokens.requiredChannels(card.tokens).length > 0;
  if (!bound) el.dataset.universal = "true";

  // Every card has a pool to fall back to now, so leaving a deck always means
  // the same thing wherever you do it.
  if (where === "deck") {
    el.appendChild(cardAction("⏏", "このデッキから外す（プールに戻ります）",
      () => ejectCard(card)));
  } else {
    el.appendChild(cardAction("×", "この札を削除（すべてのデッキから消えます）",
      () => removeCard(card, el)));
  }
  return el;
}

// An empty deck is the one place a preset is worth offering: a starting hand
// for a channel nobody has played yet. It is never offered over a deck that
// already has something in it.
let bundled = null;

async function loadBundled() {
  if (bundled) return bundled;
  try {
    const reply = await chrome.runtime.sendMessage({ type: "presets" });
    bundled = reply?.ok && Array.isArray(reply.value) ? reply.value : [];
  } catch (_) {
    bundled = [];
  }
  return bundled;
}

function presetOffer() {
  const holder = document.createElement("div");
  holder.className = "preset-offer";

  loadBundled().then((list) => {
    if (!list.length || !selected) return;

    const line = document.createElement("small");
    line.textContent = "はじめの一組を入れることもできます:";
    holder.appendChild(line);

    for (const preset of list) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "action";
      button.textContent = `${preset.name}（${preset.cards.length}枚）`;
      if (preset.note) button.title = preset.note;
      button.addEventListener("click", () => usePreset(preset));
      holder.appendChild(button);
    }
  });

  return holder;
}

async function usePreset(preset) {
  const cards = presets.cardsFor(preset, selected);
  const { ok, value } = await mutate("loadPreset", { channelId: selected, cards });
  if (!ok || !value) return;

  // Reused rather than copied: the pool already had some of these, and two
  // cards with the same words would both answer to the same reaction.
  const note = value.reused
    ? `（うち${value.reused}枚はプールにあったものを使いました）`
    : "";
  status(`「${preset.name}」を読み込みました${note}`);
}

function cardAction(glyph, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "browse-remove";
  button.textContent = glyph;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function paintCards() {
  const holder = document.querySelector("#deckCards");
  const hint = document.querySelector("#deckHint");
  holder.replaceChildren();

  if (!selected) {
    hint.textContent = "";
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "デッキがありません。";
    holder.appendChild(empty);
    return;
  }

  hint.textContent =
    settings.sortBy === "manual"
      ? "右のプールからドラッグして追加、札同士をドラッグで並べ替え。"
      : `並べ替えはできますが、配信ページは「${SORT_LABEL[settings.sortBy]}」で表示中です。`;

  const cards = cardsOf(selected);
  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "右のプールから札をドラッグしてください。";
    holder.append(empty, presetOffer());
    return;
  }

  for (const card of cards) holder.appendChild(buildCard(card, "deck"));
}

// The pool holds the cards that can go into any deck. A card carrying member
// emoji cannot — it only sends on the channel that hands them out — so it is
// not pool material and never appears here. What is left is the same list
// whatever deck is selected; the only per-deck fact is whether a card is
// already in it, and that is a mark on the card, not a reason to hide it.
function paintPool() {
  const holder = document.querySelector("#poolCards");
  holder.replaceChildren();

  const all = selected ? store.poolFor(decks, selected) : store.universal(decks);
  const shown = query
    ? all.filter((card) => tokens.toPlainText(card.tokens || []).toLowerCase().includes(query))
    : all;

  document.querySelector("#poolCount").textContent = query
    ? `${shown.length} / ${all.length}枚`
    : `${all.length}枚`;

  if (!shown.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = query
      ? "一致する札がありません。"
      : "追加できる札がありません。";
    holder.appendChild(empty);
    return;
  }

  for (const card of shown) holder.appendChild(buildCard(card, "pool"));
}

/* ---------------- dragging ---------------- */

function wireDrag(el, card, where) {
  el.addEventListener("dragstart", (event) => {
    dragging = { card, from: where };
    el.dataset.dragging = "true";
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.id); // Firefox needs a payload
  });

  el.addEventListener("dragend", () => {
    dragging = null;
    delete el.dataset.dragging;
    for (const node of document.querySelectorAll("[data-drop]")) delete node.dataset.drop;
  });

  if (where !== "deck") return;

  el.addEventListener("dragover", (event) => {
    if (!dragging || dragging.card.id === card.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const box = el.getBoundingClientRect();
    el.dataset.drop = event.clientX < box.left + box.width / 2 ? "before" : "after";
  });

  el.addEventListener("dragleave", () => delete el.dataset.drop);

  el.addEventListener("drop", async (event) => {
    if (!dragging) return;
    event.preventDefault();
    event.stopPropagation();
    const side = el.dataset.drop || "before";
    delete el.dataset.drop;
    await dropOnDeck(dragging, { target: card, side });
  });
}

function wireDeckDrop(holder) {
  holder.addEventListener("dragover", (event) => {
    if (!dragging || !selected) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    holder.dataset.drop = "into";
  });
  holder.addEventListener("dragleave", () => delete holder.dataset.drop);
  holder.addEventListener("drop", async (event) => {
    delete holder.dataset.drop;
    if (!dragging || !selected) return;
    event.preventDefault();
    await dropOnDeck(dragging, {});
  });
}

function wirePoolDrop(pane) {
  pane.addEventListener("dragover", (event) => {
    if (dragging?.from !== "deck") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    pane.dataset.drop = "into";
  });
  pane.addEventListener("dragleave", () => delete pane.dataset.drop);
  pane.addEventListener("drop", async (event) => {
    delete pane.dataset.drop;
    if (dragging?.from !== "deck") return;
    event.preventDefault();
    await ejectCard(dragging.card);
  });
}

// One entry point for both meanings of a drop on the deck: bringing a card in
// from the pool, and moving one that is already there.
// One entry point for both meanings of a drop on the deck: bringing a card in
// from the pool, and moving one that is already there.
async function dropOnDeck({ card, from }, { target, side }) {
  if (!selected) return;
  // Bubbling means a drop on the dragged card itself also reaches the holder;
  // reorderDeck would then fail to find its own target and append the card.
  if (target?.id === card.id) return;

  const joined = from === "pool";
  const into = selected; // `selected` moves; the deck that took the card does not

  // Add and position together: split across two messages, a failure between
  // them left the card appended while this reported success.
  if (joined) {
    const { ok } = await mutate("addToDeckAt", {
      channelId: into, cardId: card.id, targetId: target?.id, side: side || "before"
    });
    if (!ok) return;
  } else if (target) {
    await mutate("reorderDeck", {
      channelId: into, movedId: card.id, targetId: target.id, side: side || "before"
    });
  } else {
    // Dropped on the empty area: the holder offered itself as a target, so
    // send the card to the end rather than doing nothing.
    const list = decks.decks[into] || [];
    const last = list[list.length - 1];
    if (last && last !== card.id) {
      await mutate("reorderDeck", { channelId: into, movedId: card.id, targetId: last, side: "after" });
    }
  }

  if (joined) {
    undo = () => mutate("removeFromDeck", { channelId: into, cardId: card.id })
      .then((r) => r.ok && status("元に戻しました"));
    status(`「${label(card)}」を ${nameOf(into)} に入れました`, "元に戻す");
  } else if (settings.sortBy !== "manual") {
    status("並べ替えました（表示に反映するには並び順を「自分で並べた順」に）");
  }
}

async function ejectCard(card, deckId = selected) {
  const { ok, value: at } = await mutate("removeFromDeck", { channelId: deckId, cardId: card.id });
  if (!ok || at < 0) return;

  // insertIntoDeck tolerates whatever happened in the meantime: the card may
  // have been re-added from the chat panel, or deleted outright.
  undo = () => mutate("insertIntoDeck", { channelId: deckId, cardId: card.id, at })
    .then((r) => r.ok && status("元に戻しました"));

  status(`「${label(card)}」をデッキから外しました（プールに残っています）`, "元に戻す");
}

// Removing a deck keeps universal cards in the pool; cards only this channel
// can use go with it, since nothing else could ever show them.
async function removeDeck(id) {
  const was = nameOf(id) || id;
  const { ok, value: snapshot } = await mutate("deleteDeck", { channelId: id });
  if (!ok || !snapshot) return;

  if (selected === id) selected = Object.keys(decks.decks)[0] ?? null;
  paintDecks();

  undo = () => mutate("restoreDeck", { snapshot })
    .then((r) => r.ok && status("元に戻しました"));

  const note = snapshot.exclusive?.length
    ? `（このチャンネル専用の${snapshot.exclusive.length}枚も一緒に削除）`
    : "（札はプールに残っています）";
  status(`「${was}」のデッキを削除しました${note}`, "元に戻す");
}

// Deleting is from the pool, so it leaves every deck at once.
async function removeCard(card, el) {
  // A universal card can sit in several decks, and deleting it empties all of
  // them — say so before it happens, not after.
  const held = store.decksHolding(decks, card.id).filter((id) => id !== selected);
  if (!held.length) return deleteCardNow(card);

  // Pressing × again used to count as agreeing, which meant the second press
  // confirmed a warning nobody had read. Only the button in the question
  // answers it.
  if (el?.dataset.confirming) return;
  askOnCard(el, card, held);
}

async function deleteCardNow(card) {
  const { ok, value: snapshot } = await mutate("deleteCard", { id: card.id });
  if (!ok || !snapshot) return;

  undo = () => mutate("restoreCard", { snapshot })
    .then((r) => r.ok && status("元に戻しました"));

  status(`「${label(snapshot.card)}」を削除しました`, "元に戻す");
}

// Asked on the card, not in the status line. That line lives at the very
// bottom of the page at 12px and 72% opacity, while the card being deleted is
// wherever the pool happens to be scrolled to — so the warning was written
// somewhere the eye had no reason to be.
function askOnCard(el, card, held) {
  if (!el) return deleteCardNow(card); // no card to ask on: nothing to point at
  const names = held.map((id) => nameOf(id)).join("、");

  const ask = document.createElement("div");
  ask.className = "browse-confirm";
  ask.setAttribute("role", "group");
  ask.setAttribute("aria-label", `${names} のデッキにもあります。削除すると全部から消えます。`);

  const line = document.createElement("p");
  line.textContent = held.length === 1 ? "他のデッキにも" : `他${held.length}つのデッキにも`;

  const close = () => {
    ask.remove();
    delete el.dataset.confirming;
  };

  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "browse-confirm-yes";
  yes.textContent = "削除";
  yes.title = `${names} のデッキからも消えます`;
  yes.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
    deleteCardNow(card);
  });

  const no = document.createElement("button");
  no.type = "button";
  no.textContent = "やめる";
  no.addEventListener("click", (event) => { event.stopPropagation(); close(); });

  ask.append(line, yes, no);
  el.dataset.confirming = "true";
  el.appendChild(ask);
  no.focus(); // the safe one, so a stray Enter cancels
}

function label(card) {
  const text = tokens.toPlainText(card.tokens || []).trim();
  if (text) return text.length > 18 ? text.slice(0, 18) + "…" : text;
  const stamps = (card.tokens || []).filter((t) => t.type === "youtubeEmoji").length;
  return stamps ? `スタンプ${stamps}個` : "空の札";
}

function status(message, actionLabel, action) {
  const saved = document.querySelector("#saved");
  saved.replaceChildren(document.createTextNode(message));

  const run = action || (actionLabel && undo ? () => { const u = undo; undo = null; u?.(); } : null);
  if (actionLabel && run) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link";
    button.textContent = actionLabel;
    button.addEventListener("click", run);
    saved.appendChild(button);
  }

  clearTimeout(status.timer);
  status.timer = setTimeout(() => {
    saved.replaceChildren();
    // The snapshot can hold a whole deck's worth of cards; once the button is
    // gone there is nothing left to undo with it.
    undo = null;
  }, 8000);
}

// These two elements survive every repaint. Wiring them inside paint() added
// another set of listeners on every storage event, so one drop later fired a
// pile of redundant saves.
wireDeckDrop(document.querySelector("#deckCards"));
wirePoolDrop(document.querySelector("#pool"));

document.querySelector("#deckSearch").addEventListener("input", (event) => {
  query = event.target.value.trim().toLowerCase();
  paintPool();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // The journal is written while a stream is open. Only the keys the builder
  // actually draws from should redraw it.
  const watched = [store.KEYS.SETTINGS, store.KEYS.CARDS, store.KEYS.DECKS, store.KEYS.CHANNELS];
  if (watched.some((key) => changes[key])) loadDecks();
});

loadDecks();

/* ---------------- backup ---------------- */

const { backup } = globalThis.OshiDeck;

let importMode = "merge";
let pending = null; // a validated file waiting for an explicit go-ahead

function importStatus(message, actionLabel, onAction) {
  const line = document.querySelector("#importStatus");
  line.replaceChildren();
  if (!message) return;

  line.appendChild(document.createTextNode(message));
  if (!actionLabel) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "link";
  button.textContent = actionLabel;
  button.addEventListener("click", onAction);
  line.appendChild(button);
}

async function exportBackup() {
  const data = await store.read();
  if (!data) return;

  const payload = backup.toPayload(data, chrome.runtime.getManifest().version);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `oshideck-${stamp}.json`;
  a.click();
  // Revoking immediately can cancel the download in some builds.
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  importStatus(`${payload.cards.length}枚を書き出しました`);
}

async function readBackupFile(file) {
  pending = null;

  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch (_) {
    return importStatus("JSONとして読めませんでした");
  }

  const problem = backup.validate(raw);
  if (problem) return importStatus(`読み込めません: ${problem}`);

  const { cards, decks } = backup.summarise(raw);
  // Replacing throws away everything currently stored, so it never happens on
  // a single click — the file is only staged here.
  if (importMode === "replace") {
    pending = raw;
    return importStatus(
      `${file.name}: ${cards}枚 / ${decks}デッキ。今のデータをすべて捨てて置き換えます。`,
      "置き換える",
      () => applyImport()
    );
  }

  pending = raw;
  applyImport();
}

async function applyImport() {
  const raw = pending;
  // Captured before any await: clicking the other mode during the round trip
  // could otherwise turn a started merge into a replacement.
  const mode = importMode;
  pending = null;
  if (!raw) return;

  // The merge is computed inside the queued operation, against settled state.
  // Computing it here and sending the result would roll back anything that
  // committed while the message was in flight.
  const { ok, value } = await store.apply("importBackup", { raw, mode });
  if (!ok) return importStatus("保存できませんでした");

  importStatus(
    mode === "replace"
      ? `${value.count}枚に置き換えました`
      : value.added || value.linked
        ? `新しい札 ${value.added}枚、デッキへの追加 ${value.linked}件`
        : "すでに全部持っていました"
  );

  await load();
  await loadDecks();
}

for (const group of document.querySelectorAll("[data-choice]")) {
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    importMode = button.value;
    pending = null;
    importStatus("");
    for (const other of group.querySelectorAll("button")) {
      other.classList.toggle("on", other.value === importMode);
    }
    document.querySelector("#importNote").textContent =
      importMode === "replace"
        ? "今のプールとデッキをすべて捨てて、ファイルの内容にします。"
        : "同じ内容の札は重複しません。同じファイルを2回読んでも増えません。";
  });
  group.querySelector('button[value="merge"]').classList.add("on");
}

// A deck, as something to hand to someone who has none.
async function exportPreset() {
  if (!selected) return importStatus("デッキを選んでください");

  const name = nameOf(selected) || selected;
  const preset = presets.fromDeck(decks, selected, { name });

  const problem = presets.validate(preset);
  if (problem) return importStatus(`書き出せません: ${problem}`);

  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const slug = name.replace(/[^\w\u3040-\u30ff\u4e00-\u9faf-]+/g, "-").slice(0, 40) || "preset";
  const a = document.createElement("a");
  a.href = url;
  a.download = `oshideck-preset-${slug}.json`;
  a.click();
  // Revoking immediately can cancel the download in some builds.
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  const dropped = cardsOf(selected).length - preset.cards.length;
  importStatus(`${preset.cards.length}枚を書き出しました` +
    (dropped > 0 ? `（メン限スタンプの${dropped}枚は入りません）` : ""));
}

document.querySelector("#presetBtn").addEventListener("click", exportPreset);
document.querySelector("#exportBtn").addEventListener("click", exportBackup);
document.querySelector("#importBtn").addEventListener("click", () =>
  document.querySelector("#importFile").click());
document.querySelector("#importFile").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  event.target.value = ""; // so re-picking the same file fires again
  if (file) readBackupFile(file);
});

/* ---------------- diagnostics ---------------- */

const { journal, presets } = globalThis.OshiDeck;

const journalStatus = (text) => {
  document.querySelector("#journalStatus").textContent = text;
};

async function showJournalCount() {
  const entries = await journal.read();
  journalStatus(entries.length ? `${entries.length}件を記録しています` : "まだ記録はありません");
}

async function saveJournal() {
  const entries = await journal.read();
  if (!entries.length) return journalStatus("まだ記録がないので、書き出すものがありません");

  const text = journal.format(entries, chrome.runtime.getManifest().version);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `oshideck-log-${stamp}.txt`;
  a.click();
  // Revoking immediately can cancel the download in some builds.
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  journalStatus(`${entries.length}件を書き出しました`);
}

async function clearJournal() {
  // The worker owns the write, here as everywhere else. It reports a failed
  // write by resolving with ok:false — not by rejecting — so awaiting without
  // reading the answer announced success while the log still stood.
  let reply = null;
  try {
    reply = await chrome.runtime.sendMessage({ type: "journal", clear: true });
  } catch (_) {
    reply = null; // no worker to ask
  }

  journalStatus(reply?.ok ? "記録を消しました" : "消せませんでした");
}

document.querySelector("#journalBtn").addEventListener("click", saveJournal);
document.querySelector("#journalClear").addEventListener("click", clearJournal);
showJournalCount();
