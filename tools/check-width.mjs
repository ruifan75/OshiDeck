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

// 400px of sidebar less the 12px of padding #oshideck-root keeps on each
// side. This is the one measurement; what a line of words gets is worked out
// from it below, rather than written down as a second number that goes stale
// the moment a control beside it changes.
const BAR = 376;
const SIZE = 11;        // .od-notice-text font-size
const GAP = 10;         // .od-notice gap
const PADDING = 16;     // button padding, both sides
const BOLD = 1.15;      // .od-notice-action is 700; the table is regular
const ICON = 12;        // .od-text-button svg
const ICONGAP = 4;      // .od-text-button gap
const BARGAP = 6;       // .od-bar gap

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

// What stands in a `$1` the call does not fill with a message of its own.
// `Sakura Miko` is a real channel name and about as long as they get; a
// longer one runs over in Japanese too, which is the channel's doing and not
// the wording's.
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

// What a line of words gets: the bar, less the controls that share it. The
// pool button is as wide as its count is allowed to grow, so the cap is read
// out of content.js rather than kept here as a second copy that can drift.
//
// Only BAR above is measured; this is the ruler doing what the ruler does.
// For a bar reading `Pool 24` and `Build` it comes to 238.2px, which is what
// a real Chromium reported for exactly that bar — width-test.mjs keeps the
// two agreeing, and if they ever stop, this arithmetic is what is wrong.
export function roomIn({ MESSAGES, source, report = () => {} }) {
  const cap = source.match(/\n  const MOST_SHOWN = (\d+);/)?.[1];
  if (!cap) {
    report("FAIL content.js の MOST_SHOWN が読めないので、バーの余りが分かりません");
    return null;
  }
  const control = (text) => {
    const w = text === undefined ? null : width(text, { report });
    return w === null ? null : w + PADDING + ICON + ICONGAP + BARGAP;
  };
  const pool = control(MESSAGES["pool.short"]?.en?.replace(/\$\d/, `${cap}+`));
  const build = control(MESSAGES["action.build"]?.en);
  if (pool === null || build === null) {
    report("FAIL バーのボタンが測れないので、残りの幅が出せません");
    return null;
  }
  return BAR - pool - build;
}

// Every key that reaches the bar's one line, read from the calls rather than
// listed here: a list goes stale the first time somebody adds a toast, and
// goes stale silently.
//
// Two doors into the same row. A notice takes it over for a few seconds; what
// the bar says when the deck is empty sits there for as long as the deck is
// empty, which is longer. Both are cut at the same place by the same CSS, so
// both are measured against the same room.
//
// The value is the `t(...)` that produced the key and the call it was shown
// from — the first because its arguments say what fills each `$1`, the second
// because a notice carrying a button has less room than one that does not.
export function noticeKeys(source) {
  const found = new Map();
  for (const call of notices(source)) {
    for (const [key, args] of shown(source, call)) {
      // The action's own label is a button, not the message.
      if (key.startsWith("action.")) continue;
      // Every call, not one per key. The map used to keep the first — and
      // `toast.saveFailedKept` is shown from two places with different
      // arguments, so the one handed a whole sentence to put in its `$1`
      // was never measured while the one handed a short word said it fit.
      if (!found.has(key)) found.set(key, []);
      found.get(key).push({ call, args });
    }
  }
  return found;
}

const notices = (source) => [...calls(source, "showToast"), ...calls(source, "barLine")];

// The calls whose message cannot be worked out at all. Before this they were
// simply skipped, and a sentence shown through a name — which is how every
// `saved.*` reaches the row — was never measured while the checker went on
// reporting that everything fits.
export function unreadable(source) {
  return notices(source).filter((call) => !shown(source, call).length);
}

// Which messages a call shows, as [key, the arguments after it]. A call is
// usually handed `t("…")` outright; `showToast(saved)` is handed a name, and
// the sentence it holds was chosen a few lines further up. One hop, by name,
// within the function the call is in — not dataflow, but it either finds the
// keys or it does not, and saying so is the part that was missing.
const shown = (source, call) => messagesIn(source, argumentsOf(call.text)[0] ?? "", call.at);

