// Catches a selector that sets the same property twice at the same level.
//
// Two `.browser` rules with different grid-template-columns both existed, and
// which one won came down to file order — the kind of thing that survives
// because the page still looks right.
//
// Conditional blocks (@container, @media, @supports) are meant to restate
// properties, so they are removed before comparing.
//
// Keyframes are a level of their own. A step selector belongs to its
// animation, so two animations both having a `0%, 100%` step is ordinary —
// merging them reported a duplicate box-shadow that did not exist. Each
// @keyframes is therefore checked on its own, which still catches the same
// step being written twice inside one animation.
import { readFileSync } from "node:fs";

function skipBlock(css, i) {
  let depth = 0;
  while (i < css.length) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) break;
    i++;
  }
  return i;
}

function stripConditionals(css) {
  let out = "";
  for (let i = 0; i < css.length; i++) {
    if (css.startsWith("@container", i) || css.startsWith("@media", i) || css.startsWith("@supports", i)) {
      i = skipBlock(css, i);
      continue;
    }
    out += css[i];
  }
  return out;
}

// Returns the css with every @keyframes lifted out, plus those bodies as
// scopes of their own.
function liftKeyframes(css) {
  const scopes = [];
  let out = "";

  for (let i = 0; i < css.length; i++) {
    if (!css.startsWith("@keyframes", i)) {
      out += css[i];
      continue;
    }
    const open = css.indexOf("{", i);
    if (open < 0) { out += css[i]; continue; }

    const name = css.slice(i + "@keyframes".length, open).trim();
    const end = skipBlock(css, i);
    scopes.push({ label: `@keyframes ${name}`, css: css.slice(open + 1, end) });
    i = end;
  }

  return { css: out, scopes };
}

function duplicates(css) {
  const seen = new Map(); // selector -> Map(property -> count)

  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, " ");
    if (!selector || selector.startsWith("@")) continue;

    const props = seen.get(selector) || new Map();
    for (const p of m[2].matchAll(/(^|;)\s*([a-z-]+)\s*:/g)) {
      props.set(p[2], (props.get(p[2]) || 0) + 1);
    }
    seen.set(selector, props);
  }

  const problems = [];
  for (const [selector, props] of seen) {
    const dupes = [...props].filter(([, n]) => n > 1).map(([p]) => p);
    if (dupes.length) problems.push(`${selector} sets ${dupes.join(", ")} more than once`);
  }
  return problems;
}

let failed = 0;
for (const file of process.argv.slice(2)) {
  const source = stripConditionals(
    readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ")
  );
  const { css, scopes } = liftKeyframes(source);

  const problems = [
    ...duplicates(css),
    ...scopes.flatMap((scope) => duplicates(scope.css).map((p) => `${scope.label}: ${p}`))
  ];

  if (problems.length) {
    failed = 1;
    for (const p of problems) console.log(`FAIL ${file}  ${p}`);
  } else {
    console.log(`ok   ${file}`);
  }
}
process.exit(failed);
