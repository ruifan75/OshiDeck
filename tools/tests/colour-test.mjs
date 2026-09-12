// 推し色: which hue a channel gets, and how a picked colour becomes one.
//
// Only a hue is ever stored. The palette fixes lightness and chroma —
// oklch(0.74 0.19 H) — so every channel reads the same against a dark panel,
// and keeping a whole colour would let one land unreadable. So a colour picked
// from a swatch, a code or an eyedropper is asked one question: what hue.
globalThis.OshiDeck = {};
globalThis.chrome = { runtime: { id: "x" }, storage: { local: {
  get: async () => ({}), set: async () => {}
} } };

const src = process.env.OD_STORE || "/Users/maintainer/OshiDeck/src/store.js";
await import("/Users/maintainer/OshiDeck/src/tokens.js");
await import("/Users/maintainer/OshiDeck/src/backup.js");
await import(`file://${src}`);
const { store } = globalThis.OshiDeck;
const { hueFromHex, hexOfHue, defaultHue, OSHI_HUES, HUES } = store;

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };
const near = (a, b, slack = 2) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= slack;

/* ---------- a colour, asked for its hue ---------- */

// The OKLCH hue circle: red sits near 29°, green near 142°, blue near 264°.
check("red", near(hueFromHex("#ff0000"), 29));
check("green", near(hueFromHex("#00ff00"), 142));
check("blue", near(hueFromHex("#0000ff"), 264));
check("cyan", near(hueFromHex("#00ffff"), 195));

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
for (let hue = 0; hue < 360; hue++) {
  const back = hueFromHex(hexOfHue(hue));
  worst = Math.max(worst, Math.min(Math.abs(back - hue), 360 - Math.abs(back - hue)));
}
check(`every hue survives the round trip (worst ${worst}°)`, worst <= 2);

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

process.exit(fail);
