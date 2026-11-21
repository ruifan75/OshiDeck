import assert from "node:assert/strict";
import { NUHU, optionsPage } from "./options-page.mjs";

const card = (id, value) => ({ id, scope: "global", tokens: [{ type: "text", value }] });
const page = await optionsPage({
  initialData: {
    cards: [card("held", "👏👏👏"), card("spare", "🎀🎀🎀")],
    decks: { [NUHU]: ["held"] }
  }
});

try {
  const { document, window } = page;
  const preview = document.querySelector("#deckCardPreview");
  const held = document.querySelector("#deckCards .browse-card");
  const spare = document.querySelector("#poolCards .browse-card");
  const pointer = (card, type) => card.dispatchEvent(new window.Event(type));
  const images = () => [...preview.querySelectorAll(".od-emoji")].map((img) => img.alt);

  for (const tile of [held, spare]) {
    assert.equal(tile.querySelector(".browse-body .od-times").textContent, "×3");
    assert.equal(tile.querySelectorAll(".browse-body .od-emoji").length, 1);
  }

  pointer(held, "pointerenter");
  assert.deepEqual(images(), ["👏", "👏", "👏"]);
  assert.equal(preview.querySelector(".od-times"), null);
  pointer(spare, "pointerenter");
  pointer(held, "pointerleave");
  assert.deepEqual(images(), ["🎀", "🎀", "🎀"], "Leaving a previous card does not clear the current preview");
  pointer(spare, "pointerleave");
  assert.equal(preview.childElementCount, 0);

  held.querySelector(".browse-remove").focus();
  assert.deepEqual(images(), ["👏", "👏", "👏"], "Focusing a card's controls also shows its complete contents");
  const search = document.querySelector("#deckSearch");
  search.focus();
  assert.equal(preview.childElementCount, 0);

  pointer(spare, "pointerenter");
  search.value = "no matches";
  search.dispatchEvent(new window.Event("input"));
  assert.equal(preview.childElementCount, 0, "A pool redraw clears the preview of a removed card");
  assert.equal(page.ops.length, 0, "Previewing a card does not write to storage");
  console.log("ok   compact tiles show the full card in the status row on hover and focus");
} finally {
  page.close();
}
