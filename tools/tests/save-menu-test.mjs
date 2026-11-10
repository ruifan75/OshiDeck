// Exercise both ＋ entry points through the complete content script. The
// popup must keep the source it captured, not whichever row is hovered next.
import { contentPage, CHANNEL } from "./content-page.mjs";

let failures = 0;
function check(label, ok) {
  if (!ok) failures++;
  console.log(`${ok ? "ok   " : "FAIL "}${label}`);
}
const menu = (p) => p.document.querySelector(".od-save-menu");
const target = (p, scope) => menu(p)?.querySelector(`[data-scope="${scope}"]`);
const key = (p, value) => {
  const event = new p.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  p.document.activeElement.dispatchEvent(event);
  return event;
};
function openComment(p, row) {
  p.point(row);
  const plus = row.querySelector(".od-grab-plus");
  plus?.click();
  return plus;
}
async function scenario(label, options, run) {
  const p = await contentPage(options);
  try { await run(p); }
  catch (error) { check(`${label}: ${error.stack}`, false); }
  finally { p.close(); }
}

await scenario("comment saves", { preset: false }, async (p) => {
  const info = p.document.createElement("ytd-video-description-infocards-section-renderer");
  info.innerHTML = `<h3>Fixture channel</h3><a href="/channel/${CHANNEL}">channel</a>`;
  p.document.body.appendChild(info);
  await p.settings({ language: "zh-TW" });
  const row = p.comment("captured comment");
  const other = p.comment("a different comment");
  const plus = openComment(p, row);
  check("the comment ＋ opens one adjacent menu with a visible heading",
    menu(p)?.textContent.startsWith("儲存為") && p.document.querySelectorAll(".od-save-menu").length === 1);
  check("the popup escapes the clipped source row", menu(p)?.parentElement === p.document.body);
  check("both scopes have visible names and explanations",
    target(p, "channel")?.textContent === "這個頻道專用只會出現在這個頻道的牌組裡" &&
    target(p, "global")?.textContent === "通用任何頻道的牌組都能加入");
  check("the channel name is available to a screen reader",
    target(p, "channel")?.getAttribute("aria-label").includes("Fixture channel"));
  check("the opener announces a menu and its expanded state",
    plus?.getAttribute("aria-haspopup") === "menu" && plus?.getAttribute("aria-expanded") === "true");
  check("opening focuses the first enabled choice", p.document.activeElement === target(p, "channel"));
  p.point(other);
  p.point(menu(p));
  check("moving across chat rows to the popup keeps the original source",
    row.contains(plus) && !other.querySelector(".od-grab"));
  target(p, "channel").click();
  await p.advance();
  const saved = await p.window.OshiDeck.store.read();
  check("the channel choice saves exactly the captured comment for this channel",
    saved.cards.length === 1 && saved.cards[0].tokens[0].value === "captured comment" &&
    saved.cards[0].scope === CHANNEL && saved.decks[CHANNEL]?.includes(saved.cards[0].id));
  check("a completed save dismisses the popup", !menu(p));
  openComment(p, other);
  target(p, "global").click();
  await p.advance();
  const universal = (await p.window.OshiDeck.store.read()).cards.find((card) => card.tokens[0].value === "a different comment");
  check("the other choice saves a global card", universal?.scope === "global");
});

await scenario("keyboard and dismissal", {}, async (p) => {
  const row = p.comment("keyboard source");
  const plus = openComment(p, row);
  check("Down moves focus to global", key(p, "ArrowDown").defaultPrevented && p.document.activeElement === target(p, "global"));
  key(p, "ArrowDown");
  check("Down wraps back to channel", p.document.activeElement === target(p, "channel"));
  key(p, "End");
  check("End selects the last enabled choice", p.document.activeElement === target(p, "global"));
  key(p, "Home");
  key(p, "ArrowUp");
  check("Up wraps to the last enabled choice", p.document.activeElement === target(p, "global"));
  const escape = key(p, "Escape");
  check("Escape dismisses, consumes the key and restores the opener",
    !menu(p) && escape.defaultPrevented && p.document.activeElement === plus && plus.getAttribute("aria-expanded") === "false");
  plus.click();
  const tab = key(p, "Tab");
  check("Tab resumes the page's tab order at the opener",
    !menu(p) && !tab.defaultPrevented && p.document.activeElement === plus);
  plus.click();
  plus.dispatchEvent(new p.window.Event("pointerdown", { bubbles: true }));
  plus.click();
  check("pressing the same ＋ toggles its menu closed", !menu(p));
  plus.click();
  p.document.body.dispatchEvent(new p.window.Event("pointerdown", { bubbles: true }));
  check("a press outside dismisses", !menu(p));
  check("dismissal never saves a card", (await p.window.OshiDeck.store.read()).cards.length === 0);
  plus.click();
  plus.dispatchEvent(new p.window.MouseEvent("click", { shiftKey: true, bubbles: true }));
  check("Shift＋click still takes a comment to the editor and closes the menu",
    !menu(p) && p.document.querySelector('[contenteditable="true"]').textContent === "keyboard source" &&
    (await p.window.OshiDeck.store.read()).cards.length === 0);
});

