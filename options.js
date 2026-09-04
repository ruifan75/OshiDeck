const { store, tokens } = globalThis.OshiDeck;

const DEFAULTS = {
  autoSend: false,
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
  trend: "いまチャットで流れている反応に合う札を前に出します。直近90秒ぶんを見て、8秒ごとに並べ替え。カーソルが札の上にある間は動きません。",
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
}

async function commit(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ settings });
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

const HUES = [320, 145, 250, 85, 25, 195, 290, 60];

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
  document.querySelector("#deckTotal").textContent = decks.cards.length
    ? `プール ${decks.cards.length}枚 ・ ${ids.length}デッキ`
    : "まだ札がありません";

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
    drop.title = "このデッキを削除（札はプールに残ります）";
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
  header.appendChild(title);

  const swatches = document.createElement("div");
  swatches.className = "swatches";
  const label = document.createElement("small");
  label.textContent = "推し色";
  swatches.appendChild(label);

  for (const hue of HUES) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.style.setProperty("--hue", hue);
    swatch.setAttribute("aria-label", `推し色 ${hue}`);
    if (hue === hueOf(selected)) swatch.dataset.on = "true";
    swatch.addEventListener("click", () => setHue(selected, hue));
    swatches.appendChild(swatch);
  }
  header.appendChild(swatches);
}

async function setHue(id, hue) {
  decks.channelMeta[id] = { ...(decks.channelMeta[id] || {}), hue };
  await store.writeChannelMeta(decks.channelMeta);
  paintDecks();
}

// A card, rendered the same in either pane. `where` decides what dragging it
// means and which actions it offers.
function buildCard(card, where) {
  const state = where === "pool" ? poolState(card) : "deck";

  const el = document.createElement("div");
  el.className = "browse-card";
  el.dataset.state = state;
  el.draggable = state === "free" || where === "deck";
  if (where === "deck") el.style.setProperty("--hue", hueOf(selected));

  if (state === "in-deck") el.title = "このデッキに入っています";

  const body = document.createElement("div");
  body.className = "browse-body";
  body.appendChild(tokens.toFragment(card.tokens || [], { preview: true }));

  const meta = document.createElement("div");
  meta.className = "browse-meta";
  meta.textContent = card.uses ? `${card.uses}回` : "未使用";

  el.append(body, meta);

  if (state === "in-deck") {
    const badge = document.createElement("span");
    badge.className = "browse-badge";
    badge.textContent = "✓";
    el.appendChild(badge);
  }

  if (el.draggable) wireDrag(el, card, where);

  const bound = tokens.requiredChannels(card.tokens).length > 0;
  if (!bound) el.dataset.universal = "true";

  // The pool is universal cards only, so a card bound to a channel has no pool
  // to return to: for it, leaving the deck is deletion. It is only ever in
  // that one deck, so nothing else loses anything either.
  if (where === "deck") {
    el.appendChild(bound
      ? cardAction("×", "この札を削除（メン限専用なのでプールには残りません）", () => removeCard(card))
      : cardAction("⏏", "このデッキから外す（プールに戻ります）", () => ejectCard(card)));
  } else {
    el.appendChild(cardAction("×", "この札を削除（すべてのデッキから消えます）",
      () => removeCard(card)));
  }
  return el;
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
  wireDeckDrop(holder);

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
      : `並べ替えはできますが、チャット横は「${SORT_LABEL[settings.sortBy]}」で表示中です。`;

  const cards = cardsOf(selected);
  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "右のプールから札をドラッグしてください。";
    holder.appendChild(empty);
    return;
  }

  for (const card of cards) holder.appendChild(buildCard(card, "deck"));
}

// The pool holds the cards that can go into any deck. A card carrying member
// emoji cannot — it only sends on the channel that hands them out — so it is
// not pool material and never appears here. What is left is the same list
// whatever deck is selected; the only per-deck fact is whether a card is
// already in it, and that is a mark on the card, not a reason to hide it.
// The pool holds universal cards only, so the one per-deck fact is whether
// this card is already in the deck on screen.
const poolState = (card) =>
  selected && store.inDeck(decks, selected, card.id) ? "in-deck" : "free";

