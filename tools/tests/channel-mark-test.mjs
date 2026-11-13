// These badges are decoration on existing scope controls. Use the complete
// content script so a pretty badge that breaks filtering or saving fails too.
import { readFileSync } from "node:fs";
import { contentPage, CHANNEL } from "./content-page.mjs";

let failures = 0;
const check = (label, ok) => {
  if (!ok) failures++;
  console.log(`${ok ? "ok   " : "FAIL "}${label}`);
};
const css = readFileSync(process.env.OD_MARK_CSS || new URL("../../src/channel-marks.css", import.meta.url), "utf8") +
  readFileSync(process.env.OD_CSS || new URL("../../content.css", import.meta.url), "utf8");
const cases = [
  ["Nono", "UCVKWgVm8BSlMkGZIDGaoElw", "rainbow", 12],
  ["Nono's old channel", "UCtKH7ZHAJ7TcTjyiLJRHhvg", "rainbow", 12],
  ["Nuhu", "UCj63OWl-HQ-I6ORzUWF1EDg", "picker", 14],
  ["an ordinary channel", CHANNEL, undefined, 8]
];

// jsdom chooses the later declaration even when :not() gives an earlier one
// greater specificity. Compare the matching dot rules explicitly. Refuse selectors
// outside this small class/:not(class) case rather than guessing their weight.
function dotBackground(element, sheet) {
  const matching = [...sheet.cssRules].filter((rule) => rule.selectorText &&
    rule.style?.background && element.matches(rule.selectorText));
  for (const rule of matching) {
    if (!/^(?:\.[\w-]+|:not\(\.[\w-]+\))+$/.test(rule.selectorText)) {
      throw new Error(`dotBackground cannot score ${rule.selectorText}`);
    }
  }
  return matching.map((rule, at) => ({ rule, at,
    weight: (rule.selectorText.match(/\.[\w-]+/g) || []).length }))
    .sort((a, b) => a.weight - b.weight || a.at - b.at).at(-1)?.rule.style.background;
}

