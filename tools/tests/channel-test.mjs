// Which channel the page belongs to, driven against fixed DOM shapes.
//
// This is the code that has been wrong the most often, and every time the
// reason was the same: something that was *present* was read as something that
// was *true*. A link that matched first in document order was read as the
// owner; an element still in the DOM was read as usable; a page mid-navigation
// was read as the page it was becoming. Each case below is one of those.
//
// Every case asserts `via` as well as the answer. An earlier version of this
// file did not, and a mutation check showed three of its cases passing with
// the behaviour they named deliberately broken — the info-card fallback was
// quietly answering for them. Where a fallback could rescue a case, the
// fixture now either removes it or gives it a competing card so that only the
// path under test can produce the right channel.
//
// The functions are lifted out of content.js rather than copied, so a change
// there is tested here. The DOM is a stub — enough of querySelector to carry
// these fixtures, and deliberately pre-order so that "first in document order"
// means here what it means in a browser. It cannot say anything about how a
// live page updates; that part was measured in a browser and is recorded in
// the commit that added the freshness guard.
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
    this.attrs = { ...attrs };
    this.text = this.attrs.text || "";
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

  // Pre-order, which is what document order means.
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

const el = (tag, attrs, children) => new El(tag, attrs || {}, children || []);
const a = (href, text) => el("a", { href, text });
const page = (children) => el("html", {}, children);

const doc = (children, search = "") => {
  const root = page(children);
  root.defaultView = { location: { search } };
  return root;
};

/* ---------- the code under test, lifted from content.js ---------- */

// OD_SOURCE lets the mutation checker point this at a deliberately broken
// copy: a test that still passes when its subject is broken is not a test.
const source = process.env.OD_SOURCE
  ? new URL(`file://${process.env.OD_SOURCE}`)
  : new URL("../../content.js", import.meta.url);
const src = readFileSync(source, "utf8");
const from = src.indexOf("  const CHANNEL_ID = ");
const to = src.indexOf("  /* ---------- deck assembly ---------- */");
if (from < 0 || to < 0 || to <= from) {
  console.log("FAIL could not lift the channel block out of content.js");
  process.exit(1);
}

// `window` and `document` are parameters rather than globals, so each scenario
// gets its own `lastSeen` and its own page.
const build = new Function(
  "window", "document",
  `${src.slice(from, to)}; return { readChannel, handleOf, getChannel };`
);

const loose = build({ location: { search: "" } }, page([]));
const { handleOf } = loose;
const readChannel = (d) => loose.readChannel(d);

// A whole frame: the page can be swapped and the address bar moved on, which
// is the only way to exercise what getChannel remembers across a navigation.
function frame() {
  const win = { location: { search: "" } };
  win.top = win;
  let current = page([]);
  const document = {
    querySelector: (s) => current.querySelector(s),
    querySelectorAll: (s) => current.querySelectorAll(s),
    get defaultView() { return win; }
  };
  const api = build(win, document);
  return {
    getChannel: () => api.getChannel(),
    show(children, video) {
      current = page(children);
      win.location.search = video ? `?v=${video}` : "";
    }
  };
}

// The panel actually runs inside the live-chat iframe, where the chat
// document has no owner block and the answer is on the parent. A frame whose
// top is itself never takes that path, so nothing here exercised it.
function chatFrame() {
  const top = { location: { search: "" } };
  top.top = top;
  let watch = page([]);
  top.document = {
    querySelector: (sel) => watch.querySelector(sel),
    querySelectorAll: (sel) => watch.querySelectorAll(sel),
    get defaultView() { return top; }
  };

  const win = { location: { search: "" }, top };
  const chat = page([]); // a live chat carries nothing that names the owner
  const document = {
    querySelector: (sel) => chat.querySelector(sel),
    querySelectorAll: (sel) => chat.querySelectorAll(sel),
    get defaultView() { return win; }
  };

  const api = build(win, document);
  return {
    getChannel: () => api.getChannel(),
    show(children, video) {
      watch = page(children);
      top.location.search = video ? `?v=${video}` : "";
    }
  };
}

/* ---------- fixtures ---------- */

const A = "UCaaaaaaaaaaaaaaaaaaaaaa";
const B = "UCbbbbbbbbbbbbbbbbbbbbbb";
const VID_A = "aaaaaaaaaaa"; // real video ids are 11 characters, and the
const VID_B = "bbbbbbbbbbb"; // player-response guard checks that
const VID_C = "ccccccccccc";