// The messages an expression will produce: the ones written into it, **and**
// the ones held by any bare name in it. Both, rather than the first that
// answers. `ok ? t("toast.deleted") : other` has one branch written out in
// full, and reading that as the answer left `other` — which can be wider —
// never looked at at all.
function messagesIn(source, expression, from = source.length) {
  const out = [...messages(expression)];
  for (const name of namesIn(expression)) out.push(...boundTo(source, name, from));
  return out;
}

const messages = (text) => calls(text, "t")
  .map((c) => argumentsOf(c.text))
  .map(([key, ...rest]) => [key?.trim().match(/^"([\w.]+)"$/)?.[1], rest])
  .filter(([key]) => key);

// The bare names in an expression — every `t(…)` call and every quoted string
// blanked out first, so that neither `t` itself nor a message key inside one
// is read as a name to go looking for.
const RESERVED = new Set(["true", "false", "null", "undefined", "typeof", "void", "new"]);
function namesIn(expression) {
  let rest = expression;
  for (const call of calls(expression, "t")) rest = rest.replace(call.text, " ");
  rest = rest.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, " ");
  return [...new Set(rest.match(/[A-Za-z_$][\w$]*/g) || [])].filter((name) => !RESERVED.has(name));
}

// Where the function holding an offset begins. Every function in content.js
// sits at one indent inside the file's IIFE, so the last line that opens one
// before the call is the one the call is in.
//
// A heuristic, and deliberately a narrow one. The whole file used to be
// searched, which is how an opaque `saved` parameter came to be answered by a
// `const saved` in a different function entirely: the checker then reported a
// sentence it had never seen as measured and fitting. Looking too far finds
// the wrong binding; looking too narrowly finds none, and finding none is a
// failure that says so.
function functionAt(source, from) {
  const opens = /^  (?:async function|function|const [\w$]+ = (?:async )?(?:function|\())/gm;
  let start = 0;
  for (const m of source.matchAll(opens)) {
    if (m.index >= from) break;
    start = m.index;
  }
  return start;
}

// What a bare name holds, in the two places a sentence is ever written down
// under it.
//
// A local, inside the function the call is in and above it: that is
// `const saved = ok ? t("saved.pool") : t("saved.global")`, three lines above
// the `showToast(saved)` that shows it.
//
// Or a property written under that name anywhere in the file, which is how a
// sentence reaches a parameter: `kept` is a parameter of saveTokens, and
// `kept: t("toast.inputKept")` in its caller is the only place that sentence
// is written out at all.
//
// The whole file used to be searched for either shape, and that is how an
// opaque parameter came to be answered by an unrelated `const` of the same
// name in another function — the checker then called a sentence it had never
// seen measured and fitting. A property is at least something handed over
// under this name; a const in a function the call is not in is not.
//
// Not dataflow: it does not check that the object carrying that property is
// the one this call's function was given. One hop, by name, and it either
// finds something or says it could not.
function boundTo(source, name, from) {
  const escaped = name.replace(/\$/g, "\\$");
  const out = [];
  const take = (pattern, start, end) => {
    const where = source.slice(start, end);
    for (const m of where.matchAll(pattern)) {
      out.push(...messages(valueAt(where, m.index + m[0].length)));
    }
  };
  take(new RegExp(`(?:^|[\\s{(,;])${escaped}\\s*[:=]\\s*`, "g"), functionAt(source, from), from);
  take(new RegExp(`[{,]\\s*${escaped}\\s*:\\s*`, "g"), 0, source.length);
  return out;
}

// From here to the end of what is being assigned: the first `;` or `,` — or
// the bracket that closes around it — that is not inside anything.
function valueAt(source, from) {
  let depth = 0, quote = "", i = from;
  for (; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) { if (!depth) break; depth -= 1; }
    else if ((c === ";" || c === ",") && !depth) break;
  }
  return source.slice(from, i);
}

// A call's arguments, split at the commas that are not inside anything else.
function argumentsOf(call) {
  const inner = call.slice(1, -1);
  const out = [];
  let depth = 0, quote = "", last = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if (c === "," && !depth) { out.push(inner.slice(last, i)); last = i + 1; }
  }
  out.push(inner.slice(last));
  return out;
}

