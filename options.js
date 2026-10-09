const { i18n, store, tokens } = globalThis.OshiDeck;
const t = (...args) => i18n.t(...args);

// One list, in store.js. It had been written out here as well, so every
// setting added since had no selected button on this page until someone
// remembered to add it twice.
const DEFAULTS = store.DEFAULT_SETTINGS;

// Asked for when they are needed, never kept.
//
// These were three tables built at module load, which is before the stored
// language has been applied — so a browser in one language and a page set to
// another showed the page's language everywhere except here, and switching
// language left them behind entirely. A translated string cannot be a
// constant on a page that can change language.
// Spelled out rather than built from the value: a key that only exists as a
// template is a key nothing can check, and check-i18n reads these files to
// find what is used and what has been left untranslated.
const sizeLabel = (size) =>
  size === "large" ? t("size.large") : size === "medium" ? t("size.medium") : t("size.small");

const sortLabel = (sortBy) =>
  sortBy === "trend" ? t("sort.trend")
  : sortBy === "heat" ? t("sort.heat")
  : sortBy === "uses" ? t("sort.uses")
  : t("sort.manual");

const sortNote = (sortBy) =>
  sortBy === "trend" ? t("sort.trendNote")
  : sortBy === "heat" ? t("sort.heatNote")
  : sortBy === "uses" ? t("sort.usesNote")
  : t("sort.manualNote");
const SIDEBAR_WIDTH = 400;
const PANEL_PADDING = 24;

let settings = { ...DEFAULTS };

function paint() {
  document.querySelector(`input[name="mode"][value="${settings.mode}"]`).checked = true;
  document.querySelector("#autoSend").checked = !!settings.autoSend;
  document.querySelector("#suggest").checked = settings.suggest !== false;

  for (const button of document.querySelectorAll('[data-choice="language"] button')) {
    button.classList.toggle("on", button.value === (settings.language || ""));
  }

  for (const group of document.querySelectorAll(".segmented[data-setting]")) {
    const key = group.dataset.setting;
    for (const button of group.querySelectorAll("button")) {
      button.classList.toggle("on", String(settings[key]) === button.value);
    }
  }

  // A number means none of the steps, so none of them are lit and the field
  // holds the answer instead. Not while it is being typed in, though: the
  // paint that follows the commit would put the rounded value back under the
  // cursor mid-keystroke.
  for (const field of document.querySelectorAll("input[data-seconds]")) {
    if (field === document.activeElement) continue;
    const chosen = settings[field.dataset.seconds];
    field.value = typeof chosen === "number" ? String(Math.round(chosen / 1000)) : "";
  }

  // Show what the current size and row count actually buy in a 400px sidebar.
  const { CARD_SIZE, cardsPerRow } = globalThis.OshiDeck.layout;
  const perRow = cardsPerRow(SIDEBAR_WIDTH - PANEL_PADDING, CARD_SIZE[settings.cardSize]);
  document.querySelector("#capacity").textContent =
    t("opt.capacity", sizeLabel(settings.cardSize), settings.rows, perRow * settings.rows);

  document.querySelector("#sortNote").textContent = sortNote(settings.sortBy);

  // Say the actual numbers. A step called ふつう tells nobody what it will do,
  // and these are the values the panel was reported as getting wrong.
  const draw = store.tuning(settings, "draw");
  document.querySelector("#drawNote").textContent =
    t("opt.drawNote", draw.min, Math.round(draw.share * 100)) +
    t("opt.drawHint");
  document.querySelector("#holdNote").textContent =
    t("opt.holdNote", store.tuning(settings, "hold") / 1000) +
    t("opt.holdHint");
  document.querySelector("#paceNote").textContent =
    t("opt.paceNote", store.tuning(settings, "pace") / 1000) +
    t("opt.paceHint");
}

// Every element that names a key, filled. Text by default; an attribute when
// the key is on `data-i18n-<attribute>`, which is how a placeholder or an
// aria-label gets said in the right language too.
function applyLanguage() {
  i18n.use(settings.language);
  document.documentElement.lang = i18n.current();

  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
  }
  for (const el of document.querySelectorAll("[data-i18n-aria-label]")) {
    el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
  }
}

// Built from the table rather than written into the page: adding a language
// should be one entry in i18n.js and nothing else.
function buildLanguageChoice() {
  const group = document.querySelector('[data-choice="language"]');
  for (const { code, label } of i18n.LANGUAGES) {
    const button = document.createElement("button");
    button.type = "button";
    button.value = code;
    // In its own language, always: someone looking for 繁體中文 is not
    // reading the Japanese word for it.
    button.textContent = label;
    group.appendChild(button);
  }

  group.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button) commit({ language: button.value });
  });
}