// `link` is the older layout that names the owner by id; `handle` is today's.
const ownerBlock = ({ handle, name, link, inName = [], extra = [] } = {}) =>
  el("ytd-video-owner-renderer", {}, [
    el("ytd-channel-name", { id: "channel-name" }, [
      ...(name === undefined ? [] : [el("yt-formatted-string", { id: "text", text: name })]),
      ...inName
    ]),
    ...(handle ? [a(handle, "")] : []),
    ...(link ? [a(`/channel/${link}`, "")] : []),
    ...extra
  ]);

const infocard = (handle, id, title) =>
  el("ytd-video-description-infocards-section-renderer", {}, [
    el("div", { id: "title", text: title }),
    ...(handle ? [a(handle, "")] : []),
    a(`/channel/${id}/videos`, "動画")
  ]);

const flexy = (videoId, children) => el("ytd-watch-flexy", { "video-id": videoId }, children);

let fail = 0;
const check = (label, ok) => { if (!ok) fail++; console.log((ok ? "ok   " : "FAIL ") + label); };

const is = (label, got, id, via) =>
  check(`${label} (${via})`, got?.id === id && got?.via === via);

/* ---------- the page is still the one we left ---------- */

is(
  "a page still showing the previous video answers nothing",
  readChannel(doc([
    flexy(VID_A, [ownerBlock({ handle: "/@a", name: "Channel A" }), infocard("/@a", A, "Channel A")])
  ], `?v=${VID_B}`)),
  undefined, undefined
);

is(
  "and answers again once the page catches up",
  readChannel(doc([
    flexy(VID_B, [ownerBlock({ handle: "/@b", name: "Channel B" }), infocard("/@b", B, "Channel B")])
  ], `?v=${VID_B}`)),
  B, "card-by-handle"
);

/* ---------- info cards are only the owner's ---------- */

is(
  "a known handle matching no card rejects the cards",
  readChannel(doc([
    flexy(VID_B, [ownerBlock({ handle: "/@b", name: "Channel B" }), infocard("/@a", A, "Channel A")])
  ], `?v=${VID_B}`)),
  undefined, undefined
);

// Two cards, so unanimity cannot answer: only the handle can pick between them.
is(
  "with a competing card, the handle decides",
  readChannel(doc([
    flexy(VID_B, [
      ownerBlock({ handle: "/@b", name: "Channel B" }),
      infocard("/@a", A, "Channel A"),
      infocard("/@b", B, "Channel B")
    ])
  ], `?v=${VID_B}`)),
  B, "card-by-handle"
);

is(
  "with no handle at all, cards that agree are believed",
  readChannel(doc([
    flexy(VID_B, [ownerBlock({ name: "A and 2 others" }), infocard(null, A, "Channel A"), infocard(null, A, "Channel A")])
  ], `?v=${VID_B}`)),
  A, "cards-agree"
);

check(
  "and the card's own title is the name, not the owner row's summary",
  readChannel(doc([
    flexy(VID_B, [ownerBlock({ name: "A and 2 others" }), infocard(null, A, "Channel A"), infocard(null, A, "Channel A")])
  ], `?v=${VID_B}`))?.name === "Channel A"
);

is(
  "cards that disagree are refused rather than guessed between",
  readChannel(doc([
    flexy(VID_B, [ownerBlock({ name: "someone" }), infocard(null, A, "Channel A"), infocard(null, B, "Channel B")])
  ], `?v=${VID_B}`)),
  undefined, undefined
);

/* ---------- handles ---------- */

check("a handle keeps its non-ASCII name", handleOf("/@さくら") === "/@さくら");
check("percent-escapes are undone", handleOf("/@%E3%81%95%E3%81%8F%E3%82%89") === "/@さくら");
check("query and fragment are dropped", handleOf("/@name?si=x") === "/@name");
check("a channel tab is still that handle", handleOf("/@name/videos") === "/@name");
check("case is ignored", handleOf("/@Name") === "/@name");
check("a malformed escape is compared as written", handleOf("/@100%") === "/@100%");
check("something that is not a handle is not one", handleOf("/channel/UC") === null);

// Competing card again, so unanimity cannot rescue this.
is(
  "an encoded card handle matches a plain non-ASCII owner handle",
  readChannel(doc([
    flexy(VID_B, [
      ownerBlock({ handle: "/@さくら", name: "さくら" }),
      infocard("/@other", B, "Other"),
      infocard("/@%E3%81%95%E3%81%8F%E3%82%89", A, "さくら")
    ])
  ], `?v=${VID_B}`)),
  A, "card-by-handle"
);