// Each `name(...)` call as `{ text, at }`, parens balanced, quotes skipped.
// Where it is matters as well as what it says: a name handed to it is looked
// up in the function the call is in, and that cannot be found from the text.
//
// Where the function is declared is not a call — its parameter list holds no
// message, which read as a call nobody could identify.
function calls(source, name) {
  const out = [];
  const opener = new RegExp(`(^|[^\\w$.])${name}\\(`, "g");
  for (const m of source.matchAll(opener)) {
    if (/\bfunction\s*$/.test(source.slice(Math.max(0, m.index - 12), m.index + m[1].length))) continue;
    let depth = 0, quote = "", i = m.index + m[0].length - 1;  // at the `(`
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
    out.push({ text: source.slice(start, i + 1), at: start });
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

  const ROOM = roomIn({ MESSAGES, source, report });
  if (ROOM === null) return bad + 1;

  for (const call of unreadable(source)) {
    report(`FAIL どの文言が出るのか読み取れません: ${call.text.trim().replace(/\s+/g, " ").slice(0, 60)}`);
    bad += 1;
  }

  // The button the notice carries, so its width comes off the room. A label
  // the table cannot measure is a failure and not a free pass: reporting the
  // unknown character and then handing the notice the button's space as well
  // is the one outcome worse than either.
  const buttonRoom = (call) => {
    const label = call.text.match(/actionLabel:\s*t\(\s*"([\w.]+)"/)?.[1];
    if (!label) return ROOM;
    const text = MESSAGES[label]?.en;
    const w = text === undefined ? null : width(text, { report });
    if (w === null) {
      report(`FAIL ${label} — ボタンの幅が出せないので、文言に残る幅も出せません`);
      return null;
    }
    return ROOM - (w * BOLD + PADDING + GAP);
  };

  // What the call puts in a `$1`: the message it hands over, where it hands
  // one over. `toast.saveFailedKept` is given a whole sentence, and standing
  // a channel name in its place understated it by 90px.
  //
  // Null when one of the alternatives cannot be measured. `?? 0` was the
  // quiet answer: an unmeasurable sentence weighed nothing, lost the pick to
  // whichever of its siblings the table did know, and the unknown character
  // was never reported. Every alternative that can reach the bar has to be
  // measurable, because any of them can be the one that shows.
  const widest = (list) => {
    const measured = list.map((text) => [text, width(text, { report })]);
    if (measured.some(([, w]) => w === null)) return null;
    return measured.sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const fill = (args, slot, at) => {
    const inner = messagesIn(source, args[Number(slot) - 1] ?? "", at)
      .map(([key]) => MESSAGES[key]?.en)
      .filter(Boolean);
    const pick = widest(inner);
    if (pick === null) return null;
    return pick ?? (slot === "1" ? STAND_IN.name : STAND_IN.number);
  };

  // Every call of every key, not one call per key: the same sentence shown
  // from two places is two sentences to measure, and the wider argument was
  // the one being skipped.
  for (const [key, where] of [...keys].sort()) {
    const entry = MESSAGES[key];
    if (!entry?.en) { report(`FAIL ${key} — en がありません`); bad += 1; continue; }
    for (const { call, args } of where) bad += tooWide(key, entry.en, call, args);
  }

  function tooWide(key, en, call, args) {
    let unmeasurable = false;
    const text = en
      .replace(/\$(\d)\{([^{}|]*)\|([^{}|]*)\}/g, (_, n, one, many) => `${STAND_IN.number} ${many}`)
      .replace(/\$(\d)/g, (_, slot) => {
        const value = fill(args, slot, call.at);
        if (value === null) unmeasurable = true;
        return value ?? "";
      });
    if (unmeasurable) {
      report(`FAIL ${key} — $1 に入る文言の幅が出せないので、全体の幅も出せません`);
      return 1;
    }
    const w = width(text, { report });
    if (w === null) return 1;
    const room = buttonRoom(call);
    if (room === null) return 1;
    if (w > room) {
      report(`FAIL ${key} — ${w.toFixed(1)}px、入るのは ${room.toFixed(1)}px まで`);
      report(`     ${text}`);
      return 1;
    }
    return 0;
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