async function commit(patch) {
  // Through the worker like everything else. Written directly, a settings
  // click racing a replace import lost whichever set() landed second.
  const { ok, value } = await store.apply("setSettings", { patch });
  if (!ok) return;
  settings = value;
  applyLanguage();
  paint();

  const saved = document.querySelector("#saved");
  saved.textContent = t("opt.saved");
  clearTimeout(commit.timer);
  commit.timer = setTimeout(() => (saved.textContent = ""), 1200);
}

async function load() {
  // Through the store, which is where a setting is checked against what it
  // may be. Read straight from storage, a restored backup carrying
  // `mode: "not-a-mode"` arrived here intact and paint() threw on it.
  settings = await store.readSettings();
  applyLanguage();
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

// Typing a number is choosing it; emptying the field goes back to the middle
// step rather than to nothing, which is where an unreadable value lands too.
for (const field of document.querySelectorAll("input[data-seconds]")) {
  field.addEventListener("change", () => {
    const key = field.dataset.seconds;
    const seconds = Number(field.value);
    commit({ [key]: field.value.trim() && Number.isFinite(seconds) ? seconds * 1000 : "normal" });
  });
}

document.querySelector("#suggest").addEventListener("change", (event) => {
  commit({ suggest: event.target.checked });
});

document.querySelector("#autoSend").addEventListener("change", (event) => {
  commit({ autoSend: event.target.checked });
});

buildLanguageChoice();
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
    empty.textContent = t("opt.noDecks");
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
    drop.title = t("opt.deleteDeck");
    drop.setAttribute("aria-label", t("aria.deleteDeck", nameOf(id)));
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
  label.textContent = t("opt.oshiColour");
  swatches.appendChild(label);

  const current = hueOf(selected);

  for (const hue of HUES) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.style.setProperty("--hue", hue);
    swatch.setAttribute("aria-label", t("opt.oshiColourHue", hue));
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
  slider.setAttribute("aria-label", t("opt.hueSlider"));
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
  picker.setAttribute("aria-label", t("opt.colourPicker"));
  picker.addEventListener("change", (event) => {
    const hue = store.hueFromHex(event.target.value);
    if (hue != null) setHue(selected, hue);
  });

  swatches.append(slider, picker);

  // On the deck, not in the backup section. Those two are about the whole
  // store — pool, every deck, settings — and these two are about this one
  // deck. Sitting in the same list, the only way to tell which was which was
  // to read all four labels.
  const line = document.createElement("div");
  line.className = "deck-title";
  line.append(
    title,
    deckAction("download", t("opt.deckExport"), exportDeck),
    deckAction("upload", t("opt.deckImport"), () => document.querySelector("#deckFile").click())
  );

  header.append(line, swatches);
}

const DECK_ICONS = {
  // Into a tray, and out of one.
  download: "M12 4v10m0 0 4-4m-4 4-4-4M5 18h14",
  upload: "M12 20V10m0 0 4 4m-4-4-4 4M5 6h14"
};

function deckAction(icon, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "deck-action";
  button.title = label;
  button.setAttribute("aria-label", label);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", DECK_ICONS[icon]);
  svg.appendChild(path);

  button.appendChild(svg);
  button.addEventListener("click", onClick);
  return button;
}