await scenario("member emoji", {}, async (p) => {
  const row = p.comment("");
  const image = p.document.createElement("img");
  image.setAttribute("data-emoji-id", `${CHANNEL}/heart`);
  image.setAttribute("shared-tooltip-text", ":_heart:");
  image.setAttribute("src", "https://example.test/heart.png");
  row.querySelector("#message").appendChild(image);
  openComment(p, row);
  check("member emoji disable global and explain why in visible text",
    target(p, "global")?.disabled && target(p, "global").querySelector(".od-target-detail").textContent ===
      p.window.OshiDeck.i18n.t("save.forcedWhy"));
  target(p, "global").click();
  check("a disabled choice cannot save", (await p.window.OshiDeck.store.read()).cards.length === 0 && !!menu(p));
  key(p, "ArrowDown");
  check("keyboard navigation skips a disabled choice", p.document.activeElement === target(p, "channel"));
  target(p, "channel").click();
  await p.advance();
  check("the available choice preserves the member emoji and its channel",
    (await p.window.OshiDeck.store.read()).cards.some((card) => card.scope === CHANNEL && card.tokens[0].emojiId === `${CHANNEL}/heart`));
});

for (const mode of ["hand", "list"]) {
  await scenario(`${mode} drawn card`, { mode, preset: false }, async (p) => {
    const drawn = await p.draw();
    const plus = drawn?.querySelector(".od-card-tools button");
    check(`${mode}: a drawn card exposes its save menu`, !!plus);
    if (!plus) return;
    p.root.dispatchEvent(new p.window.Event("pointerenter"));
    plus.click();
    const original = menu(p);
    p.root.dispatchEvent(new p.window.Event("pointerleave"));
    await p.settings({ folded: true });
    await p.advance(8000);
    check(`${mode}: an automatic redraw cannot remove the chosen source while deciding`,
      menu(p) === original && plus.isConnected);
    target(p, "global").click();
    await p.advance();
    check(`${mode}: the drawn card can be kept as global`,
      (await p.window.OshiDeck.store.read()).cards.some((card) => card.tokens[0].value === "drawn reaction" && card.scope === "global"));
    check(`${mode}: closing releases the pending redraw`, p.root.hasAttribute("data-folded"));
  });
}

await scenario("drawn Shift shortcut", { preset: false }, async (p) => {
  await p.settings({ autoSend: true });
  const drawn = await p.draw();
  const plus = drawn.querySelector(".od-card-tools button");
  plus.click();
  plus.dispatchEvent(new p.window.MouseEvent("click", { shiftKey: true, bubbles: true }));
  await p.advance();
  check("Shift＋click on a drawn ＋ fills the editor without saving, even with auto-send",
    !menu(p) && p.document.querySelector('[contenteditable="true"]').textContent === "drawn reaction" &&
    (await p.window.OshiDeck.store.read()).cards.length === 0);
});

await scenario("an in-flight redraw", { preset: false }, async (p) => {
  const drawn = await p.draw();
  const plus = drawn.querySelector(".od-card-tools button");
  const store = p.window.OshiDeck.store;
  const read = store.read;
  const data = await read();
  await p.window.chrome.storage.local.set({ settings: { ...data.settings, folded: true } });
  let release, reading;
  const gate = new Promise((done) => { release = done; });
  const started = new Promise((done) => { reading = done; });
  store.read = async () => { reading(); await gate; return read(); };
  try {
    const advancing = p.advance(250);
    await started;
    plus.click();
    const original = menu(p);
    release();
    await advancing;
    check("a redraw already awaiting storage also holds the chosen source",
      original && menu(p) === original && plus.isConnected);
    key(p, "Escape");
  } finally { release(); store.read = read; }
  await p.advance();
  check("the held in-flight change is applied after dismissal", p.root.hasAttribute("data-folded"));
});

await scenario("source and page lifecycle", {}, async (p) => {
  let plus = openComment(p, p.comment("removed source"));
  plus.closest("yt-live-chat-text-message-renderer").remove();
  await p.advance();
  check("removing the source row dismisses its popup", !menu(p));
  plus = openComment(p, p.comment("input hidden"));
  const inputPanel = p.document.querySelector("yt-live-chat-message-input-renderer");
  inputPanel.hidden = true;
  await p.advance();
  check("YouTube hiding the input also dismisses the popup", !menu(p) && p.root.hidden);
  plus.click();
  check("a stale ＋ cannot open while the panel is hidden", !menu(p));
  inputPanel.hidden = false;
  await p.advance();
  plus = openComment(p, p.comment("channel moved"));
  const staleChoice = target(p, "global");
  p.document.querySelector('meta[itemprop="channelId"]').remove();
  p.window.history.replaceState({}, "", "?v=aaaaaaaaaaa");
  // Before the asynchronous observer/navigation event has run, even a held
  // reference to the old choice must not save against the new page.
  staleChoice.click();
  p.window.dispatchEvent(new p.window.Event("yt-navigate-finish"));
  await p.advance();
  check("navigation dismisses and removes the old comment control", !menu(p) && !plus.isConnected);
  check("a stale choice cannot save against another channel", (await p.window.OshiDeck.store.read()).cards.length === 0);
});

await scenario("shutdown", {}, async (p) => {
  openComment(p, p.comment("before reload"));
  p.stop();
  // A pending redraw still checks extension lifetime before holding the menu.
  await p.settings({ folded: true });
  check("invalidating the extension removes the popup and its controls", !menu(p) && !p.document.querySelector(".od-grab"));
});

process.exitCode = failures ? 1 : 0;
