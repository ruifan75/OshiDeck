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

// Anything it does not understand is refused rather than approximated. The
// first version picked the fragments it recognised out of the token and
// ignored the rest, so `:not([hidden])` read as *requiring* hidden and
// `.whatever` read as nothing at all — both the opposite of what a browser
// does. A selector engine that quietly reinterprets the selector is worse
// than no engine, because the test still goes green.
const UNDERSTOOD = /^(?:[\w-]+|#[\w-]+|\[[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\]]+))?\])+$/;

const compound = (token) => {
  if (!UNDERSTOOD.test(token)) {
    throw new Error(`page.mjs cannot answer for ${JSON.stringify(token)} — ask a browser`);
  }
  return {
    tag: token.match(/^[\w-]+/)?.[0]?.toUpperCase() || null,
    id: token.match(/#([\w-]+)/)?.[1] || null,
    attrs: [...token.matchAll(/\[([\w-]+)\s*=\s*['"]?([^\]'"]+)['"]?\]/g)].map((m) => [m[1], m[2]]),
    bare: /\[([\w-]+)\]/.test(token) ? token.match(/\[([\w-]+)\]/)[1] : null
  };
};

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

// Backtracks, because taking the nearest matching ancestor and walking on is
// not the same question. `input-renderer > div author-chip` matches in a
// browser and did not match here: the greedy walk took the wrong `div` and
// never went back for the other one.
function matchesFrom(node, chain, i) {
  if (!hits(node, chain[i])) return false;
  if (i === 0) return true;
  if (chain[i].child) return !!node.parent && matchesFrom(node.parent, chain, i - 1);
  for (let at = node.parent; at; at = at.parent) {
    if (matchesFrom(at, chain, i - 1)) return true;
  }
  return false;
}

const matchesChain = (node, chain) => matchesFrom(node, chain, chain.length - 1);

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
const myChip = (mine, hidden) =>
  el("yt-live-chat-author-chip", hidden ? { hidden: "" } : {}, [
    el("span", { id: "chat-badges" }, mine ? [badge("member")] : [])
  ]);

// `hidden` is a fixture of the page, not a fact about membership: a popped-out
// chat hides the chip either way. Every fixture used to set it, so a selector
// that *required* hidden passed everything — and on a page where the chip is
// visible that selector finds nothing, which reads as "cannot tell" and
// leaves a non-member's cards unlocked.
export function page({ chip = true, mine = false, others = 57, moderators = 1,
                       hidden = true } = {}) {
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
                ...(chip ? [myChip(mine, hidden)] : []),
                el("yt-live-chat-text-input-field-renderer", {}, [el("div", { id: "input" })])
              ])
            ])
          ])
        ])
      ])
    ])
  ]);
}
