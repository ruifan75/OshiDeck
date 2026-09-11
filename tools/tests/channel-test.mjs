// Which channel the page belongs to, driven against fixed DOM shapes.
//
// This is the code that has been wrong the most often, and every time the
// reason was the same: something that was *present* was read as something that
// was *true*. A link that matched first in document order was read as the
// owner; an element still in the DOM was read as usable; a page mid-navigation
// was read as the page it was becoming. Each case below is one of those.
//
// The functions are lifted out of content.js rather than copied, so a change
// there is tested here. The DOM is a stub — enough of querySelector to carry
// these fixtures, and deliberately pre-order so that "first in document order"
// means here what it means in a browser.
import { readFileSync } from "node:fs";

/* ---------- a very small DOM ---------- */

const ATTR = /\[([\w-]+)(?:([~^$*|]?=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;

function parseSimple(text) {
  const attrs = [];
  let rest = text.replace(ATTR, (_, name, op, dq, sq, bare) => {
    attrs.push({ name, op: op || null, value: dq ?? sq ?? bare ?? null });
    return "";
  });
  const id = /#([\w-]+)/.exec(rest)?.[1] || null;
  rest = rest.replace(/#[\w-]+/, "");
  return { tag: rest.trim().toLowerCase() || null, id, attrs };
}

const parseSelector = (selector) =>
  selector.split(",").map((part) => part.trim().split(/\s+/).map(parseSimple));

class El {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag.toLowerCase();
    this.attrs = attrs;
    this.text = attrs.text || "";
    delete this.attrs.text;
    this.children = children;
    this.parent = null;
    for (const child of children) child.parent = this;
  }

  get tagName() { return this.tag.toUpperCase(); }
  get id() { return this.attrs.id || ""; }
  get content() { return this.getAttribute("content"); }

  getAttribute(name) { return name in this.attrs ? String(this.attrs[name]) : null; }
  hasAttribute(name) { return name in this.attrs; }

  get textContent() {
    return this.text + this.children.map((c) => c.textContent).join("");
  }

  matchesSimple(simple) {
    if (simple.tag && simple.tag !== this.tag) return false;
    if (simple.id && simple.id !== this.id) return false;
    for (const { name, op, value } of simple.attrs) {
      const have = this.getAttribute(name);
      if (have === null) return false;
      if (op === "=" && have !== value) return false;
      if (op === "^=" && !have.startsWith(value)) return false;
      if (op === "$=" && !have.endsWith(value)) return false;
      if (op === "*=" && !have.includes(value)) return false;
    }
    return true;
  }

  // Pre-order: the same order a browser calls document order.
  *walk() {
    for (const child of this.children) {
      yield child;
      yield* child.walk();
    }
  }

  matchesChain(chain) {
    if (!this.matchesSimple(chain[chain.length - 1])) return false;
    let node = this.parent;
    let i = chain.length - 2;
    while (i >= 0) {
      if (!node) return false;
      if (node.matchesSimple(chain[i])) i -= 1;
      node = node.parent;
    }
    return true;
  }

  querySelectorAll(selector) {
    const chains = parseSelector(selector);
    return [...this.walk()].filter((el) => chains.some((chain) => el.matchesChain(chain)));
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  closest(selector) {
    const chains = parseSelector(selector);
    for (let node = this; node; node = node.parent) {
      if (chains.some((chain) => node.matchesChain(chain))) return node;
    }
    return null;
  }
}

const doc = (children, search = "") => {
  const root = new El("html", {}, children);
  root.defaultView = { location: { search } };
  return root;
};

const el = (tag, attrs, children) => new El(tag, attrs || {}, children || []);
const a = (href, text) => el("a", { href, text });

/* ---------- the code under test, lifted from content.js ---------- */

const src = readFileSync(new URL("../../content.js", import.meta.url), "utf8");
const from = src.indexOf("  const CHANNEL_ID = ");
const to = src.indexOf("  // The live chat runs in a same-origin iframe");
if (from < 0 || to < 0 || to <= from) {
  console.log("FAIL could not lift the channel block out of content.js");
  process.exit(1);
}

const { readChannel, handleOf } = new Function(
  `${src.slice(from, to)}; return { readChannel, handleOf };`
)();

/* ---------- fixtures ---------- */

const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const B = "UCbbbbbbbbbbbbbbbbbbbbbb";

const ownerBlock = (handle, name, extra = []) =>
  el("ytd-video-owner-renderer", {}, [
    el("ytd-channel-name", { id: "channel-name" }, [el("yt-formatted-string", { id: "text", text: name })]),
    ...(handle ? [a(handle, "")] : []),
    ...extra
  ]);

const infocard = (handle, id, title) =>
  el("ytd-video-description-infocards-section-renderer", {}, [
    el("div", { id: "title", text: title }),
    ...(handle ? [a(handle, "")] : []),
    a(`/channel/${id}/videos`, "動画")
  ]);

// Real video ids are 11 characters, and the player-response guard checks it.
const flexy = (videoId, children) => el("ytd-watch-flexy", { "video-id": videoId }, children);

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

/* ---------- the page is still the one we left ---------- */

const midNavigation = doc([
  flexy("aaaaaaaaaaa", [ownerBlock("/@a", "Channel A"), infocard("/@a", A, "Channel A")])
], "?v=bbbbbbbbbbb");

check(
  "a page still showing the previous video answers nothing",
  readChannel(midNavigation) === null
);

const settled = doc([
  flexy("bbbbbbbbbbb", [ownerBlock("/@b", "Channel B"), infocard("/@b", B, "Channel B")])
], "?v=bbbbbbbbbbb");

check(
  "and answers again once the page catches up",
  readChannel(settled)?.id === B
);

/* ---------- info cards are only the owner's ---------- */

const mismatched = doc([
  flexy("bbbbbbbbbbb", [ownerBlock("/@b", "Channel B"), infocard("/@a", A, "Channel A")])
], "?v=bbbbbbbbbbb");

check(
  "a known handle matching no card rejects the cards",
  readChannel(mismatched) === null
);

const collaboration = doc([
  flexy("bbbbbbbbbbb", [ownerBlock(null, "A and 2 others"), infocard(null, A, "Channel A"), infocard(null, A, "Channel A")])
], "?v=bbbbbbbbbbb");

check(
  "with no handle at all, cards that agree are believed",
  readChannel(collaboration)?.id === A
);

check(
  "and the card's own title is the name, not the owner row's summary",
  readChannel(collaboration)?.name === "Channel A"
);

const disagreeing = doc([
  flexy("bbbbbbbbbbb", [ownerBlock(null, "someone"), infocard(null, A, "Channel A"), infocard(null, B, "Channel B")])
], "?v=bbbbbbbbbbb");

check(
  "cards that disagree are refused rather than guessed between",
  readChannel(disagreeing) === null
);

/* ---------- handles outside ASCII ---------- */

check("a handle keeps its non-ASCII name", handleOf("/@さくら") === "/@さくら");
check("percent-escapes are undone", handleOf("/@%E3%81%95%E3%81%8F%E3%82%89") === "/@さくら");
check("query and fragment are dropped", handleOf("/@name?si=x") === "/@name");
check("a malformed escape is compared as written", handleOf("/@100%") === "/@100%");
check("something that is not a handle is not one", handleOf("/channel/UC") === null);

const japanese = doc([
  flexy("bbbbbbbbbbb", [ownerBlock("/@さくら", "さくら"), infocard("/@%E3%81%95%E3%81%8F%E3%82%89", A, "さくら")])
], "?v=bbbbbbbbbbb");

check(
  "an encoded card handle still matches the plain owner handle",
  readChannel(japanese)?.id === A
);

/* ---------- first in document order is not the owner ---------- */

const decoyFirst = doc([
  el("div", { id: "owner" }, []),                       // empty, and earlier
  flexy("bbbbbbbbbbb", [ownerBlock("/@b", "Channel B"), infocard("/@b", B, "Channel B")])
], "?v=bbbbbbbbbbb");

check(
  "an empty #owner earlier in the document does not win",
  readChannel(decoyFirst)?.id === B
);

/* ---------- a button is not a name ---------- */

const member = doc([
  flexy("bbbbbbbbbbb", [
    ownerBlock("/@b", "Channel B", [
      el("div", { id: "sponsor-button" }, [
        el("ytd-button-renderer", {}, [a(`/channel/${B}/join`, "メンバー特典")])
      ])
    ]),
    infocard("/@b", B, "Channel B")
  ])
], "?v=bbbbbbbbbbb");

const seen = readChannel(member);
check("the membership button still gives the right id", seen?.id === B);
check("but never the name", seen?.name === "Channel B");

/* ---------- the leftover player response ---------- */

const staleScript = doc([
  flexy("bbbbbbbbbbb", [ownerBlock(null, "")]),
  el("script", { text: `var ytInitialPlayerResponse = {"videoId":"aaaaaaaaaaa","channelId":"${A}"}` })
], "?v=bbbbbbbbbbb");

check(
  "a player response describing another video is not used",
  readChannel(staleScript) === null
);

const freshScript = doc([
  flexy("bbbbbbbbbbb", [ownerBlock(null, "")]),
  el("script", { text: `var ytInitialPlayerResponse = {"videoId":"bbbbbbbbbbb","channelId":"${B}","ownerChannelName":"Channel B"}` })
], "?v=bbbbbbbbbbb");

check(
  "one describing this video is",
  readChannel(freshScript)?.id === B
);

process.exit(fail);