// Apply a change to the freshest stored state, never to the snapshot this page
// has been holding. The chat panel writes usage counts as cards are played, so
// saving a wholesale snapshot read minutes ago silently rolls them back.
// Every change is a named operation sent to the service worker, which applies
// them one at a time against freshly-read state. Nothing here writes storage.
async function mutate(op, args) {
  const reply = await store.apply(op, args);
  if (!reply.ok) {
    status(t("toast.saveFailed"));
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
  // Both columns. The hue was set on the deck's side only, so a card in the
  // pool fell back to the stylesheet's 320 — pink, on every channel. There is
  // nothing else it could be: poolFor has already narrowed the pool to what
  // this deck's channel can send, so a card in it that is not universal is
  // this channel's.
  el.style.setProperty("--hue", hueOf(selected));

  const body = document.createElement("div");
  body.className = "browse-body";
  body.appendChild(tokens.toFragment(card.tokens || [], { preview: true }));

  const meta = document.createElement("div");
  meta.className = "browse-meta";
  // On this channel, not across all of them: the count means "how often you
  // reach for this here", and both columns are already about one deck.
  const { uses } = store.countOn(card, selected);
  meta.textContent = uses ? t("opt.uses", uses) : t("opt.unused");

  el.append(body, meta);
  wireDrag(el, card, where);

  // What the stripe means is scope, which is the same question the panel
  // asks — and it was being answered differently here. Reading the member
  // emoji only says "this card is forced to a channel"; a card set to this
  // channel in plain words is tied to it just as much, and a preset carries
  // those (`はのは〜` is channel-only and has no stamps in it). Those cards
  // were striped in the panel and grey in here.
  if (store.scopeOf(card) === store.GLOBAL) el.dataset.universal = "true";

  // Every card has a pool to fall back to now, so leaving a deck always means
  // the same thing wherever you do it.
  if (where === "deck") {
    el.appendChild(cardAction("⏏", t("peek.ejectPool"),
      () => ejectCard(card)));
  } else {
    el.appendChild(cardAction("×", t("peek.deleteCard"),
      () => removeCard(card, el)));
  }
  return el;
}

// An empty deck is the one place a preset is worth offering: a starting hand
// for a channel nobody has played yet. It is never offered over a deck that
// already has something in it.
// Per deck, because that is how they are stored: one file each, named by an
// index, so asking for all of them would mean reading all of them.
const bundled = new Map();

async function loadBundled(channelId) {
  if (bundled.has(channelId)) return bundled.get(channelId);
  let list = [];
  try {
    const reply = await chrome.runtime.sendMessage({ type: "presets", channelId });
    list = reply?.ok && Array.isArray(reply.value) ? reply.value : [];
  } catch (_) { /* worker gone: no starting hand, no harm */ }
  bundled.set(channelId, list);
  return list;
}

function presetOffer() {
  const holder = document.createElement("div");
  holder.className = "preset-offer";

  loadBundled(selected).then((all) => {
    // A preset that names a channel is only a starting hand for that channel.
    const list = all.filter((preset) => presets.offeredOn(preset, selected));
    if (!list.length || !selected) return;

    const line = document.createElement("small");
    line.textContent = t("opt.presetOffer");
    holder.appendChild(line);

    for (const preset of list) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "action";
      button.textContent = t("opt.presetButton", preset.name, preset.cards.length);
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
    ? t("opt.presetReused", value.reused)
    : "";
  status(t("opt.presetLoaded", preset.name, note));
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
    empty.textContent = t("opt.deckEmpty");
    holder.appendChild(empty);
    return;
  }

  hint.textContent =
    settings.sortBy === "manual"
      ? t("opt.deckHint")
      : t("opt.deckHintSorted", sortLabel(settings.sortBy));

  const cards = cardsOf(selected);
  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = t("opt.deckEmptyHint");
    holder.append(empty, presetOffer());
    return;
  }

  for (const card of cards) holder.appendChild(buildCard(card, "deck"));
}

// The pool holds what this deck could take and has not: cards that work
// anywhere, and cards tied to this channel — including the ones carrying its
// member emoji, which send here and nowhere else. Somebody else's never
// appear, because they could not be added.
function paintPool() {
  const holder = document.querySelector("#poolCards");
  holder.replaceChildren();

  const all = selected ? store.poolFor(decks, selected) : store.universal(decks);
  const shown = query
    ? all.filter((card) => tokens.toPlainText(card.tokens || []).toLowerCase().includes(query))
    : all;

  document.querySelector("#poolCount").textContent = query
    ? t("opt.poolCountFiltered", shown.length, all.length)
    : t("opt.poolCount", all.length);

  if (!shown.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = query
      ? t("opt.noMatch")
      : t("opt.poolEmpty");
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
      .then((r) => r.ok && status(t("opt.undone")));
    status(t("opt.addedTo", label(card), nameOf(into)), t("action.undo"));
  } else if (settings.sortBy !== "manual") {
    status(t("opt.reordered"));
  }
}

async function ejectCard(card, deckId = selected) {
  const { ok, value: at } = await mutate("removeFromDeck", { channelId: deckId, cardId: card.id });
  if (!ok || at < 0) return;

  // insertIntoDeck tolerates whatever happened in the meantime: the card may
  // have been re-added from the chat panel, or deleted outright.
  undo = () => mutate("insertIntoDeck", { channelId: deckId, cardId: card.id, at })
    .then((r) => r.ok && status(t("opt.undone")));

  status(t("opt.ejected", label(card)), t("action.undo"));
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
    .then((r) => r.ok && status(t("opt.undone")));

  const note = snapshot.exclusive?.length
    ? t("opt.deckDeletedNote", snapshot.exclusive.length)
    : t("opt.deckKeptNote");
  status(t("opt.deckDeleted", was, note), t("action.undo"));
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
    .then((r) => r.ok && status(t("opt.undone")));

  status(t("opt.cardDeleted", label(snapshot.card)), t("action.undo"));
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
  ask.setAttribute("aria-label", t("opt.sharedWarn", names));

  const line = document.createElement("p");
  line.textContent = held.length === 1 ? t("opt.sharedOther") : t("opt.sharedOthers", held.length);

  const close = () => {
    ask.remove();
    delete el.dataset.confirming;
  };

  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "browse-confirm-yes";
  yes.textContent = t("action.delete");
  yes.title = t("opt.sharedAlso", names);
  yes.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
    deleteCardNow(card);
  });

  const no = document.createElement("button");
  no.type = "button";
  no.textContent = t("action.cancel");
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
  return stamps ? t("opt.stamps", stamps) : t("opt.emptyCard");
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

  importStatus(t("opt.exported", payload.cards.length));
}

