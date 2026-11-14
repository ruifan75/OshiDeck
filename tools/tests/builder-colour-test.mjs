import { optionsPage, NUHU, NONO } from "./options-page.mjs";
import { readFileSync } from "node:fs";

let failures = 0;
function check(label, ok) {
  if (!ok) failures++;
  console.log(`${ok ? "ok   " : "FAIL "}${label}`);
}
const p = await optionsPage();
const style = p.document.createElement("style");
style.textContent = readFileSync(process.env.OD_MARK_CSS || new URL("../../src/channel-marks.css", import.meta.url), "utf8") +
  readFileSync(new URL("../../options.css", import.meta.url), "utf8");
p.document.head.append(style);
const badge = () => p.document.querySelector("#deckHeader .hue-picker .od-channel-mark");
const slider = () => p.document.querySelector("#deckHeader .hue-slider");
const picker = () => p.document.querySelector("#deckHeader .hue-pick");
const input = async (element, value, event = "input") => {
  element.value = value;
  element.dispatchEvent(new p.window.Event(event, { bubbles: true }));
  await p.settle();
};
try {
  check("the builder's current colour is Nuhu's picker badge", badge()?.dataset.mark === "picker");
  check("the badge still contains an accessible native colour picker",
    picker()?.type === "color" && picker().getAttribute("aria-label") === p.window.OshiDeck.i18n.t("opt.colourPicker") &&
    badge().getAttribute("aria-hidden") === "true");
  const originalInput = picker(), originalBadge = badge();
  slider().focus();
  for (const [hue, angle] of [[120, 9.23], [210, 126.91], [300, 202.43], [359, 278.06], [0, 279.11]]) {
    await input(slider(), String(hue));
    check(`dragging to hue ${hue} immediately rotates the builder's heart`,
      badge().style.getPropertyValue("--od-scope-hue") === String(hue) &&
      badge().querySelector(".od-mark-orbit").style.transform === `rotate(${angle}deg)`);
  }
  check("dragging keeps the same picker, badge and keyboard focus alive",
    picker() === originalInput && badge() === originalBadge && p.document.activeElement === slider());
  check("dragging previews without writing storage", p.ops.length === 0 && p.read().channelMeta[NUHU].hue === 30);
  await input(slider(), "210", "change");
  check("releasing the slider saves its hue once for the selected channel",
    p.ops.filter((op) => op.op === "setChannel").length === 1 && p.read().channelMeta[NUHU].hue === 210);

  const currentPicker = picker();
  const before = p.ops.length;
  currentPicker.focus();
  await input(currentPicker, "#00ff00");
  const green = p.window.OshiDeck.store.hueFromHex("#00ff00");
  check("native colour input immediately rotates the same badge",
    picker() === currentPicker && badge().style.getPropertyValue("--od-scope-hue") === String(green) &&
    badge().querySelector(".od-mark-orbit").style.transform === "rotate(60deg)");
  check("preview leaves the native chooser's value and focus alone",
    currentPicker.value === "#00ff00" && p.document.activeElement === currentPicker && slider().value === String(green));
  check("native colour preview does not save or rebuild", p.ops.length === before && currentPicker.isConnected);
  await input(currentPicker, "#00ff00", "change");
  check("completing native selection saves the previewed colour", p.read().channelMeta[NUHU].hue === green && p.read().channelMeta[NUHU].color === "#00FF00" &&
    !badge().hasAttribute("data-neutral") && picker().value === "#00ff00" && p.ops.length === before + 1);

  const swatch = [...p.document.querySelectorAll("#deckHeader .swatch")]
    .find((button) => button.style.getPropertyValue("--hue") === "250");
  swatch.click();
  await p.settle();
  check("preset swatches also update the decorated picker", p.read().channelMeta[NUHU].hue === 250 &&
    badge().querySelector(".od-mark-orbit").style.transform === "rotate(149.8deg)");

  const stale = picker();
  const rows = p.document.querySelectorAll(".deck-row");
  rows[1].click();
  await p.settle();
  check("Nono gets the same rainbow badge in the builder", badge()?.dataset.mark === "rainbow");
  await input(stale, "#ff0000");
  check("a detached chooser cannot preview onto the new channel", badge().dataset.mark === "rainbow" &&
    badge().style.getPropertyValue("--od-scope-hue") === "100");
  const beforeStaleSave = p.ops.length;
  await input(stale, "#ff0000", "change");
  check("a detached chooser cannot overwrite either channel",
    p.ops.length === beforeStaleSave && p.read().channelMeta[NUHU].hue === 250 && p.read().channelMeta[NONO].hue === 100);
  await input(picker(), "#0000ff", "change");
  check("new colour selection is saved for the new channel", p.read().channelMeta[NONO].hue === p.window.OshiDeck.store.hueFromHex("#0000ff") &&
    p.read().channelMeta[NUHU].hue === 250);

  // A neutral selection must survive the fallback hue used by the slider.
  rows[0].click();
  await p.settle();
  const priorNeutral = p.ops.length;
  await input(picker(), "#808080");
  check("native grey previews without saving or selecting a chromatic swatch",
    badge().style.getPropertyValue("--od-neutral") === "#808080" &&
    !p.document.querySelector("#deckHeader .swatch[data-on]") && p.ops.length === priorNeutral);
  check("a neutral preview hides the existing chromatic pointer",
    p.window.getComputedStyle(badge().querySelector(".od-mark-orbit")).visibility === "hidden");
  await input(picker(), "#808080", "change");
  check("native grey survives rebuilding the builder and reopening its picker",
    p.read().channelMeta[NUHU].color === "#808080" && picker().value === "#808080" &&
    p.document.querySelector(".deck-dot").style.getPropertyValue("--od-neutral") === "#808080");
  for (const color of ["#ffffff", "#000000", "#808080"]) {
    await input(picker(), color, "change");
    const orbit = badge().querySelector(".od-mark-orbit");
    check(`the builder's ${color} keeps the real colour without pointing at pink`,
      p.read().channelMeta[NUHU].color === color.toUpperCase() && picker().value === color &&
      p.window.getComputedStyle(orbit).visibility === "hidden");
  }
  await input(slider(), "120", "change");
  check("the builder can return from neutral to a chromatic hue",
    !p.read().channelMeta[NUHU].color && !badge().hasAttribute("data-neutral") &&
    !p.document.querySelector(".deck-dot").style.getPropertyValue("--od-neutral") &&
    p.window.getComputedStyle(badge().querySelector(".od-mark-orbit")).visibility === "visible");
} catch (error) { check(error.stack, false); }
finally { p.close(); }

