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
const STAND_IN = { name: "Sakura Miko", number: "24", unreadable: Symbol("unreadable") };

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
// listed here. The source has had its comments taken out already — checkWidth
// does that, once, where the file is read: a list goes stale the first time somebody adds a toast, and
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
    for (const [key, args] of shown(source, call) || []) {
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
  return notices(source).filter((call) => !shown(source, call)?.length);
}

// Which messages a call shows, as [key, the arguments after it] — or null
// when the call cannot be read at all.
const shown = (source, call) => messagesIn(source, argumentsOf(call.text)[0] ?? "");

// The values an expression can produce, as text — or null when this cannot
// say. A closed grammar, and deliberately a small one: a `t(…)` call, a bare
// name, or a choice between those. A template, a call to something else, a
// property, a string built up by hand — none of those are read, they are
// refused.
//
// Reading part of an expression and calling it understood is the whole of
// what kept going wrong here. `ok ? t("toast.deleted") : other` has one
// branch written out in full; finding that branch and stopping left `other`,
// which could be the wider of the two, never looked at — while the checker
// reported that everything fits. The question is not "did I find a message",
// it is "have I accounted for everything this can produce".
function alternatives(expression) {
  const text = expression.trim();
  if (!text) return null;

  // A branch written inside brackets of its own is that branch. Without this
  // the whole of `(a ? t("x") : t("y"))` sits at depth 1 and reads as one
  // value nobody can identify.
  if (text.startsWith("(") && openerOf(text, closerOf(text, 0)) === 0 &&
      closerOf(text, 0) === text.length - 1) {
    return alternatives(text.slice(1, -1));
  }

  const ask = splitAt(text, "?");
  if (ask >= 0) {
    const colon = matchingColon(text, ask + 1);
    if (colon < 0) return null;
    // The condition is not one of the values; the two branches are.
    return both(alternatives(text.slice(ask + 1, colon)), alternatives(text.slice(colon + 1)));
  }

  for (const op of ["||", "??"]) {
    const or = splitAt(text, op);
    if (or >= 0) {
      return both(alternatives(text.slice(0, or)), alternatives(text.slice(or + op.length)));
    }
  }

  return [text];
}

const both = (left, right) => (left === null || right === null ? null : [...left, ...right]);

// The first `op` that is not inside brackets, quotes or a template. `?.` and
// `??` are not the conditional, and `?` is looked for before `??` is, so the
// second character has to be checked here.
function splitAt(text, op) {
  let depth = 0, quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if ("([{".includes(c)) { depth += 1; continue; }
    if (")]}".includes(c)) { depth -= 1; continue; }
    if (depth) continue;
    if (op === "?" && c === "?" && (text[i + 1] === "?" || text[i + 1] === ".")) { i += 1; continue; }
    if (text.startsWith(op, i)) return i;
  }
  return -1;
}

// The `:` that closes the `?` this started from, counting the pairs between.
function matchingColon(text, from) {
  let depth = 0, nested = 0, quote = "";
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if ("([{".includes(c)) { depth += 1; continue; }
    if (")]}".includes(c)) { depth -= 1; continue; }
    if (depth) continue;
    if (c === "?") { if (text[i + 1] === "?" || text[i + 1] === ".") i += 1; else nested += 1; continue; }
    if (c === ":") { if (!nested) return i; nested -= 1; }
  }
  return -1;
}

// The messages an expression will produce — every one of them, or null if any
// part of it cannot be accounted for.
function messagesIn(source, expression, seen = new Set()) {
  const parts = alternatives(expression);
  if (parts === null) return null;

  const out = [];
  for (const part of parts) {
    // A `t(…)` call, and the whole of this value rather than something with a
    // call in it: `` `${t("x")} ok` `` is a string this cannot measure.
    // `at` is where the bracket is, so the name is what stands before it.
    const call = calls(part, "t")[0];
    if (call && part.slice(0, call.at).trim() === "t" &&
        call.at + call.text.length === part.length) {
      out.push(...messages(part));
      continue;
    }
    const name = part.match(/^[A-Za-z_$][\w$]*$/)?.[0];
    const held = name && !seen.has(name) ? boundTo(source, name, new Set([...seen, name])) : null;
    if (held === null) return null;
    out.push(...held);
  }
  return out;
}

