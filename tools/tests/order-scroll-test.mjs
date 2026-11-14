// Exercise saved deck order, chat weighting and overflow through the full script.
import { readFileSync } from "node:fs";
import { contentPage, CHANNEL } from "./content-page.mjs";
let failed = 0;
const check = (label, ok) => { if (!ok) failed++; console.log(`${ok ? "ok   " : "FAIL "}${label}`); };
const order = (p, mode) => [...p.root.querySelectorAll(mode === "list" ? ".od-listcard-play" : ".od-card-body")]
  .map((el) => el.textContent).join(",");
for (const mode of ["hand", "list"]) {
  const p = await contentPage({ mode, cards: ["first", "second", "third"], preset: false });
  try {
    const now = p.window.Date.now();
    const cards = ["first", "second", "third"].map((value, i) => ({ id: `card-${i}`,
      tokens: [{ type: "text", value }], scope: "global", by: {} }));
    await p.update({ decks: { [CHANNEL]: ["card-2", "card-0", "card-1"] } });
    for (const sortBy of ["manual", "uses", "heat", "trend"]) {
      await p.settings({ sortBy, suggest: false, pace: 1000 });
      check(`${mode}: ${sortBy} without weights follows the saved deck order`, order(p, mode) === "third,first,second");
    }
    cards[1].by[CHANNEL] = { uses: 20, heat: 20, lastUsedAt: now };
    await p.update({ cards });
    check(`${mode}: quiet chat uses manual order instead of historical heat`, order(p, mode) === "third,first,second");
    for (const sortBy of ["uses", "heat"]) {
      await p.settings({ sortBy });
      check(`${mode}: ${sortBy} prioritises its weight and keeps tied cards in manual order`, order(p, mode) === "second,third,first");
    }
    await p.settings({ sortBy: "trend" });
    for (let i = 0; i < 6; i++) p.comment("first");
    await p.advance(4500);
    check(`${mode}: chat weight leads while unmatched cards keep manual order`, order(p, mode) === "first,third,second");
    await p.advance(20000);
    check(`${mode}: expired chat weights return to manual order`, order(p, mode) === "third,first,second");
  } finally { p.close(); }
  const many = Array.from({ length: 40 }, (_, i) => `reaction ${i}`);
  const long = await contentPage({ mode, cards: many, preset: false });
  try {
    const style = long.document.createElement("style");
    style.textContent = readFileSync(process.env.OD_CSS || new URL("../../content.css", import.meta.url), "utf8");
    long.document.head.append(style);
    const body = long.root.querySelector(mode === "list" ? ".od-list" : ".od-hand");
    check(`${mode}: all cards are rendered in a capped scroll container`,
      order(long, mode) === many.join(",") && body.dataset.scrollable === "true" &&
      long.window.getComputedStyle(body).overflowY === "auto" &&
      long.window.getComputedStyle(body).maxHeight !== "" &&
      long.window.getComputedStyle(body).maxHeight !== "none");
    check(`${mode}: scrolling needs no more-or-collapse control`, !long.root.querySelector("button.od-more"));
    const controls = long.root.querySelectorAll(mode === "list" ? ".od-listcard-play" : ".od-card-body");
    controls[39].click();
    await long.advance();
    check(`${mode}: the last card is usable without expanding the panel`,
      long.document.querySelector('[contenteditable="true"]').textContent === "reaction 39");
  } finally { long.close(); }
}
process.exitCode = failed ? 1 : 0;
