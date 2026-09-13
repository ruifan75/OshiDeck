// A small chat page, and a selector engine that actually walks it.
//
// The first version of this matched selectors by looking for words in the
// string — "does it mention the input renderer?" — which is not a page, it is
// a paraphrase of the selector under test agreeing with itself. Review found
// three selectors it accepted that are all wrong on the real page: one that
// also reaches another viewer's chip, one that misses the #input-container
// the chip actually sits behind, and one that asks for a moderator badge.
//
// So this builds the tree that was measured on a live stream and matches
// against it: tag, #id, [attr="value"], descendant and child combinators, and
// comma groups. Enough to tell a right selector from a plausible one.

/* ---------- the engine ---------- */

const compound = (token) => ({
  tag: token.match(/^[\w-]+/)?.[0]?.toUpperCase() || null,
  id: token.match(/#([\w-]+)/)?.[1] || null,
  attrs: [...token.matchAll(/\[([\w-]+)\s*=\s*['"]?([^\]'"]+)['"]?\]/g)].map((m) => [m[1], m[2]]),
  bare: /\[([\w-]+)\]/.test(token) ? token.match(/\[([\w-]+)\]/)[1] : null
});

// Each step remembers how it is reached: a direct child, or any descendant.
const chainOf = (group) => {
  const steps = [];
  let child = false;
  for (const token of group.replace(/>/g, " > ").trim().split(/\s+/)) {
    if (token === ">") { child = true; continue; }
    steps.push({ child, ...compound(token) });
    child = false;
  }
  return steps;
};

const hits = (node, step) =>
  (!step.tag || node.tag === step.tag) &&
  (!step.id || node.id === step.id) &&
  (!step.bare || node.attrs[step.bare] !== undefined) &&
  step.attrs.every(([name, value]) => String(node.attrs[name]) === value);

function matchesChain(node, chain) {
  if (!hits(node, chain[chain.length - 1])) return false;
  let at = node;
  for (let i = chain.length - 2; i >= 0; i--) {
    const how = chain[i + 1];
    if (how.child) {
      at = at.parent;
      if (!at || !hits(at, chain[i])) return false;
    } else {
      at = at.parent;
      while (at && !hits(at, chain[i])) at = at.parent;
      if (!at) return false;
    }
  }
  return true;
}

function* walk(node) {
  for (const kid of node.kids) {
    yield kid;
    yield* walk(kid);
  }
}

function query(root, selector) {
  const chains = selector.split(",").map(chainOf).filter((c) => c.length);
  for (const node of walk(root)) {
    if (chains.some((chain) => matchesChain(node, chain))) return node;
  }
  return null;
}

function el(tag, attrs = {}, kids = []) {
  const node = {
    tag: tag.toUpperCase(),
    id: attrs.id || null,
    attrs,
    kids,
    parent: null,
    get hidden() { return this.attrs.hidden !== undefined; },
    querySelector(selector) { return query(this, selector); }
  };
  for (const kid of kids) kid.parent = node;
  return node;
}

/* ---------- the page, as measured ---------- */

const badge = (type) => el("yt-live-chat-author-badge-renderer", { type, "aria-label": `${type} badge` });

// Every message carries its author's chip, badges and all. On a stream I was
// not a member of there were 57 of these — which is why the scope of the
// query is the whole guarantee.
const messageFrom = (badges) =>
  el("yt-live-chat-text-message-renderer", {}, [
    el("yt-live-chat-author-chip", {}, [el("span", { id: "chat-badges" }, badges)]),
    el("div", { id: "message" })
  ]);

// Mine. The chip sits behind #input-container, and carries `hidden` in a
// popped-out chat even while the badge is right there.
const myChip = (mine) =>
  el("yt-live-chat-author-chip", { hidden: "" }, [
    el("span", { id: "chat-badges" }, mine ? [badge("member")] : [])
  ]);

export function page({ chip = true, mine = false, others = 57, moderators = 1 } = {}) {
  const messages = [];
  for (let i = 0; i < others; i++) messages.push(messageFrom([badge("member")]));
  for (let i = 0; i < moderators; i++) messages.push(messageFrom([badge("moderator")]));

  return el("yt-live-chat-app", {}, [
    el("div", { id: "contents" }, [
      el("yt-live-chat-renderer", {}, [
        el("div", { id: "items" }, messages),
        el("yt-live-chat-message-input-renderer", { id: "live-chat-message-input" }, [
          el("div", { id: "container" }, [
            el("div", { id: "top" }, [
              el("div", { id: "input-container" }, [
                ...(chip ? [myChip(mine)] : []),
                el("yt-live-chat-text-input-field-renderer", {}, [el("div", { id: "input" })])
              ])
            ])
          ])
        ])
      ])
    ])
  ]);
}