async function readBackupFile(file) {
  pending = null;

  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch (_) {
    return importStatus(t("opt.notJson"));
  }

  const problem = backup.validate(raw);
  if (problem) return importStatus(t("opt.cannotRead", problem));

  const { cards, decks } = backup.summarise(raw);
  // Replacing throws away everything currently stored, so it never happens on
  // a single click — the file is only staged here.
  if (importMode === "replace") {
    pending = raw;
    return importStatus(
      t("opt.replaceConfirm", file.name, cards, decks),
      t("opt.replace"),
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
  if (!ok) return importStatus(t("toast.saveFailed"));

  importStatus(
    mode === "replace"
      ? t("opt.replaced", value.count)
      : value.added || value.linked
        ? t("opt.mergedNew", value.added, value.linked)
        : t("opt.mergedNone")
  );

  await load();
  await loadDecks();
}

for (const group of document.querySelectorAll('[data-choice="importMode"]')) {
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
        ? t("opt.replaceNote")
        : t("opt.mergeNote");
  });
  group.querySelector('button[value="merge"]').classList.add("on");
}

// A deck, as something to hand to someone who has none.
async function exportDeck() {
  if (!selected) return;

  const name = nameOf(selected) || selected;
  const preset = presets.fromDeck(decks, selected, { name });

  const problem = presets.validate(preset);
  if (problem) return importStatus(t("opt.cannotExport", problem));

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
  status(t("opt.exported", preset.cards.length) +
    (preset.channel ? t("opt.presetBound") : "") +
    (dropped > 0 ? t("opt.presetDropped", dropped) : ""));
}

// And the way back in. Everything that decides anything is already written:
// the file is checked by the extension's own reader, and the operation that
// takes it in is the same one the bundled presets go through — which is what
// settles duplicates, scope, and which cards can be played here at all.
async function importDeck(file) {
  if (!file || !selected) return;

  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch (_) {
    return status(t("opt.notJson"));
  }

  const problem = presets.validate(raw);
  if (problem) return status(t("opt.cannotRead", problem));

  // A file carrying another channel's member emoji cannot be played here, and
  // loading it would silently drop the part that took the longest to build.
  // Better to say so than to half-load it.
  if (!presets.offeredOn(raw, selected)) return status(t("opt.importNotForHere"));

  const { ok, value } = await mutate("loadPreset", {
    channelId: selected,
    name: nameOf(selected),
    cards: presets.cardsFor(raw, selected)
  });
  if (!ok || !value) return;
  if (!value.added && !value.reused) return status(t("opt.importedNothing"));

  const note = value.reused ? t("opt.presetReused", value.reused) : "";
  status(t("opt.presetLoaded", raw.name, note));
  await loadDecks();
}

document.querySelector("#deckFile").addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  event.target.value = "";   // the same file twice in a row is still a change
  importDeck(file);
});
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
  journalStatus(entries.length ? t("opt.journalCount", entries.length) : t("opt.journalEmpty"));
}

async function saveJournal() {
  const entries = await journal.read();
  if (!entries.length) return journalStatus(t("opt.journalNothing"));

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

  journalStatus(t("opt.journalExported", entries.length));
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

  journalStatus(reply?.ok ? t("opt.journalCleared") : t("opt.journalClearFailed"));
}

document.querySelector("#journalBtn").addEventListener("click", saveJournal);
document.querySelector("#journalClear").addEventListener("click", clearJournal);
showJournalCount();