const messages = (text) => calls(text, "t")
  .map((c) => argumentsOf(c.text))
  .map(([key, ...rest]) => [key?.trim().match(/^"([\w.]+)"$/)?.[1], rest])
  .filter(([key]) => key);

// What a name holds — and only where the file leaves no room to wonder.
//
// Not "is this name a parameter", which is the question the last three
// readings tried to answer. Answering it means listing the shapes a
// parameter comes in, and a list of shapes is never finished: `function
// f(x)`, `(x) =>` and `x =>` were listed, and an object method `go(x) {}`, a
// class method, a `catch (x)` and a `for (const x of …)` all walked straight
// past and were answered with somebody else's sentence.
//
// So this counts instead of listing. Every mention of the name in the file
// has to be one already read: its single `const`, and uses sitting inside the
// calls being read. One mention anywhere else — a parameter list of any
// shape, a property key, a use this file knows nothing about — and the name
// is refused. There is no list to be missing an entry from.
function boundTo(source, name, seen) {
  const escaped = name.replace(/\$/g, "\\$");

  const declared = [...source.matchAll(new RegExp(`\\bconst\\s+${escaped}\\s*=\\s*`, "g"))];
  if (!declared.length) return null;

  const spans = readable(source);
  const inside = (at) => spans.some(([from, to]) => at >= from && at < to);
  const itself = declared[0].index + declared[0][0].indexOf(name);

  for (const m of source.matchAll(new RegExp(`\\b${escaped}\\b`, "g"))) {
    if (m.index !== itself && !inside(m.index)) return null;
  }

  return messagesIn(source, valueAt(source, declared[0].index + declared[0][0].length), seen);
}

// Where a name may stand and still have been read: inside the brackets of a
// `t(…)`, or of one of the calls whose message is being worked out.
function readable(source) {
  const spans = [];
  for (const name of ["t", "showToast", "barLine"]) {
    for (const call of calls(source, name)) spans.push([call.at, call.at + call.text.length]);
  }
  return spans;
}

// The `)` that closes the `(` at `open`, and the `(` that a `)` closes.
function closerOf(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

function openerOf(source, close) {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (source[i] === ")") depth += 1;
    else if (source[i] === "(" && --depth === 0) return i;
  }
  return -1;
}

// Comments blanked, one space per character so that every offset above still
// points where it did. A commented-out `showToast(t("…"))` is not a notice,
// and a name mentioned in prose is not a use of it.
function withoutComments(source) {
  // Split into UTF-16 units, not code points: every offset above is a string
  // index, and one astral character would slide the whole file by one.
  const out = source.split("");
  let quote = "", comment = "";
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (comment) {
      const ends = comment === "//" ? c === "\n" : c === "*" && next === "/";
      if (comment === "/*") { out[i] = c === "\n" ? c : " "; if (ends) out[i + 1] = " "; }
      if (ends) { if (comment === "/*") i += 1; comment = ""; }
      else if (comment === "//") out[i] = " ";
      continue;
    }
    if (quote) {
      if (c === "\\") { i += 1; continue; }
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "/" && (next === "/" || next === "*")) {
      comment = c + next;
      out[i] = " ";
      out[i + 1] = " ";
      i += 1;
    }
  }
  return out.join("");
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
  const source = withoutComments(read("content.js"));
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
  const bare = /^[A-Za-z_$][\w$]*$/;
  const fill = (args, slot) => {
    const text = args[Number(slot) - 1] ?? "";
    const held = messagesIn(source, text);
    // A name is how a sentence is handed around in this file, so one that
    // cannot be read may well be holding one: standing a channel name in its
    // place understated `toast.saveFailedKept` by 90px. Anything else refused
    // — a property, a count, a call to something else — is a value, and a
    // value is what the stand-in was always for.
    if (held === null) {
      const parts = alternatives(text) || [];
      if (parts.some((part) => bare.test(part.trim()))) return STAND_IN.unreadable;
      return slot === "1" ? STAND_IN.name : STAND_IN.number;
    }
    const inner = held.map(([key]) => MESSAGES[key]?.en).filter(Boolean);
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
        const value = fill(args, slot);
        if (value === null || value === STAND_IN.unreadable) { unmeasurable = true; return ""; }
        return value;
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