function paintPool() {
  const holder = document.querySelector("#poolCards");
  holder.replaceChildren();
  wirePoolDrop(document.querySelector("#pool"));

  const all = store.universal(decks);
  const shown = query
    ? all.filter((card) => tokens.toPlainText(card.tokens || []).toLowerCase().includes(query))
    : all;

  const free = shown.filter((card) => poolState(card) === "free").length;
  document.querySelector("#poolCount").textContent = query
    ? `${shown.length} / ${all.length}枚`
    : `${all.length}枚 ・ 追加できる ${free}枚`;

  if (!shown.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = query
      ? "一致する札がありません。"
      : "どのデッキでも使える札がまだありません。";
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
async function dropOnDeck({ card, from }, { target, side }) {
  if (!selected) return;

  if (from === "pool" && !store.addToDeck(decks, selected, card.id)) return;

  if (target) store.reorderDeck(decks, selected, card.id, target.id, side || "before");
  await store.save(decks);

  if (from === "pool") {
    undo = async () => {
      store.removeFromDeck(decks, selected, card.id);
      await store.save(decks);
      status("元に戻しました");
      paintDecks();
    };
    status(`「${label(card)}」を ${nameOf(selected)} に入れました`, "元に戻す");
  } else if (settings.sortBy !== "manual") {
    status(`並べ替えました（表示に反映するには並び順を「自分で並べた順」に）`);
  }
  paintDecks();
}

async function ejectCard(card, deckId = selected) {
  if (tokens.requiredChannels(card.tokens).length) return; // nowhere to eject to
  const at = store.removeFromDeck(decks, deckId, card.id);
  if (at < 0) return;
  await store.save(decks);

  undo = async () => {
    const list = (decks.decks[deckId] ||= []);
    list.splice(Math.min(at, list.length), 0, card.id);
    await store.save(decks);
    status("元に戻しました");
    paintDecks();
  };

  status(`「${label(card)}」をデッキから外しました（プールに残っています）`, "元に戻す");
  paintDecks();
}

// Removing a deck keeps every card: they stay in the pool, and the deck comes
// back whole if you undo.
async function removeDeck(id) {
  const removed = store.deleteDeck(decks, id);
  if (!removed) return;
  await store.save(decks);
  await store.writeChannelMeta(decks.channelMeta);

  const was = nameOf(id) || id;
  if (selected === id) selected = deckIds()[0] ?? null;

  undo = async () => {
    store.restoreDeck(decks, removed);
    await store.save(decks);
    await store.writeChannelMeta(decks.channelMeta);
    status("元に戻しました");
    paintDecks();
  };

  status(`「${was}」のデッキを削除しました（札はプールに残っています）`, "元に戻す");
  paintDecks();
}

// Deleting is from the pool, so it leaves every deck at once.
async function removeCard(card) {
  const removed = store.deleteCard(decks, card.id);
  if (!removed) return;
  await store.save(decks);

  undo = async () => {
    store.restoreCard(decks, removed);
    await store.save(decks);
    status("元に戻しました");
    paintDecks();
  };

  status(`「${label(removed.card)}」を削除しました`, "元に戻す");
  paintDecks();
}

function label(card) {
  const text = tokens.toPlainText(card.tokens || []).trim();
  if (text) return text.length > 18 ? text.slice(0, 18) + "…" : text;
  const stamps = (card.tokens || []).filter((t) => t.type === "youtubeEmoji").length;
  return stamps ? `スタンプ${stamps}個` : "空の札";
}

function status(message, actionLabel) {
  const saved = document.querySelector("#saved");
  saved.replaceChildren(document.createTextNode(message));

  if (actionLabel && undo) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link";
    button.textContent = actionLabel;
    button.addEventListener("click", () => {
      const run = undo;
      undo = null;
      run?.();
    });
    saved.appendChild(button);
  }

  clearTimeout(status.timer);
  status.timer = setTimeout(() => saved.replaceChildren(), 8000);
}

document.querySelector("#deckSearch").addEventListener("input", (event) => {
  query = event.target.value.trim().toLowerCase();
  paintPool();
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") loadDecks();
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
  pending = null;
  if (!raw) return;

  const data = await store.read();
  if (!data) return;

  if (importMode === "replace") {
    const next = backup.replace(raw);
    data.cards = next.cards;
    data.decks = next.decks;
    data.channelMeta = next.channelMeta;
    await store.save(data);
    await store.writeChannelMeta(data.channelMeta);
    if (next.settings) await chrome.storage.local.set({ settings: next.settings });
    importStatus(`${next.cards.length}枚に置き換えました`);
  } else {
    const merged = backup.merge(data, raw);
    data.cards = merged.cards;
    data.decks = merged.decks;
    data.channelMeta = merged.channelMeta;
    await store.save(data);
    await store.writeChannelMeta(data.channelMeta);
    importStatus(
      merged.added || merged.linked
        ? `新しい札 ${merged.added}枚、デッキへの追加 ${merged.linked}件`
        : "すでに全部持っていました"
    );
  }

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

document.querySelector("#exportBtn").addEventListener("click", exportBackup);
document.querySelector("#importBtn").addEventListener("click", () =>
  document.querySelector("#importFile").click());
document.querySelector("#importFile").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  event.target.value = ""; // so re-picking the same file fires again
  if (file) readBackupFile(file);
});
