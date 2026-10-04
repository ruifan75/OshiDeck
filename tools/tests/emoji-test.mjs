// Which emoji actually need a membership.
//
// An owner prefix is not the answer, and believing it was shipped a bug: a
// card carrying one of YouTube's free emoji packs — `:shelterin:`,
// `:chillwcat:`, `:face-red-heart-shape:` — was locked everywhere and
// forever, because those carry a channel prefix too. The prefix belongs to an
// ordinary viewer's account (`@user-hw7yz3fl2n`), not a creator's, which is
// also why looking it up in a list of 3765 VTuber channels found nothing.
//
// Measured in a 2-hour stream's chat export: of 24 custom emoji, 21 were the
// host's member emoji and every one of their shortcuts began with `_`; the
// three free ones had none, and were sent by people with no badge.
//
// The two places it is read do not agree, which is the trap:
//
//   live DOM    alt="ぺここ"  shared-tooltip-text=":_ぺここ:"
//   chat export shortcuts: [":_tadaima:"]
//
// `alt` is a display name. Reading it instead would have found no underscore
// on anything and unlocked every member emoji there is.
const src = process.env.OD_TOKENS || "/Users/maintainer/OshiDeck/src/tokens.js";

globalThis.OshiDeck = {};
globalThis.document = { createElement: () => ({ setAttribute() {}, appendChild() {} }) };
await import(`file://${src}`);
const { tokens } = globalThis.OshiDeck;

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

const SUU = "UCeqIMtLuGc3YgwkhEaG8oDg";
const VIEWER = "UCkszU2WH9gy1mb0dV-11UJg";   // the account YouTube's free packs sit under

const emoji = (owner, shortcut, alt = "") =>
  ({ type: "youtubeEmoji", emojiId: `${owner}/abc123`, alt, sharedTooltipText: shortcut });

/* ---------- what needs a membership ---------- */

check("a member emoji does", tokens.needsMembership(emoji(SUU, ":_tadaima:")));
check("one with a Japanese name still does", tokens.needsMembership(emoji(SUU, ":_ぺここ:", "ぺここ")));
check("a free pack emoji does not", !tokens.needsMembership(emoji(VIEWER, ":shelterin:")));
check("nor does one with hyphens", !tokens.needsMembership(emoji(VIEWER, ":face-red-heart-shape:")));

// An underscore has to be where YouTube puts it, not merely present.
check("an underscore in the middle is not the mark",
  !tokens.needsMembership(emoji(VIEWER, ":chill_w_cat:")));

/* ---------- and what that does to a card ---------- */

const needs = (list) => tokens.requiredChannels(list);

check("a card of member emoji names its channel",
  needs([emoji(SUU, ":_curry:")]).join() === SUU);

// The bug, in one line: this card was locked on every channel there is.
check("a card of free emoji names nobody", needs([emoji(VIEWER, ":shelterin:")]).length === 0);

check("and mixing them names only the one that matters",
  needs([emoji(SUU, ":_hai:"), emoji(VIEWER, ":chillwcat:")]).join() === SUU);

check("plain text needs nothing", needs([{ type: "text", value: "888" }]).length === 0);

/* ---------- a card from before any of this ---------- */

// Nothing collected the shortcut until now, so cards already saved have no
// answer to give. Reading silence as "free" would unlock a card that fails
// when pressed — the exact failure the locks exist to prevent — so silence
// keeps the answer the code gave before there was a way to ask.
check("a card saved before the shortcut was collected still asks for a membership",
  tokens.needsMembership({ type: "youtubeEmoji", emojiId: `${SUU}/abc` }));
check("and still names its channel", needs([{ type: "youtubeEmoji", emojiId: `${SUU}/abc` }]).join() === SUU);

/* ---------- and it has to survive the editor ---------- */

// A card is written into the chat input and read back out of it. If the
// shortcut is not written, the card that comes back has none — and a free
// emoji would turn into a member one on the round trip.
{
  const written = [];
  globalThis.document = {
    createElement: () => {
      const el = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, appendChild() {} };
      written.push(el);
      return el;
    },
    createTextNode: (value) => ({ value }),
    createDocumentFragment: () => ({ appendChild() {} })
  };
  tokens.toFragment([emoji(VIEWER, ":shelterin:")]);
  const img = written.find((el) => el.attrs["data-emoji-id"]);
  check("writing a card keeps the shortcut with it",
    img?.attrs["shared-tooltip-text"] === ":shelterin:");
}

/* ---------- what a standard emoji is ---------- */

// Not an emoji token at all. YouTube serves 👏 as an <img> with no
// data-emoji-id, so collectTokens keeps its alt as text — and a card built
// any other way writes `<img data-emoji-id="👏">` with nothing to load.
//
// This matters to the miner more than to the page: a chat export calls 👏 an
// emoji whose `emojiId` is the character, and carrying that across verbatim
// made the most-said card on every channel there is — applause — a row of
// broken images that matched nothing anybody had saved by hand.
{
  const img = (attrs) => ({
    nodeType: 1,
    tagName: "IMG",
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    hasAttribute: (name) => name in attrs,
    childNodes: [],
    querySelector: () => null
  });
  const message = (kids) => ({ nodeType: 1, tagName: "SPAN", childNodes: kids,
    hasAttribute: () => false, querySelector: () => null });

  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  // readEmojiToken asks `instanceof Element` before anything else.
  globalThis.Element = class {};
  const asElement = (o) => Object.assign(Object.create(Element.prototype), o);

  const read = tokens.collectTokens(asElement(message([
    asElement(img({ alt: "👏" })),                                 // standard
    asElement(img({ alt: "curry", "data-emoji-id": `${SUU}/abc`,
                    "shared-tooltip-text": ":_curry:" }))          // member
  ])));

  check("a standard emoji comes back as text", read[0]?.type === "text" && read[0].value === "👏");
  check("and a member emoji as an emoji", read[1]?.type === "youtubeEmoji");
  check("carrying its shortcut", read[1]?.sharedTooltipText === ":_curry:");
}

process.exit(fail);
