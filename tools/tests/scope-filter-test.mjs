// Click the real identity controls and inspect the rendered cards, rather
// than testing a copied scope predicate or looking for calls in the source.
import { contentPage, CHANNEL } from "./content-page.mjs";

let failures = 0;
function check(label, ok) {
  if (!ok) failures++;
  console.log(`${ok ? "ok   " : "FAIL "}${label}`);
}
const card = (id, scope) => ({ id, scope, tokens: [{ type: "text", value: id }], createdAt: 1, by: {} });
const toggle = (p, scope) => p.root.querySelector(`.od-scope-filter[data-filter="${scope}"]`);
const values = (p) => [...p.root.querySelectorAll(".od-card-body, .od-listcard-play")].map((el) => el.textContent).sort();
const shows = (p, expected) => JSON.stringify(values(p)) === JSON.stringify([...expected].sort());
const pressed = (p, scope) => toggle(p, scope)?.getAttribute("aria-pressed") === "true";
async function choose(p, scope) {
  const button = toggle(p, scope);
  button?.focus();
  button?.click();
  await p.advance();
}
async function scenario(label, options, run) {
  const p = await contentPage(options);
  try { await run(p); }
  catch (error) { check(`${label}: ${error.stack}`, false); }
  finally { p.close(); }
}
async function deck(p, cards) {
  await p.update({ cards, decks: { [CHANNEL]: cards.map((c) => c.id) } });
}

for (const mode of ["hand", "list"]) {
  await scenario(mode, { mode, preset: false }, async (p) => {
    const cards = [card("channel-a", CHANNEL), card("global-a", "global"), card("channel-b", CHANNEL)];
    await deck(p, cards);
    const before = await p.window.OshiDeck.store.read();
    const identity = p.root.querySelector(".od-bar-identity");
    check(`${mode}: the identity has two labelled scope buttons, two dots and no plus or count`,
      identity?.querySelectorAll(".od-scope-filter").length === 2 &&
      identity.querySelectorAll(".od-dot").length === 2 &&
      !identity.querySelector(".od-plus-sign, .od-count") && !/[＋+]|\d/.test(identity.textContent));
    check(`${mode}: neither selected is the initial full deck`,
      !pressed(p, "channel") && !pressed(p, "global") && shows(p, ["channel-a", "global-a", "channel-b"]));
    await choose(p, "channel");
    check(`${mode}: channel alone shows only channel cards`,
      pressed(p, "channel") && !pressed(p, "global") && shows(p, ["channel-a", "channel-b"]));
    check(`${mode}: choosing a scope does not fold the panel`, !p.root.hasAttribute("data-folded"));
    check(`${mode}: a redraw restores keyboard focus to the chosen scope`,
      p.document.activeElement === toggle(p, "channel"));
    await choose(p, "global");
    check(`${mode}: both selected show the full deck`,
      pressed(p, "channel") && pressed(p, "global") && shows(p, ["channel-a", "global-a", "channel-b"]));
    await choose(p, "channel");
    check(`${mode}: global alone shows only global cards`,
      !pressed(p, "channel") && pressed(p, "global") && shows(p, ["global-a"]));
    await choose(p, "global");
    check(`${mode}: turning off the last scope returns to the full deck`,
      !pressed(p, "channel") && !pressed(p, "global") && shows(p, ["channel-a", "global-a", "channel-b"]));
    const after = await p.window.OshiDeck.store.read();
    check(`${mode}: filtering changes neither saved cards nor deck membership`,
      JSON.stringify(after.cards) === JSON.stringify(before.cards) && JSON.stringify(after.decks) === JSON.stringify(before.decks));

    // One category can contain the whole deck. Its buttons must still redraw
    // when the visible card list stays exactly the same.
    await deck(p, [card("global-only", "global")]);
    await choose(p, "global");
    check(`${mode}: a scope selection updates even when every visible card stays the same`,
      pressed(p, "global") && shows(p, ["global-only"]));
    await choose(p, "global");
    await choose(p, "channel");
    check(`${mode}: zero matches keep both filters available with an honest empty message`,
      !!toggle(p, "channel") && !!toggle(p, "global") && values(p).length === 0 &&
      p.root.querySelector(".od-empty")?.textContent === p.window.OshiDeck.i18n.t("filter.empty"));
    await choose(p, "channel");
    check(`${mode}: the empty filter can always be cleared`, shows(p, ["global-only"]));

    await choose(p, "channel");
    await p.update({ cards: [], decks: { [CHANNEL]: [] } });
    check(`${mode}: removing the last saved card does not strand an active filter`, !!toggle(p, "channel"));
    await choose(p, "channel");
    check(`${mode}: clearing it restores the original new-deck hint`,
      p.root.querySelector(".od-bar-line")?.textContent === p.window.OshiDeck.i18n.t("pool.emptyHint"));
  });
}

await scenario("fold and pool", { preset: true }, async (p) => {
  const a = card("channel-a", CHANNEL), b = card("global-a", "global"), waiting = card("waiting", "global");
  await p.update({ cards: [a, b, waiting], decks: { [CHANNEL]: [a.id, b.id] } });
  await choose(p, "channel");
  p.root.querySelector(".od-fold").click();
  await p.advance();
  check("the separate chevron still folds the filtered hand", p.root.hasAttribute("data-folded"));
  await choose(p, "global");
  check("filtering while folded keeps it folded", p.root.hasAttribute("data-folded") && pressed(p, "global"));
  p.root.querySelector(".od-fold").click();
  await p.advance();
  check("unfolding restores the selected view", shows(p, ["channel-a", "global-a"]));
  await choose(p, "global");
  const openPool = [...p.root.querySelectorAll(".od-bar > button")]
    .find((el) => el.getAttribute("aria-label") === p.window.OshiDeck.i18n.t("aria.addFromPool"));
  openPool.click();
  await p.advance();
  check("the channel filter does not hide global cards in the pool", p.root.dataset.pool === "true" && shows(p, ["waiting"]));
  p.root.querySelector('.od-bar > button').click();
  await p.advance();
  check("leaving the pool restores the chosen deck filter", pressed(p, "channel") && shows(p, ["channel-a"]));
});

await scenario("loaned cards", { preset: true }, async (p) => {
  await deck(p, [card("global-a", "global")]);
  await choose(p, "channel");
  await p.draw("new reaction");
  check("a loan without a saved scope stays out of a category-only view",
    !p.root.querySelector(".od-drawn"));
  await choose(p, "channel");
  check("a loan without a saved scope appears again in the full view", !!p.root.querySelector(".od-drawn"));
});

await scenario("channel navigation", { preset: false }, async (p) => {
  await deck(p, [card("global-a", "global"), card("channel-a", CHANNEL)]);
  await choose(p, "channel");
  const next = "UC" + "b".repeat(22);
  await p.update({ decks: { [CHANNEL]: ["global-a", "channel-a"], [next]: ["global-a"] } });
  p.document.querySelector('meta[itemprop="channelId"]').content = next;
  p.window.history.replaceState({}, "", "?v=aaaaaaaaaaa");
  p.window.dispatchEvent(new p.window.Event("yt-navigate-finish"));
  await p.advance();
  check("another channel starts with neither selected and its whole deck visible",
    !pressed(p, "channel") && !pressed(p, "global") && shows(p, ["global-a"]));
});

process.exitCode = failures ? 1 : 0;
