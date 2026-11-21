import assert from "node:assert/strict";
import { NONO, optionsPage } from "./options-page.mjs";

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
  console.log("ok   the linked channel gets keyboard focus and list redraws preserve it");
} finally {
  close();
}
