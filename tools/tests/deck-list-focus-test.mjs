import assert from "node:assert/strict";
import { NONO, NUHU, optionsPage } from "./options-page.mjs";

const url = `https://extension.test/options.html?channel=${NONO}`;
const { document, window, settle, close } = await optionsPage({ url });
try {
  const list = document.querySelector("#deckList");
  const selected = () => list.querySelector(".deck-row[data-on]");
  assert.equal(selected(), list.lastElementChild);
  assert.equal(document.activeElement, selected(), "Opening a channel starts keyboard navigation at that row");

  let rows = 1;
  async function redraw() {
    const oldRow = selected();
    assert.equal((await window.OshiDeck.store.apply("setSettings", { patch: { rows } })).ok, true);
    rows = 3 - rows;
    await settle();
    assert.notEqual(selected(), oldRow, "A storage change repaints the list");
  }

  list.scrollTop = 240;
  await redraw();
  assert.equal(list.scrollTop, 240);
  assert.equal(document.activeElement, selected(), "A redraw restores focus to the same channel row");

  const deleteButton = () => selected().querySelector(".deck-delete");
  deleteButton().focus();
  await redraw();
  assert.equal(document.activeElement, deleteButton(), "A redraw keeps focus on the delete control if it was focused");

  const search = document.querySelector("#deckSearch");
  search.focus();
  await redraw();
  assert.equal(document.activeElement, search, "A list redraw leaves focus outside the list alone");

  // Model a one-row viewport. Removing the first channel moves the focused
  // row above the viewport if the saved scroll position is restored unchanged.
  const rowHeight = 36;
  list.getBoundingClientRect = () => ({ top: 0, bottom: rowHeight });
  const getBounds = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.parentElement !== list) return getBounds.call(this);
    const top = Array.from(list.children).indexOf(this) * rowHeight - list.scrollTop;
    return { top, bottom: top + rowHeight };
  };
  list.scrollTop = rowHeight;
  deleteButton().focus();
  assert.equal((await window.OshiDeck.store.apply("deleteDeck", { channelId: NUHU })).ok, true);
  await settle();
  assert.equal(list.scrollTop, 0, "The list reveals the focused row if another channel is removed above it");
  assert.equal(document.activeElement, deleteButton());
  console.log("ok   linked and restored keyboard focus stays visible in the channel list");
} finally {
  close();
}
