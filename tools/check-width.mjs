// Does the English fit the bar?
//
// `.od-notice-text` and `.od-bar-line` are both `white-space: nowrap` with
// `text-overflow: ellipsis`, so a line that runs long is not wrapped — it is
// cut, mid-sentence, with no sign of what it was going to say. Japanese says
// most of these in a dozen characters and never came close; English took five
// of them past the end, and nobody saw it, because seeing it means opening a
// 400px sidebar on a live stream.
//
// So it is measured here instead. The widths are Helvetica/Arial advances in
// units of 1/1000 em — the font the bar actually gets, since `Roboto` is
// first in the stack and is not installed on macOS, and Arial carries
// Helvetica's metrics. Against the five widths a real Chromium reported for
// the real CSS at 400px, this table is within 0.1px on every one.
//
// Where the room comes from: 238.2px, measured in that same Chromium with the
// busiest bar — the pool tab reading `Pool 24` and the `Build` button beside
// it. A notice that carries a button has the button's width taken off as
// well. Both numbers are observations, not derivations; the layout is CSS and
// CSS is not re-implemented here.
//
// Only English is measured. The table has no CJK advances and will not guess
// at one: an unknown character is a failure, not a default.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const ROOM = 238.2;
const SIZE = 11;        // .od-notice-text font-size
const GAP = 10;         // .od-notice gap
const PADDING = 16;     // .od-notice-action padding, both sides
const BOLD = 1.15;      // .od-notice-action is 700; the table is regular

const ADVANCE = new Map();
const put = (chars, width) => { for (const c of chars) ADVANCE.set(c, width); };
put(" ", 278); put("!", 278); put('"', 355); put("#", 556); put("$", 556);
put("%", 889); put("&", 667); put("'", 191); put("(", 333); put(")", 333);
put("*", 389); put("+", 584); put(",", 278); put("-", 333); put(".", 278);
put("/", 278); put("0123456789", 556); put(":", 278); put(";", 278);
put("<", 584); put("=", 584); put(">", 584); put("?", 556); put("@", 1015);
put("A", 667); put("B", 667); put("C", 722); put("D", 722); put("E", 667);
put("F", 611); put("G", 778); put("H", 722); put("I", 278); put("J", 500);
put("K", 667); put("L", 556); put("M", 833); put("N", 722); put("O", 778);
put("P", 667); put("Q", 778); put("R", 722); put("S", 667); put("T", 611);
put("U", 722); put("V", 667); put("W", 944); put("X", 667); put("Y", 667);
put("Z", 611); put("[", 278); put("\\", 278); put("]", 278); put("^", 469);
put("_", 556); put("`", 333);
put("a", 556); put("b", 556); put("c", 500); put("d", 556); put("e", 556);
put("f", 278); put("g", 556); put("h", 556); put("i", 222); put("j", 222);
put("k", 500); put("l", 222); put("m", 833); put("n", 556); put("o", 556);
put("p", 556); put("q", 556); put("r", 333); put("s", 500); put("t", 278);
put("u", 556); put("v", 500); put("w", 722); put("x", 500); put("y", 500);
put("z", 500); put("{", 334); put("|", 260); put("}", 334); put("~", 584);
put("“”", 333); put("‘’", 222); put("—", 1000);
put("–", 556); put("…", 1000);

// A name stands in for every `$1` that holds one, because the bar is as wide
// as the longest thing it is asked to say. `Sakura Miko` is a real one and
// about as long as they get; a longer name runs over in Japanese too, which
// is the channel's doing and not the wording's.
const STAND_IN = { name: "Sakura Miko", number: "24" };

export function width(text, { report } = {}) {
  let units = 0;
  for (const c of text) {
    const advance = ADVANCE.get(c);
    if (advance === undefined) {
      report?.(`FAIL 幅の分からない文字 ${JSON.stringify(c)}: ${text}`);
      return null;
    }
    units += advance;
  }
  return units * SIZE / 1000;
}

// Every key that reaches the bar's one line, read from the calls rather than
// listed here: a list goes stale the first time somebody adds a toast, and
// goes stale silently.
//
// Two doors into the same row. A notice takes it over for a few seconds; what
// the bar says when the deck is empty sits there for as long as the deck is
// empty, which is longer. Both are cut at the same place by the same CSS, so
// both are measured against the same room.
export function noticeKeys(source) {
  const found = new Map();
  for (const call of [...calls(source, "showToast"), ...calls(source, "barLine")]) {
    const withButton = /\bactionLabel\s*:/.test(call);
    for (const [, key] of call.matchAll(/\bt\(\s*"([\w.]+)"/g)) {
      // The action's own label is a button, not the message.
      if (key.startsWith("action.")) continue;
      // The same message can be shown both ways; the one with a button has
      // less room, so that is the one it has to fit.
      if (!found.has(key) || withButton) found.set(key, call);
    }
  }
  return found;
}

// The text of each `name(...)` call, parens balanced, quotes skipped.
function calls(source, name) {
  const out = [];
  const opener = new RegExp(`\\b${name}\\(`, "g");
  for (const m of source.matchAll(opener)) {
    let depth = 0, quote = "", i = m.index + m[0].length - 1;
    const start = i;
    for (; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (c === "\\") i += 1;
        else if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "(") depth += 1;
      else if (c === ")" && --depth === 0) break;
    }
    out.push(source.slice(start, i + 1));
  }
  return out;
}

export function checkWidth({ MESSAGES, read, report = console.log }) {
  let bad = 0;
  const source = read("content.js");
  const keys = noticeKeys(source);
  if (!keys.size) {
    report("FAIL バーに出る文言の呼び出しが読み取れませんでした");
    return 1;
  }

  // The button the notice carries, so its width comes off the room.
  const buttonRoom = (call) => {
    const label = call.match(/actionLabel:\s*t\(\s*"([\w.]+)"/)?.[1];
    const text = label && MESSAGES[label]?.en;
    if (!text) return ROOM;
    const w = width(text, { report });
    return w === null ? ROOM : ROOM - (w * BOLD + PADDING + GAP);
  };

  for (const [key, call] of [...keys].sort()) {
    const entry = MESSAGES[key];
    if (!entry?.en) { report(`FAIL ${key} — en がありません`); bad += 1; continue; }
    const text = entry.en
      .replace(/\$(\d)\{([^{}|]*)\|([^{}|]*)\}/g, (_, n, one, many) => `${STAND_IN.number} ${many}`)
      .replace(/\$\d/g, (slot) => (/\$1/.test(slot) ? STAND_IN.name : STAND_IN.number));
    const w = width(text, { report });
    if (w === null) { bad += 1; continue; }
    const room = buttonRoom(call);
    if (w > room) {
      bad += 1;
      report(`FAIL ${key} — ${w.toFixed(1)}px、入るのは ${room.toFixed(1)}px まで`);
      report(`     ${text}`);
    }
  }

  if (!bad) report(`ok   ${keys.size}件の文言、400pxのバーに収まります`);
  return bad;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  globalThis.OshiDeck = {};
  await import(new URL("../src/i18n.js", import.meta.url));
  process.exitCode = checkWidth({
    MESSAGES: globalThis.OshiDeck.i18n.MESSAGES,
    read: (file) => readFileSync(root + file, "utf8")
  });
}
