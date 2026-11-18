import assert from "node:assert/strict";
import { contentPage, CHANNEL } from "./content-page.mjs";

for (const mode of ["hand", "list"]) {
  const p = await contentPage({ mode, cards: ["👏".repeat(5)] });
  try {
    assert.equal(await p.draw("👏".repeat(6)), null, `${mode}: five claps cover six in the actual chat watcher`);
    const card = (await p.window.OshiDeck.store.read()).cards[0];
    assert.equal(card.tokens[0].value, "👏".repeat(5), "ownership matching leaves saved wording intact");
    assert(await p.draw("🎉".repeat(6)), `${mode}: another reaction still draws`);
  } finally { p.close(); }

  const held = await contentPage({ mode, cards: ["existing card"] });
  try {
    assert(await held.draw("👏".repeat(6)), `${mode}: an unowned repeat can draw`);
    const reply = await held.window.OshiDeck.store.apply("addCard", {
      card: { id: "five-claps", tokens: [{ type: "text", value: "👏".repeat(5) }] },
      channelId: CHANNEL, scope: "global"
    });
    assert(reply.ok);
    await held.advance();
    assert.equal(held.document.querySelector(".od-drawn"), null, `${mode}: saving five claps retires the held six-clap offer`);
  } finally { held.close(); }
}
console.log("ok   actual watcher and held offers suppress repeat variants in hand and list modes");
