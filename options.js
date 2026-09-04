// Dropping onto a deck draws the card from the pool; dropping onto the pool
// takes it out of the deck it came from. Neither is a delete.
async function moveTo(card, fromId, toId) {
  if (toId === POOL) {
    if (fromId === POOL) return;
    return ejectCard(card, fromId);
  }
  if (!store.addToDeck(decks, toId, card.id)) {
    return status(`「${label(card)}」は ${nameOf(toId)} にすでにあります`);
  }
  await store.save(decks);

  undo = async () => {
    store.removeFromDeck(decks, toId, card.id);
    await store.save(decks);
    status("元に戻しました");
    paintDecks();
  };

  status(`「${label(card)}」を ${nameOf(toId)} に入れました`, "元に戻す");
  paintDecks();
}

async function ejectCard(card, deckId = selected) {
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

  status(`「${label(card)}」を ${nameOf(deckId)} から外しました（プールに残っています）`, "元に戻す");
  paintDecks();
}

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

const POOL = "__pool__";
let decks = null;
let selected = POOL;
let undo = null;
let query = "";
let dragging = null;

const HUES = [320, 145, 250, 85, 25, 195, 290, 60];

async function loadDecks() {
  const data = await store.read();
  if (!data) return;

  decks = data;
  const known = deckIds();
  if (!known.includes(selected)) selected = known[0] || POOL;
  paintDecks();
}

function deckIds() {
  return [POOL, ...Object.keys(decks.decks || {})];
}

// The pool holds every card; a deck is the ordered subset you drew from it.
const cardsOf = (id) =>
  id === POOL ? decks.cards.slice() : store.deckOf(decks, id);

const hueOf = (id) =>
  id === POOL ? null : decks.channelMeta[id]?.hue ?? store.defaultHue(id);

const nameOf = (id) =>
  id === POOL ? "カードプール" : decks.channelMeta[id]?.name || id;

function paintDecks() {
  const ids = deckIds();
  const total = decks.cards.length;
  document.querySelector("#deckTotal").textContent =
    total ? `プール ${total}枚 ・ ${ids.length - 1}デッキ` : "まだ札がありません";

  const list = document.querySelector("#deckList");
  list.replaceChildren();
  for (const id of ids) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "deck-row";
    if (id === selected) row.dataset.on = "true";

    const dot = document.createElement("span");
    dot.className = "deck-dot";
    if (id === POOL) dot.dataset.common = "true";
    else dot.style.setProperty("--hue", hueOf(id));

    const name = document.createElement("span");
    name.className = "deck-name";
    name.textContent = nameOf(id);

    const count = document.createElement("span");
    count.className = "muted";
    count.textContent = cardsOf(id).length;

    row.append(dot, name, count);
    row.addEventListener("click", () => { selected = id; paintDecks(); });
    wireDeckDrop(row, id);
    list.appendChild(row);
  }

  paintHeader();
  paintCards();
}