is(
  "a card linking to a channel tab matches the plain owner handle",
  readChannel(doc([
    flexy(VID_B, [
      ownerBlock({ handle: "/@b", name: "Channel B" }),
      infocard("/@a", A, "Channel A"),
      infocard("/@b/videos", B, "Channel B")
    ])
  ], `?v=${VID_B}`)),
  B, "card-by-handle"
);

/* ---------- first in document order is not the owner ---------- */

// No info cards at all, so nothing can answer except the owner block itself.
is(
  "an empty #owner earlier in the document does not win",
  readChannel(doc([
    el("div", { id: "owner" }, []),
    flexy(VID_B, [ownerBlock({ link: B, name: "Channel B" })])
  ], `?v=${VID_B}`)),
  B, "owner-link"
);

/* ---------- a button is not a name ---------- */

// Where YouTube puts it for a member: the join button is `/channel/UC…/join`,
// so it carries the right id while its label is not the channel.
const member = readChannel(doc([
  flexy(VID_B, [
    ownerBlock({
      name: "Channel B",
      extra: [el("div", { id: "sponsor-button" }, [
        el("ytd-button-renderer", {}, [a(`/channel/${B}/join`, "メンバー特典")])
      ])]
    })
  ])
], `?v=${VID_B}`));

is("the membership button still gives the right id", member, B, "owner-link");
check("and the name comes from the name element", member?.name === "Channel B");

// The only shape where a button could be read as the name: inside the name
// element, with no text of its own beside it. Without the button filter,
// `ytd-channel-name a` matches the join link and the label becomes the name.
const chip = readChannel(doc([
  flexy(VID_B, [
    ownerBlock({
      inName: [el("ytd-button-renderer", {}, [a(`/channel/${B}/join`, "メンバー特典")])]
    })
  ])
], `?v=${VID_B}`));

is("a join chip inside the name element still gives the id", chip, B, "owner-link");
check("but its label is never the name", chip?.name === "");

/* ---------- the leftover player response ---------- */

is(
  "a player response describing another video is not used",
  readChannel(doc([
    flexy(VID_B, [ownerBlock({})]),
    el("script", { text: `var ytInitialPlayerResponse = {"videoId":"${VID_A}","channelId":"${A}"}` })
  ], `?v=${VID_B}`)),
  undefined, undefined
);

is(
  "one describing this video is",
  readChannel(doc([
    flexy(VID_B, [ownerBlock({})]),
    el("script", { text: `var ytInitialPlayerResponse = {"videoId":"${VID_B}","channelId":"${B}","ownerChannelName":"Channel B"}` })
  ], `?v=${VID_B}`)),
  B, "player-response"
);

/* ---------- what is remembered across a navigation ---------- */

const settled = [flexy(VID_B, [ownerBlock({ handle: "/@b", name: "Channel B" }), infocard("/@b", B, "Channel B")])];
const blank = [flexy(VID_B, [ownerBlock({})])];
const blankOn = (video) => [flexy(video, [ownerBlock({})])];

const tab = frame();

// The address bar moves first: the page still shows the previous video.
tab.show([flexy(VID_A, [ownerBlock({ handle: "/@a", name: "Channel A" }), infocard("/@a", A, "Channel A")])], VID_B);
check("mid-navigation, nothing is answered", tab.getChannel() === null);

// And nothing was filed under the new video while it was stale.
tab.show(blank, VID_B);
check("and nothing was remembered from it", tab.getChannel() === null);

tab.show(settled, VID_B);
check("once settled, the owner is found", tab.getChannel()?.id === B);

tab.show(blank, VID_B);
check("a blank moment on the same video keeps the answer", tab.getChannel()?.id === B);

tab.show(blankOn(VID_C), VID_C);
check("but the next video does not inherit it", tab.getChannel() === null);

/* ---------- from inside the chat iframe ---------- */

const chat = chatFrame();
chat.show(settled, VID_B);
check("the owner is read from the parent document", chat.getChannel()?.id === B);

// A fresh frame: once an answer has been found for this video, a parent that
// goes stale is indistinguishable from a blank moment — and keeping the answer
// is right, because the video has not changed. What must not happen is reading
// the previous owner before anything is known.
const arriving = chatFrame();
arriving.show([flexy(VID_A, [ownerBlock({ handle: "/@a", name: "Channel A" }), infocard("/@a", A, "Channel A")])], VID_B);
check("a parent still on the previous video is noticed from here too", arriving.getChannel() === null);

process.exit(fail);
