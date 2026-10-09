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

  // But only there. `shared-tooltip-text` is YouTube's own attribute —
  // tp-yt-paper-tooltip is what reads it, which is why collectTokens already
  // skips that element — and the panel lives inside the live chat renderer.
  // A card face carrying one had YouTube float `:_ただいま:` over the chat on
  // hover: a native tooltip, in a UI that deliberately has none.
  written.length = 0;
  tokens.toFragment([emoji(SUU, ":_tadaima:")], { preview: true });
  const face = written.find((el) => el.attrs["data-emoji-id"]);
  check("but a card face hands YouTube nothing to pop up",
    face && !("shared-tooltip-text" in face.attrs));
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


/* ---------- what a card draws for a standard emoji ---------- */

// YouTube does not use the system font for 👏. Live chat replaces every
// standard emoji with Google's own picture, so a card that spells it in Apple
// Color Emoji — or in Segoe UI Emoji, which is what Windows would use — is a
// picture of a different message from the one it sends.
//
// The card only. The same tokens written into the chat editor stay
// characters, because there it is YouTube's own renderer that draws them, and
// an <img> put in their place has no emoji id for it to resolve.
{
  // One fragment's worth of children, with enough of a node to answer back.
  const scene = () => {
    const kids = [];
    globalThis.document = {
      createElement: () => ({
        attrs: {},
        on: {},
        setAttribute(key, value) { this.attrs[key] = value; },
        addEventListener(name, fn) { this.on[name] = fn; },
        replaceWith(node) { kids.splice(kids.indexOf(this), 1, node); },
        set className(value) { this.attrs.class = value; },
        appendChild() {}
      }),
      createTextNode: (value) => ({ text: value }),
      createDocumentFragment: () => ({ appendChild(node) { kids.push(node); } })
    };
    return kids;
  };

  const text = (value) => [{ type: "text", value }];
  const face = (list) => { const kids = scene(); tokens.toFragment(list, { preview: true }); return kids; };
  const typed = (list) => { const kids = scene(); tokens.toFragment(list); return kids; };
  const picture = (node) => node?.attrs?.src || "";
  const NOTO = "https://fonts.gstatic.com/s/e/notoemoji/15.1";

  check("a card draws a standard emoji as the picture the chat is showing",
    picture(face(text("👏"))[0]) === `${NOTO}/1f44f/72.png`);

  check("and the chat editor is still given the characters",
    typed(text("👏"))[0]?.text === "👏");

  // One picture per emoji, not per code point. 👏🏻 is a hand and a skin
  // tone; 👨‍👩‍👧 is three people and two joiners. Splitting by code point
  // asks for five files that do not exist and draws a family as a crowd.
  check("a skin tone belongs to the hand in front of it",
    face(text("👏🏻")).length === 1 &&
    picture(face(text("👏🏻"))[0]) === `${NOTO}/1f44f_1f3fb/72.png`);
  check("and a joined family is one drawing",
    face(text("👨‍👩‍👧")).length === 1 &&
    picture(face(text("👨‍👩‍👧"))[0]) === `${NOTO}/1f468_200d_1f469_200d_1f467/72.png`);

  // Neither of these is Extended_Pictographic — underneath, a flag is two
  // letters and a keycap is a digit — so the obvious test for "is this an
  // emoji" leaves both of them as text.
  check("a flag is a picture even though its letters are not",
    picture(face(text("🇯🇵"))[0]) === `${NOTO}/1f1ef_1f1f5/72.png`);
  check("and so is a keycap",
    picture(face(text("1️⃣"))[0]) === `${NOTO}/0031_20e3/72.png`);

  // `31_20e3` is not a file. Code points below 0x1000 are padded to four,
  // and the only emoji that contain one are the keycaps.
  check("a short code point is padded to four digits",
    !picture(face(text("1️⃣"))[0]).includes("/31_"));

  // YouTube drops the variation selector from its own emoji ids. Keeping it
  // asks for `1f44f_fe0f`, which 404s — whereas `2764_fe0f` exists, so half
  // the cards would have worked and the bug would have looked like luck.
  check("the variation selector is dropped",
    picture(face(text("❤️"))[0]) === `${NOTO}/2764/72.png`);

  // The words a card is mostly made of are still words.
  {
    const kids = face(text("おつ👏です"));
    check("words either side of a picture stay words",
      kids.length === 3 && kids[0].text === "おつ" && kids[2].text === "です");
    check("and nothing is a picture when there is no emoji",
      face(text("わこつ")).length === 1 && face(text("わこつ"))[0].text === "わこつ");
  }

  // data-emoji-id is how this file tells a member emoji from anything else:
  // collectTokens reads it to build a token and harvestEmoji reads it to
  // refresh a url. A standard emoji belongs to nobody and must carry none,
  // or 👏 becomes an emoji somebody has to pay for.
  check("a standard picture claims no owner",
    !("data-emoji-id" in face(text("👏"))[0].attrs));
  check("while a member emoji still names one",
    face([emoji(SUU, ":_curry:")])[0].attrs["data-emoji-id"] === `${SUU}/abc123`);

  // ™ and ♻ segment as emoji and have no file. The card showed the
  // character before any of this and has to go on showing it.
  {
    const kids = face(text("♻"));
    kids[0].on.error();
    check("an emoji with no picture falls back to the character",
      kids[0].text === "♻");
  }
}

process.exit(fail);
