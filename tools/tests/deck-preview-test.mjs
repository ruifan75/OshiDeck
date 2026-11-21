import assert from "node:assert/strict";
import { NUHU, optionsPage } from "./options-page.mjs";

const repeated = "👏👏👏";
const card = (id, value) => ({ id, scope: "global", tokens: [{ type: "text", value }] });
const page = await optionsPage({
  initialData: {
    cards: [card("held", repeated), card("spare", "🎀🎀🎀")],
    decks: { [NUHU]: ["held"] },
    settings: { language: "zh-TW", mode: "hand", cardSize: "medium", rows: 1, sortBy: "manual" }
  }
});

try {
  const { document, window } = page;
  const dialog = document.querySelector("#deckPreview");
  // The real options event path with jsdom's missing modal methods supplied.
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new window.Event("close")); };

  for (const id of ["deckCards", "poolCards"]) {
    const tile = document.querySelector(`#${id} .browse-body`);
    assert.equal(tile.querySelector(".od-times").textContent, "×3");
    assert.equal(tile.querySelectorAll(".od-emoji").length, 1);
  }

  const open = () => document.querySelector("#openDeckPreview").click();
  open();
  assert(dialog.open);
  const hand = dialog.querySelector(".od-hand");
  assert.equal(hand.style.getPropertyValue("--od-visible-rows"), "1");
  assert.equal(hand.querySelector(".od-card").dataset.size, "medium");
  assert.equal(hand.querySelector(".od-times").textContent, "×3");

  hand.querySelector(".od-card-play").click();
  const inspected = dialog.querySelector("#deckPreviewMessage");
  assert.equal(inspected.hidden, false);
  assert.equal(inspected.querySelectorAll(".od-emoji").length, 3, "Inspecting the preview shows the entire message");
  assert.equal(page.ops.length, 0, "Previewing a card never writes to the store");
  dialog.close();
  assert.equal(document.activeElement.id, "openDeckPreview");

  const listMode = document.querySelector('input[name="mode"][value="list"]');
  listMode.checked = true;
  listMode.dispatchEvent(new window.Event("change"));
  await page.settle();
  open();
  assert.equal(dialog.querySelector("#oshideck-root").dataset.mode, "list");
  assert.equal(dialog.querySelectorAll(".od-listcard-play .od-emoji").length, 3);
  assert.equal(page.read().cards[0].tokens[0].value, repeated);
  console.log("ok   builder tiles use compact faces and the preview follows the selected mode");
} finally {
  page.close();
}
