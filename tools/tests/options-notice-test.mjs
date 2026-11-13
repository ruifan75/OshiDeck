// Real options UI, worker operations and input events; only time and Chrome's
// boundary are faked. CSS assertions inspect declarations in jsdom; this
// suite does not measure rendered layout or overlap in Chrome.
import { readFileSync } from "node:fs";
import { optionsPage, NUHU } from "./options-page.mjs";
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "ok   " : "FAIL "}${label}`); };
const css = readFileSync(process.env.OD_OPTIONS_CSS || new URL("../../options.css", import.meta.url), "utf8");
const p = await optionsPage({ fakeTime: true });
const notice = () => p.document.querySelector("#saved");
const action = () => notice().querySelector(".status-action");
const close = () => notice().querySelector(".status-close");
const has = (id) => p.read().cards.some((c) => c.id === id);
async function add(id) {
  await p.window.OshiDeck.store.runOp("addCard", { scope: "global",
    card: { id, tokens: [{ type: "text", value: id }] } });
  await p.settle();
}
async function remove(id) {
  const card = [...p.document.querySelectorAll("#poolCards .browse-card")]
    .find((el) => el.querySelector(".browse-body").textContent === id);
  card.querySelector(".browse-remove").click();
  await p.settle();
}
const pointer = (type) => notice().dispatchEvent(new p.window.Event(type));
try {
  const style = p.document.createElement("style"); style.textContent = css; p.document.head.append(style);
  check("the empty notice keeps a polite atomic live region", notice().getAttribute("aria-live") === "polite" &&
    notice().getAttribute("aria-atomic") === "true" && notice().children.length === 0);
  await add("first card");
  const search = p.document.querySelector("#deckSearch");
  search.focus();
  await remove("first card");
  check("deleting through the real UI creates an undo notice", !has("first card") && !!action() && !!close());
  check("the notice is anchored to the viewport outside the page flow", p.window.getComputedStyle(notice()).position === "fixed" &&
    !notice().closest("main") && p.window.getComputedStyle(notice()).left === "50%");
  check("creating a notice leaves the current input focused", p.document.activeElement === search);
  check("message text can shrink while Undo and Close keep their width", p.window.getComputedStyle(action()).flexShrink === "0" &&
    p.window.getComputedStyle(close()).flexShrink === "0" &&
    p.window.getComputedStyle(notice().querySelector(".status-message")).minWidth === "0" &&
    p.window.getComputedStyle(notice().querySelector(".status-message")).textOverflow === "ellipsis");
  check("the close button has a translated accessible name", close().getAttribute("aria-label") === p.window.OshiDeck.i18n.t("aria.dismissNotice"));
  await p.advance(9999);
  check("an undo remains available for ten seconds", !!action());
  const expired = action();
  await p.advance(1);
  check("expiry clears the notice and its undo", notice().children.length === 0);
  expired.click(); await p.settle();
  check("a detached expired Undo cannot restore a card", !has("first card"));

  await add("hover card"); await remove("hover card");
  await p.advance(4000); pointer("pointerenter");
  await p.advance(20000);
  check("hovering pauses the remaining lifetime", !!action());
  pointer("pointerleave");
  await p.advance(5999);
  check("leaving hover resumes the remaining time rather than restarting it", !!action());
  await p.advance(1);
  check("the resumed hover countdown expires on schedule", notice().children.length === 0);

  await add("keyboard card"); await remove("keyboard card");
  await p.advance(3000); action().focus();
  await p.advance(20000);
  check("keyboard focus pauses the countdown", !!action() && p.document.activeElement === action());
  pointer("pointerenter"); close().focus(); pointer("pointerleave");
  await p.advance(20000);
  check("leaving hover does not resume while a notice button has focus", !!action());
  search.focus();
  await p.advance(6999); check("leaving keyboard focus resumes the remaining time", !!action());
  await p.advance(1); check("the resumed keyboard countdown expires on schedule", notice().children.length === 0);

  await add("undo card"); await remove("undo card");
  action().click(); action()?.click(); await p.settle();
  check("Undo restores the deleted card exactly once", has("undo card") &&
    p.ops.filter((op) => op.op === "restoreCard" && op.args.snapshot.card.id === "undo card").length === 1);

  await add("closed card"); await remove("closed card");
  const dismissed = action(); close().click();
  check("Close dismisses the notice without restoring the card", !has("closed card") && notice().children.length === 0);
  dismissed.click(); await p.settle();
  check("a dismissed Undo cannot act later", !has("closed card"));

  await add("older card"); await add("newer card"); await remove("older card");
  const stale = action();
  const staleClose = close();
  await p.advance(9000); await remove("newer card");
  staleClose.click();
  check("a replaced Close cannot dismiss the current notice", !!action());
  stale.click(); await p.settle();
  check("a replaced Undo cannot restore either deleted card", !has("older card") && !has("newer card"));
  await p.advance(1000);
  check("an older timeout cannot dismiss a replacement notice", !!action());
  action().click(); await p.settle();
  check("the current Undo restores only the latest deleted card", !has("older card") && has("newer card"));

  // Settings used to write directly into the same footer and start a second,
  // shorter timer. Both paths now share the notice's owner and clock.
  const settings = p.document.querySelector('input[name="mode"][value="list"]');
  settings.checked = true; settings.dispatchEvent(new p.window.Event("change", { bubbles: true })); await p.settle();
  await p.advance(500); await add("settings card"); await remove("settings card");
  await p.advance(1200);
  check("a settings acknowledgement cannot expire a later Undo", !!action());
  const same = action();
  const hand = p.document.querySelector('input[name="mode"][value="hand"]');
  hand.checked = true; hand.dispatchEvent(new p.window.Event("change", { bubbles: true })); await p.settle();
  check("saving settings preserves an active Undo", action() === same && !has("settings card"));
  same.click(); await p.settle();
  check("the preserved Undo still restores its card", has("settings card"));

  await add("slow restore"); await add("later deletion"); await remove("slow restore");
  const send = p.window.chrome.runtime.sendMessage;
  let release;
  const held = new Promise((done) => { release = done; });
  p.window.chrome.runtime.sendMessage = async (message) => {
    const reply = await send(message);
    if (message.type === "mutate" && message.op === "restoreCard") await held;
    return reply;
  };
  action().click(); await p.settle();
  await remove("later deletion");
  const latest = action();
  release(); await p.settle();
  p.window.chrome.runtime.sendMessage = send;
  check("a slow Undo reply cannot replace a newer Undo", action() === latest && has("slow restore") && !has("later deletion"));
  latest.click(); await p.settle();
  check("the newer Undo still works after the slow reply", has("later deletion"));

  await add("failed restore"); await add("after failed restore"); await remove("failed restore");
  let failRelease;
  const failedReply = new Promise((done) => { failRelease = done; });
  p.window.chrome.runtime.sendMessage = async (message) => {
    if (message.type === "mutate" && message.op === "restoreCard") { await failedReply; return { ok: false }; }
    return send(message);
  };
  action().click(); await p.settle(); await remove("after failed restore");
  const afterFailure = action(); failRelease(); await p.settle();
  p.window.chrome.runtime.sendMessage = send;
  check("a slow failed Undo cannot replace a newer Undo", action() === afterFailure && !has("failed restore"));
  afterFailure.click(); await p.settle();
  check("the newer Undo works after the earlier restore fails", has("after failed restore"));

  await p.window.OshiDeck.store.runOp("addCard", { channelId: NUHU, scope: NUHU,
    card: { id: "deck card", tokens: [{ type: "text", value: "deck card" }] } }); await p.settle();
  p.document.querySelector("#deckCards .browse-remove").click(); await p.settle();
  check("ejecting a card uses the same visible Undo", !!action() && !p.read().decks[NUHU].includes("deck card"));
  action().click(); await p.settle();
  check("ejection Undo restores the original deck", p.read().decks[NUHU].includes("deck card"));
  p.document.querySelector(".deck-row .deck-delete").click(); await p.settle();
  check("deleting a deck also uses the floating Undo", !(NUHU in p.read().decks) && !!action());
  action().click(); await p.settle();
  check("deck deletion Undo restores the deck and its exclusive cards", p.read().decks[NUHU].includes("deck card") && has("deck card"));
} catch (error) { check(error.stack, false); }
finally { p.close(); }
process.exitCode = failures ? 1 : 0;
