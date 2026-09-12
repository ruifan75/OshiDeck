// Deleting a card that other decks are holding.
//
// Deleting from the pool empties every deck at once, so it asks first. The
// asking went wrong twice over: the question was written to the status line at
// the foot of the options page, nowhere near the card, and pressing the same ×
// again counted as answering it — so a second press deleted a card on the
// strength of a warning nobody had seen.
import { readFileSync } from "node:fs";

const source = process.env.OD_OPTIONS
  ? new URL(`file://${process.env.OD_OPTIONS}`)
  : new URL("../../options.js", import.meta.url);
const src = readFileSync(source, "utf8");

const from = src.indexOf("async function removeCard(card, el) {");
const to = src.indexOf("async function deleteCardNow(card) {", from);
if (from < 0 || to < 0 || to <= from) {
  console.log("FAIL could not lift removeCard out of options.js");
  process.exit(1);
}

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const B = "UCbbbbbbbbbbbbbbbbbbbbbb";

// One pool card, and whichever decks are said to hold it.
function pool({ holders = [], selected = A } = {}) {
  const seen = { deleted: 0, asked: 0, heldWhenAsked: null };
  const el = { dataset: {} };

  const removeCard = new Function(
    "store", "decks", "selected", "deleteCardNow", "askOnCard",
    `${src.slice(from, to)} return removeCard;`
  )(
    { decksHolding: () => holders },
    {},
    selected,
    async () => { seen.deleted += 1; },
    (_el, _card, held) => {
      seen.asked += 1;
      seen.heldWhenAsked = held;
      _el.dataset.confirming = "true"; // what askOnCard does before it draws
    }
  );

  return { seen, el, press: () => removeCard({ id: "card" }, el) };
}

/* ---------- nothing else holds it ---------- */

let p = pool({ holders: [] });
await p.press();
check("a card no other deck holds goes straight away", p.seen.deleted === 1 && p.seen.asked === 0);

// The selected deck does not count: it is the one being looked at.
p = pool({ holders: [A], selected: A });
await p.press();
check("nor does the deck being looked at count as another", p.seen.deleted === 1 && p.seen.asked === 0);

/* ---------- another deck holds it ---------- */

p = pool({ holders: [A, B], selected: A });
await p.press();
check("a card another deck holds asks first", p.seen.asked === 1);
check("and does not delete yet", p.seen.deleted === 0);
check("naming only the other decks", JSON.stringify(p.seen.heldWhenAsked) === JSON.stringify([B]));

// The press that mattered: the same × again.
await p.press();
check("pressing the same button again does not delete", p.seen.deleted === 0);
check("and does not stack a second question", p.seen.asked === 1);

/* ---------- after cancelling ---------- */

delete p.el.dataset.confirming; // what やめる does
await p.press();
check("once cancelled, pressing × asks again", p.seen.asked === 2);
check("still without deleting", p.seen.deleted === 0);

process.exit(fail);
