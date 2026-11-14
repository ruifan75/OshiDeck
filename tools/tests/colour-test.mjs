// Chromatic choices use the palette's hue; low-chroma choices keep their HEX.
globalThis.OshiDeck = {};
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => ({}), set: async () => {}
} } };

const src = process.env.OD_STORE
  ?? new URL("../../src/store.js", import.meta.url).pathname;
await import(new URL("../../src/tokens.js", import.meta.url).href);
await import(new URL("../../src/backup.js", import.meta.url).href);
await import(`file://${src}`);
const { store } = globalThis.OshiDeck;
const { hueFromHex, hexOfHue, defaultHue, OSHI_HUES, HUES } = store;
const { channelColor, neutralFromHex, OSHI_NEUTRALS } = store;

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };
const near = (a, b, slack = 2) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= slack;

/* ---------- a colour, asked for its hue ---------- */

// The OKLCH hue circle: red sits near 29°, green near 142°, blue near 264°.
check("red", near(hueFromHex("#ff0000"), 29));
check("green", near(hueFromHex("#00ff00"), 142));
check("blue", near(hueFromHex("#0000ff"), 264));
check("cyan", near(hueFromHex("#00ffff"), 195));
check("rounding across the hue origin wraps to zero", hueFromHex("#E5A1B5") === 0);

check("a leading # is optional", hueFromHex("ff0000") === hueFromHex("#ff0000"));
check("case does not matter", hueFromHex("#FF0000") === hueFromHex("#ff0000"));
check("something that is not a colour is not one", hueFromHex("blue") === null);
check("nor is a short code", hueFromHex("#f00") === null);
check("nor is nothing at all", hueFromHex("") === null);

// Grey has no hue to speak of; it has to pick something rather than an
// arbitrary angle out of the rounding noise.
check("grey lands somewhere definite", hueFromHex("#808080") === 0);
check("and so does white", hueFromHex("#ffffff") === 0);

/* ---------- and back, for the picker to open on ---------- */

// Clipping the channels of an out-of-gamut colour would shift the hue by up to
// nine degrees. The chroma comes down instead, so the hue — the part actually
// being chosen — survives the trip.
let worst = 0;
let canonical = true;
for (let hue = 0; hue < 360; hue++) {
  const back = hueFromHex(hexOfHue(hue));
  canonical &&= Number.isInteger(back) && back >= 0 && back < 360;
  worst = Math.max(worst, Math.min(Math.abs(back - hue), 360 - Math.abs(back - hue)));
}
check(`every hue survives the round trip (worst ${worst}°)`, worst <= 2);
check("every picker colour returns a canonical hue", canonical);