function paintHeader() {
  const header = document.querySelector("#deckHeader");
  header.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = nameOf(selected);
  header.appendChild(title);

  if (selected === POOL) {
    const note = document.createElement("small");
    note.textContent = "保存した札はすべてここに。デッキに落とすと使えるようになります";
    header.appendChild(note);
    return;
  }

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
    swatch.title = `色を変える (${hue})`;
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

function matches(card) {
  if (!query) return true;
  return tokens.toPlainText(card.tokens || []).toLowerCase().includes(query);
}

function paintCards() {
  const holder = document.querySelector("#deckCards");
  const hint = document.querySelector("#deckHint");
  holder.replaceChildren();

  // Stored order is what the deck actually is; sorting is a display choice.
  // Dragging edits the stored order, so the grid has to show that order.
  const all = cardsOf(selected);
  const cards = all.filter(matches);

  hint.textContent =
    selected === POOL
      ? "保存した札はすべてここに。左のデッキにドラッグすると、そのデッキで使えるようになります。"
      : settings.sortBy === "manual"
      ? "ドラッグで並べ替え。左のデッキに落とすと、そのデッキにも入ります。"
      : `ドラッグで並べ替えできますが、チャット横は「${SORT_LABEL[settings.sortBy]}」で表示中です。`;

  if (!all.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "このデッキにはまだ札がありません。";
    holder.appendChild(empty);
    return;
  }

  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = `「${query}」に一致する札はありません。`;
    holder.appendChild(empty);
    return;
  }

  for (const card of cards) {
    const el = document.createElement("div");
    el.className = "browse-card";
    el.draggable = !query || selected === POOL; // reordering needs the full order
    if (selected !== POOL) el.style.setProperty("--hue", hueOf(selected));
    else el.dataset.common = "true";
    if (!query) wireDrag(el, card);

    const body = document.createElement("div");
    body.className = "browse-body";
    body.appendChild(tokens.toFragment(card.tokens || [], { preview: true }));

    const meta = document.createElement("div");
    meta.className = "browse-meta";
    meta.textContent = card.uses ? `${card.uses}回` : "未使用";

    const actions = document.createElement("div");
    actions.className = "browse-actions";
    if (tokens.requiredChannels(card.tokens).length) el.dataset.pinned = "true";

    if (selected !== POOL) {
      const eject = document.createElement("button");
      eject.type = "button";
      eject.textContent = "デッキから外す";
      eject.title = "プールには残ります";
      eject.addEventListener("click", () => ejectCard(card));
      actions.appendChild(eject);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = selected === POOL ? "削除" : "完全に削除";
    remove.title = "プールから消え、すべてのデッキから外れます";
    remove.addEventListener("click", () => removeCard(card));
    actions.appendChild(remove);
    el.append(body, meta, actions);
    holder.appendChild(el);
  }
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

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") loadDecks();
});

loadDecks();

/* ---------------- drag to arrange, drag to move ---------------- */

function wireDrag(el, card) {
  el.addEventListener("dragstart", (event) => {
    dragging = { card, from: selected };
    el.dataset.dragging = "true";
    event.dataTransfer.effectAllowed = "move";
    // Firefox refuses to start a drag without payload.
    event.dataTransfer.setData("text/plain", card.id);
  });

  el.addEventListener("dragend", () => {
    dragging = null;
    delete el.dataset.dragging;
    for (const node of document.querySelectorAll("[data-drop]")) delete node.dataset.drop;
  });

  el.addEventListener("dragover", (event) => {
    if (!dragging || dragging.from !== selected || dragging.card.id === card.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    // Drop before or after, depending on which half the pointer is over.
    const box = el.getBoundingClientRect();
    el.dataset.drop = event.clientX < box.left + box.width / 2 ? "before" : "after";
  });

  el.addEventListener("dragleave", () => delete el.dataset.drop);

  el.addEventListener("drop", async (event) => {
    if (!dragging || dragging.from !== selected) return;
    event.preventDefault();
    const side = el.dataset.drop || "before";
    delete el.dataset.drop;
    await reorder(dragging.card, card, side);
  });
}

async function reorder(moved, target, side) {
  if (selected === POOL) return; // the pool has no meaningful order
  if (!store.reorderDeck(decks, selected, moved.id, target.id, side)) return;
  await store.save(decks);
  status(
    settings.sortBy === "manual"
      ? "並べ替えました"
      : "並べ替えました（表示に反映するには並び順を「自分で並べた順」に）"
  );
  paintDecks();
}

function wireDeckDrop(row, id) {
  row.addEventListener("dragover", (event) => {
    if (!dragging || dragging.from === id) return;
    if (!canMoveTo(dragging.card, id)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    row.dataset.drop = "into";
  });

  row.addEventListener("dragleave", () => delete row.dataset.drop);

  row.addEventListener("drop", async (event) => {
    delete row.dataset.drop;
    if (!dragging || dragging.from === id || !canMoveTo(dragging.card, id)) return;
    event.preventDefault();
    await moveTo(dragging.card, dragging.from, id);
  });
}

// A member emoji only sends on the channel that hands it out, so such a card
// can only join that channel's deck. The pool holds everything, always.
function canMoveTo(card, deckId) {
  if (deckId === POOL) return true;
  const required = tokens.requiredChannels(card.tokens);
  return !required.length || required.every((owner) => owner === deckId);
}

document.querySelector("#deckSearch").addEventListener("input", (event) => {
  query = event.target.value.trim().toLowerCase();
  paintCards();
});

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
