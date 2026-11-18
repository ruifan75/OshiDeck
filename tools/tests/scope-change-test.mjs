import assert from "node:assert/strict";
import { optionsPage, NUHU, NONO } from "./options-page.mjs";

const THIRD = "UCaaaaaaaaaaaaaaaaaaaaaa";
const plain = (id, scope, value = id) => ({
  id, scope, tokens: [{ type: "text", value }],
  uses: 9, lastUsed: 123, usage: { [NUHU]: { uses: 3, lastUsed: 123 } }
});
const initial = {
  cards: [plain("shared", "global"), plain("local", NUHU), plain("pool", NUHU),
    { id: "member", scope: NUHU, tokens: [{ type: "youtubeEmoji", emojiId: `${NUHU}/stamp`, alt: "stamp" }] }],
  decks: { [NUHU]: ["shared", "local", "member"], [NONO]: ["shared"], [THIRD]: [] },
  channelMeta: { [NUHU]: { name: "虹深°ぬふ" }, [NONO]: { name: "彩雲のの" }, [THIRD]: { name: "第三頻道" } }
};
const p = await optionsPage({ initialData: initial });
// jsdom has dialog elements but no native modal lifecycle. The page still
// builds the actual dialog, focus targets, warning and event listeners.
p.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
p.window.HTMLDialogElement.prototype.close = function () {
  this.open = false;
  this.dispatchEvent(new p.window.Event("close"));
};
const card = (text, pane = "deckCards") => [...p.document.querySelectorAll(`#${pane} .browse-card`)]
  .find((el) => el.querySelector(".browse-body").textContent === text);
const button = (text, pane) => card(text, pane).querySelector(".browse-scope");
const press = async (el) => { el.click(); await p.settle(); };
const saved = (id) => p.read().cards.find((c) => c.id === id);
const dialog = () => p.document.querySelector(".scope-dialog");
const confirm = () => dialog().querySelectorAll("button")[1];
try {
  await press(button("shared"));
  assert(dialog()?.open, "shared conversion opens a modal before changing anything");
  assert.equal(saved("shared").scope, "global");
  assert.deepEqual(p.read().decks[NONO], ["shared"]);
  assert.match(dialog().querySelector("p").textContent, /移除.*無法/);
  assert.equal(dialog().querySelector("li").textContent, "彩雲のの");
  assert.equal(p.document.activeElement.textContent, "取消");
  await press(dialog().querySelector("button"));
  assert.equal(dialog(), null);
  assert.equal(saved("shared").scope, "global", "cancel leaves the card alone");

  await press(button("shared"));
  // Another page adds this card after the warning has already listed Nono.
  await p.window.OshiDeck.store.runOp("addToDeck", { channelId: THIRD, cardId: "shared" });
  await p.settle();
  await press(confirm());
  assert.equal(saved("shared").scope, "global", "unacknowledged memberships cannot be removed");
  assert.deepEqual([...dialog().querySelectorAll("li")].map((el) => el.textContent), ["彩雲のの", "第三頻道"]);
  const before = saved("shared");
  await press(confirm());
  assert.equal(dialog(), null);
  assert.equal(saved("shared").scope, NUHU);
  assert.deepEqual(p.read().decks[NUHU], ["shared", "local", "member"]);
  assert.deepEqual(p.read().decks[NONO], []);
  assert.deepEqual(p.read().decks[THIRD], []);
  assert.deepEqual(saved("shared"), { ...before, scope: NUHU }, "contents, identity and usage survive conversion");
  assert(!card("shared").hasAttribute("data-universal"));

  await press(button("shared"));
  assert.equal(saved("shared").scope, "global");
  assert(card("shared").hasAttribute("data-universal"));
  assert.deepEqual(p.read().decks[NONO], [], "making universal does not add it to other decks automatically");
  await press(button("shared"));
  assert.equal(dialog(), null, "no removal means no confirmation needed");
  assert.equal(saved("shared").scope, NUHU);

  await press(button("pool", "poolCards"));
  assert.equal(saved("pool").scope, "global", "pool cards can become universal too");
  await press(button("pool", "poolCards"));
  assert.equal(saved("pool").scope, NUHU);
  assert(!p.read().decks[NUHU].includes("pool"), "changing scope does not change pool membership");

  const member = p.document.querySelector('#deckCards .browse-card:has(.emoji) .browse-scope') ||
    [...p.document.querySelectorAll('#deckCards .browse-scope')].find((el) => el.disabled);
  assert(member?.disabled);
  assert.match(member.title, /會員限定貼圖/);
  const opsBefore = p.ops.length;
  await press(member);
  assert.equal(p.ops.length, opsBefore, "member emoji cards cannot be converted to universal");

  const rejected = await p.window.OshiDeck.store.runOp("setScope", { id: "member", scope: "global", channelId: NUHU, confirmedDecks: [] });
  assert.equal(rejected.ok, false, "store also rejects a forced-scope conversion");
  assert.equal(saved("member").scope, NUHU);
  console.log("ok   scope conversion, visible warning, cancel, concurrent membership, preserved history, pool and member emoji");
} finally { p.close(); }