check("a hue becomes a six-digit code", /^#[0-9a-f]{6}$/.test(hexOfHue(320)));
check("and the eight presets all do", HUES.every((h) => /^#[0-9a-f]{6}$/.test(hexOfHue(h))));

/* ---------- which hue a channel starts with ---------- */

const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const B = "UCbbbbbbbbbbbbbbbbbbbbbb";

check("an unlisted channel gets one of the eight", HUES.includes(defaultHue(A)));
check("and the same one every time", defaultHue(A) === defaultHue(A));
check("different channels need not share", typeof defaultHue(B) === "number");

// This is how a channel is given the colour it is actually known by: one line
// in OSHI_HUES, consulted before the hash.
OSHI_HUES[A] = 12;
check("a listed channel gets the colour it is listed with", defaultHue(A) === 12);
check("and it need not be one of the eight", !HUES.includes(12));
check("while everyone else is unaffected", HUES.includes(defaultHue(B)));
delete OSHI_HUES[A];
check("removing the line puts it back", HUES.includes(defaultHue(A)));

// The source CSV contains both HSV-era columns and OKLCH-derived values.
// The selected HEX is the colour choice; the shipped angles must use the
// same conversion as the app's picker, not whichever old column was filled.
check("the bundled Hololive brand hue comes from its selected HEX",
  defaultHue("UCJFZiqLMntJufDCHc6bQixg") === hueFromHex("#17B6E1"));
check("Marine starts with the selected red hue",
  defaultHue("UCCzUftO8KOVkV4wQG1vkUvg") === hueFromHex("#BA2C2B"));
check("Nuhu starts with her selected pink hue",
  defaultHue("UCj63OWl-HQ-I6ORzUWF1EDg") === hueFromHex("#F1B9BC"));
check("MUZU starts with the approved blue from her channel artwork",
  defaultHue("UCBY1b_TPZx3rA0F1KJnXkNQ") === hueFromHex("#4A90C4"));
check("a catalogue hue of zero is a real colour",
  defaultHue("UC-ruxaqjQ5fP7q3UTWi4lWw") === 0);
const { readFileSync } = await import("node:fs");
const bundled = new Set(JSON.parse(readFileSync(new URL("../../presets/index.json", import.meta.url))).presets
  .map((entry) => entry.channel));
check("catalogue entries name bundled channels and valid OKLCH angles",
  Object.entries(OSHI_HUES).every(([id, hue]) => bundled.has(id) && Number.isInteger(hue) && hue >= 0 && hue < 360));
check("prototype names do not become catalogue colours",
  ["toString", "constructor", "__proto__"].every((id) => HUES.includes(defaultHue(id)) && channelColor(id) === null));

const WHITE = "UCF_U2GCKHvDz52jWdizppIA";
const BLACK = "UCLlJpxXt6L5d-XQ0cDdIyDQ";
const NONO = "UCVKWgVm8BSlMkGZIDGaoElw";
check("Nono's default colour is #F1F2F4",
  channelColor(NONO) === "#F1F2F4");
check("Nono's new default preserves a saved white or a custom hue",
  channelColor(NONO, { color: "#FFFFFF" }) === "#FFFFFF" && channelColor(NONO, { hue: 100 }) === null);
check("white and black starting colours remain white and black",
  channelColor(WHITE) === "#FFFFFF" && channelColor(BLACK) === "#000000" &&
  channelColor("UC--zuEfONeFXPvLqX0Kvbuw") === "#FFFFFF");
check("the neutral catalogue contains valid bundled colours",
  Object.entries(OSHI_NEUTRALS).every(([id, hex]) => bundled.has(id) && neutralFromHex(hex) === hex && !(id in OSHI_HUES)));
const sourceColours = JSON.parse(readFileSync(new URL("../data/channel-colours-v52.json", import.meta.url))).colours;
check("all 807 selected v52 colours preserve their complete HEX",
  sourceColours.length === 807 && Object.keys(store.OSHI_COLORS).length === 807 &&
  sourceColours.every(({ channel, hex }) => channelColor(channel) === hex));
const fullBrand = "UCJFZiqLMntJufDCHc6bQixg", originalBrandHex = store.OSHI_COLORS[fullBrand];
store.OSHI_COLORS[fullBrand] = "#00FF00";
check("the full HEX catalogue also takes priority for the hue control",
  defaultHue(fullBrand) === hueFromHex("#00FF00") && channelColor(fullBrand) === "#00FF00");
store.OSHI_COLORS[fullBrand] = originalBrandHex;
check("Suu keeps her selected near-black rather than an amplified purple hue",
  channelColor("UCeqIMtLuGc3YgwkhEaG8oDg") === "#27272A");
check("a saved custom hue still overrides the full HEX catalogue",
  channelColor("UCeqIMtLuGc3YgwkhEaG8oDg", { hue: 0 }) === null);
check("a saved chromatic HEX keeps its own lightness and saturation",
  channelColor("UCeqIMtLuGc3YgwkhEaG8oDg", { hue: 0, color: "#1234ab" }) === "#1234AB");
// Aibare's colour remains unresolved.
const uncoloured = ["UCjjIr39JMBz7RpgAa0XhqwA"];
check("every bundled channel has a catalogue colour or an explicit fallback",
  Object.keys(OSHI_HUES).length + Object.keys(OSHI_NEUTRALS).length === bundled.size - uncoloured.length &&
  uncoloured.every((id) => bundled.has(id) && !Object.hasOwn(OSHI_HUES, id) && !Object.hasOwn(OSHI_NEUTRALS, id) &&
    channelColor(id) === null && HUES.includes(defaultHue(id))));
check("an old selected hue of zero takes priority over the new neutral default",
  channelColor(WHITE, { hue: 0 }) === null);
check("a selected neutral overrides a chromatic starting colour",
  channelColor("UCCzUftO8KOVkV4wQG1vkUvg", { hue: 26, color: "#808080" }) === "#808080");
check("invalid stored colours never become CSS",
  ["red", "#fff", "var(--other)", {}, 0].every((color) => channelColor(A, { hue: 0, color }) === null));
check("native neutral selections preserve their lightness",
  ["#000000", "#808080", "#ffffff", "#DBE2E5"].every((hex) => neutralFromHex(hex) === hex.toUpperCase()));
check("native chromatic selections still use a hue",
  ["#ff0000", "#00ff00", "#0000ff", "var(--other)"].every((hex) => neutralFromHex(hex) === null));

let disk = { cards: [], decks: {}, channelMeta: {}, settings: {} };
chrome.storage.local.get = async () => structuredClone(disk);
chrome.storage.local.set = async (patch) => Object.assign(disk, structuredClone(patch));
const loaded = await store.runOp("loadPreset", { channelId: WHITE, name: "White channel", cards: [
  { id: "white-card", scope: WHITE, tokens: [{ type: "text", value: "White card" }] }
] });
check("loading a starting deck keeps its neutral colour after saving the name",
  loaded.ok && disk.channelMeta[WHITE]?.name === "White channel" &&
  channelColor(WHITE, disk.channelMeta[WHITE]) === "#FFFFFF");
await store.runOp("setChannel", { channelId: WHITE, name: "Renamed" });
check("renaming a channel preserves its neutral selection",
  disk.channelMeta[WHITE].name === "Renamed" && channelColor(WHITE, disk.channelMeta[WHITE]) === "#FFFFFF");
await store.runOp("setChannel", { channelId: WHITE, hue: 0 });
check("choosing a hue clears the old neutral even at zero",
  disk.channelMeta[WHITE].hue === 0 && !disk.channelMeta[WHITE].color && channelColor(WHITE, disk.channelMeta[WHITE]) === null);
await store.runOp("setChannel", { channelId: WHITE, hue: 0, color: "#000000" });
check("choosing black stores black rather than a red hue alone",
  disk.channelMeta[WHITE].color === "#000000" && channelColor(WHITE, disk.channelMeta[WHITE]) === "#000000");
const payload = OshiDeck.backup.toPayload(disk, "test");
disk = { cards: [], decks: {}, channelMeta: {}, settings: {} };
await store.runOp("importBackup", { raw: payload, mode: "replace" });
check("a backup round trip keeps a chosen neutral colour",
  channelColor(WHITE, disk.channelMeta[WHITE]) === "#000000");

await store.runOp("setChannel", { channelId: WHITE, hue: 270, color: "#1234ab" });
check("native chromatic HEX is stored intact", disk.channelMeta[WHITE].color === "#1234AB");
const hexBackup = OshiDeck.backup.toPayload(disk, "test");
disk = { cards: [], decks: {}, channelMeta: {}, settings: {} };
await store.runOp("importBackup", { raw: hexBackup, mode: "replace" });
check("backup import preserves the complete chromatic HEX", channelColor(WHITE, disk.channelMeta[WHITE]) === "#1234AB");
await store.runOp("setChannel", { channelId: WHITE, resetColor: true });
check("reset restores the current channel default without retaining a custom hue",
  !Object.hasOwn(disk.channelMeta[WHITE], "hue") && !Object.hasOwn(disk.channelMeta[WHITE], "color") &&
  channelColor(WHITE, disk.channelMeta[WHITE]) === "#FFFFFF" && disk.channelMeta[WHITE].name === "Renamed");

// Existing preferences, including zero, stay owned by the viewer.
const brand = "UCJFZiqLMntJufDCHc6bQixg";
chrome.storage.local.get = async () => ({ cards: [], decks: { [brand]: [] },
  channelMeta: { [brand]: { name: "Example", hue: 0 } }, settings: {} });
check("loading preserves an existing selected hue of zero",
  (await store.read()).channelMeta[brand].hue === 0);

process.exit(fail);