// Read the static gradient as data and sample its stops, rather than pinning
// a particular spelling of the CSS declaration. Refuse other gradient forms.
function wheelAt(sheet, degrees) {
  const rule = [...sheet.cssRules].find((r) => r.selectorText === '.od-channel-mark[data-mark="picker"]::before');
  const parsed = /^conic-gradient\(from (-?\d+)deg,\s*((?:#[0-9a-f]{6}\s+\d+deg,?\s*)+)\)$/i.exec(rule?.style.background || "");
  if (!parsed) throw new Error("wheelAt cannot read the picker gradient");
  const stops = [...parsed[2].matchAll(/#([0-9a-f]{6})\s+(\d+)deg/gi)]
    .map((m) => ({ at: Number(m[2]), rgb: m[1].match(/../g).map((v) => parseInt(v, 16)) }));
  const at = ((degrees - Number(parsed[1])) % 360 + 360) % 360;
  const next = stops.findIndex((s) => s.at > at);
  if (next < 1) throw new Error("wheelAt needs an enclosing pair of stops");
  const a = stops[next - 1], b = stops[next];
  return a.rgb.map((v, i) => Math.round(v + (b.rgb[i] - v) * (at - a.at) / (b.at - a.at))).join(",");
}

for (const [name, channel, kind, size] of cases) {
  const p = await contentPage({ preset: false });
  try {
    const style = p.document.createElement("style");
    style.textContent = css;
    p.document.head.appendChild(style);
    const info = p.document.createElement("ytd-video-description-infocards-section-renderer");
    // Even an unrelated channel with this display name must stay ordinary.
    info.innerHTML = `<h3>彩雲のの</h3><a href="/channel/${channel}">owner</a>`;
    p.document.body.appendChild(info);
    p.document.querySelector('meta[itemprop="channelId"]').content = channel;
    const cards = [
      { id: "channel-card", scope: channel, tokens: [{ type: "text", value: "channel card" }] },
      { id: "global-card", scope: "global", tokens: [{ type: "text", value: "global card" }] }
    ];
    await p.update({ cards, decks: { [channel]: cards.map((c) => c.id) },
      channelMeta: { [channel]: { hue: 30 } } });
    const scope = () => p.root.querySelector('[data-filter="channel"]');
    const badge = () => scope().querySelector(".od-dot");
    check(`${name}: the badge is selected by channel id`, badge().dataset.mark === kind);
    check(`${name}: its native size stays readable`,
      p.window.getComputedStyle(badge()).width === `${size}px` && p.window.getComputedStyle(badge()).height === `${size}px`);
    check(`${name}: decoration has no separate focus or announced label`,
      badge().getAttribute("aria-hidden") === "true" && badge().tabIndex === -1 && !badge().querySelector("button, input"));
    const common = p.root.querySelector('[data-filter="global"] .od-dot');
    check(`${name}: the common marker stays plain grey`, common.classList.contains("od-dot-common") && !common.dataset.mark &&
      dotBackground(common, style.sheet)?.includes("--od-common"));
    if (kind === "picker") {
      check("the hair ornament wheel puts yellow at twelve",
        wheelAt(style.sheet, 0) === "255,255,0");
      check("the hair ornament wheel proceeds clockwise through green blue indigo purple red and orange",
        [[60, "0,255,0"], [180, "0,0,255"], [210, "128,0,255"],
          [240, "255,0,255"], [300, "255,0,0"], [330, "255,128,0"]]
          .every(([angle, rgb]) => wheelAt(style.sheet, angle) === rgb));
      check("RGB colours locate the heart on the same wheel as the hair ornament",
        [["#ffff00", 0], ["#00ff00", 60], ["#00ffff", 120], ["#0000ff", 180],
          ["#8000ff", 210.12], ["#ff00ff", 240], ["#ff0000", 300], ["#ff8000", 330.12]]
          .every(([hex, angle]) => p.window.OshiDeck.channelMarks.angleOfColor(hex) === angle));
      const heart = badge().querySelector("svg.od-mark-heart");
      check("Nuhu's badge keeps the little heart", !!heart?.querySelector("path"));
      const heartStyle = p.window.getComputedStyle(heart);
      check("Nuhu's heart starts at the top of its orbit with its tip inward",
        heartStyle.left === "50%" && heartStyle.top === "0px" &&
        heartStyle.transform === "translate(-50%, -50%)");
      // Compass points, an off-axis hue, and the wrap around zero. A down-
      // pointing heart at the top of the orbit points toward the centre;
      // rotating its parent moves and turns the heart together.
      for (const [hue, degrees] of [[30, 307.97], [120, 9.23], [210, 126.91], [300, 202.43],
        [195, 120], [359, 278.06], [0, 279.11]]) {
        await p.update({ channelMeta: { [channel]: { hue } } });
        const orbit = badge().querySelector(".od-mark-orbit");
        check(`Nuhu's heart follows hue ${hue} around the ring`,
          orbit?.style.transform === `rotate(${degrees}deg)` && orbit.contains(badge().querySelector("svg.od-mark-heart")));
      }
      for (const color of ["#FFFFFF", "#000000", "#808080", "#D7D3DE"]) {
        await p.update({ channelMeta: { [channel]: { hue: 0, color } } });
        const orbit = badge().querySelector(".od-mark-orbit");
        check(`Nuhu's ${color} has its actual neutral colour without a false hue indicator`,
          badge().style.getPropertyValue("--od-neutral") === color &&
          p.window.getComputedStyle(orbit).visibility === "hidden");
      }
      await p.update({ channelMeta: { [channel]: { hue: 120 } } });
      check("Nuhu's heart returns when a chromatic hue is selected again",
        p.window.getComputedStyle(badge().querySelector(".od-mark-orbit")).visibility === "visible" &&
        badge().querySelector(".od-mark-orbit").style.transform === "rotate(9.23deg)");
    }

    badge().click();
    await p.advance();
    check(`${name}: clicking the badge still filters the channel's cards`,
      scope().getAttribute("aria-pressed") === "true" &&
      p.root.querySelectorAll('.od-card[data-scope="channel"]').length === 1 &&
      p.root.querySelectorAll('.od-card[data-scope="global"]').length === 0);

    await p.update({ channelMeta: { [channel]: { hue: 195 } } });
    check(`${name}: recolouring keeps the style and updates its hue`,
      badge().dataset.mark === kind && badge().style.getPropertyValue("--od-scope-hue") === "195");
    // Scope stripes keep the real saved hue; the ornament must not turn a
    // channel card or a global card into another kind of card.
    check(`${name}: the card stripe keeps its scope and ordinary hue`,
      p.root.querySelector('.od-card[data-scope="channel"]').style.getPropertyValue("--od-scope-hue") === "195");

    const row = p.comment("save this comment");
    p.point(row);
    row.querySelector(".od-grab-plus").click();
    const destination = p.document.querySelector('.od-save-menu [data-scope="channel"]');
    const mark = destination.querySelector(".od-dot");
    check(`${name}: the save menu uses the same badge without adding a line`,
      mark.dataset.mark === kind && p.window.getComputedStyle(mark).position === "absolute");
    destination.click();
    await p.advance();
    check(`${name}: the decorated save target still saves for this channel`,
      (await p.window.OshiDeck.store.read()).cards.some((c) => c.scope === channel && c.tokens[0].value === "save this comment"));
  } catch (error) { check(`${name}: ${error.stack}`, false); }
  finally { p.close(); }
}

for (const mode of ["hand", "list"]) {
  const p = await contentPage({ mode, preset: false });
  try {
    const channel = "UCF_U2GCKHvDz52jWdizppIA";
    p.document.querySelector('meta[itemprop="channelId"]').content = channel;
    const card = { id: "neutral", scope: channel, tokens: [{ type: "text", value: "White card" }] };
    await p.update({ cards: [card], decks: { [channel]: [card.id] }, channelMeta: {} });
    const badge = () => p.root.querySelector('[data-filter="channel"] .od-channel-mark');
    check(`${mode}: the panel uses the white default for both badge and card stripe`,
      p.root.style.getPropertyValue("--od-neutral") === "#FFFFFF" &&
      p.root.style.getPropertyValue("--od-scope-chroma") === "0" &&
      badge()?.style.getPropertyValue("--od-neutral") === "#FFFFFF");
    // White/black/grey all share a fallback hue. Changing only the HEX must
    // repaint the badge too, including the body-level save menu.
    await p.update({ channelMeta: { [channel]: { hue: 0, color: "#000000" } } });
    await p.update({ channelMeta: { [channel]: { hue: 0, color: "#808080" } } });
    check(`${mode}: changing only a neutral HEX repaints the badge`,
      badge().style.getPropertyValue("--od-neutral") === "#808080");
    const row = p.comment("neutral save target");
    p.point(row);
    row.querySelector(".od-grab-plus").click();
    check(`${mode}: the save popup keeps the channel's neutral outside the panel`,
      p.document.querySelector('.od-save-menu [data-scope="channel"] .od-channel-mark')
        .style.getPropertyValue("--od-neutral") === "#808080");
    p.document.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await p.update({ channelMeta: { [channel]: { hue: 120 } } });
    check(`${mode}: a saved chromatic hue removes the neutral default and styling`,
      !p.root.hasAttribute("data-neutral") && !p.root.style.getPropertyValue("--od-neutral") &&
      !p.root.style.getPropertyValue("--od-scope-chroma") && !badge().hasAttribute("data-neutral"));
  } catch (error) { check(`${mode}: ${error.stack}`, false); }
  finally { p.close(); }
}

process.exitCode = failures ? 1 : 0;