const WHITE = "UCF_U2GCKHvDz52jWdizppIA";
const n = await optionsPage({ channel: WHITE, channelMeta: { [WHITE]: { name: "White channel" } } });
try {
  const mark = n.document.querySelector("#deckHeader .od-channel-mark");
  check("the builder opens on a neutral starting colour without inventing a hue selection",
    mark?.hasAttribute("data-neutral") && mark.style.getPropertyValue("--od-neutral") === "#FFFFFF" &&
    n.document.querySelector(".hue-pick").value === "#ffffff" &&
    !n.document.querySelector("#deckHeader .swatch[data-on]"));
  await n.window.OshiDeck.store.runOp("loadPreset", { channelId: WHITE, name: "White channel", cards: [
    { id: "neutral-card", scope: "channel", tokens: [{ type: "text", value: "White card" }] }
  ] });
  await n.settle();
  check("the builder gives both its deck dot and channel card the neutral colour",
    n.document.querySelector(".deck-dot").style.getPropertyValue("--od-neutral") === "#FFFFFF" &&
    n.document.querySelector(".browse-card").style.getPropertyValue("--od-neutral") === "#FFFFFF");
} catch (error) { check(error.stack, false); }
finally { n.close(); }
const SUU = "UCeqIMtLuGc3YgwkhEaG8oDg";
const restored = await optionsPage({ channel: SUU, channelMeta: { [SUU]: { name: "Sample", hue: 286 } } });
try {
  const reset = restored.document.querySelector(".colour-reset");
  reset.click(); await restored.settle();
  check("the builder can reset an old purple selection to Suu's original HEX",
    restored.document.querySelector(".hue-pick").value === "#27272a" &&
    restored.document.querySelector(".deck-dot").style.getPropertyValue("--od-neutral") === "#27272A");
  await restored.window.OshiDeck.store.runOp("loadPreset", { channelId: SUU, name: "Sample", cards: [
    { id: "hex-sample", scope: "channel", tokens: [{ type: "text", value: "sample card" }] }
  ] });
  await restored.settle();
  const chooser = restored.document.querySelector(".hue-pick");
  chooser.value = "#1234ab";
  chooser.dispatchEvent(new restored.window.Event("change", { bubbles: true }));
  await restored.settle();
  check("the builder preserves dark chromatic HEX after saving and repainting",
    restored.read().channelMeta[SUU].color === "#1234AB" &&
    restored.document.querySelector(".hue-pick").value === "#1234ab" &&
    restored.document.querySelector(".browse-card").style.getPropertyValue("--od-neutral") === "#1234AB");
} catch (error) { check(error.stack, false); }
finally { restored.close(); }
process.exitCode = failures ? 1 : 0;
