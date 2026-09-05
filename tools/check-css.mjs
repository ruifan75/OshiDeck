// Catches a selector that sets the same property twice at the same level.
//
// Two `.browser` rules with different grid-template-columns both existed, and
// which one won came down to file order — the kind of thing that survives
// because the page still looks right.
//
// Conditional blocks (@container, @media) are meant to restate properties, so
// they are removed before comparing.
import { readFileSync } from "node:fs";

function stripConditionals(css) {
  let out = "";
  for (let i = 0; i < css.length; i++) {
    if (css.startsWith("@container", i) || css.startsWith("@media", i) || css.startsWith("@supports", i)) {
      let depth = 0;
      while (i < css.length) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}" && --depth === 0) break;
        i++;
      }
      continue;
    }
    out += css[i];
  }
  return out;
}

let failed = 0;
for (const file of process.argv.slice(2)) {
  const css = stripConditionals(
    readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ")
  );

  const seen = new Map(); // selector -> Map(property -> count)
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, " ");
    if (!selector || selector.startsWith("@") || selector.startsWith("%")) continue;

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

  if (problems.length) {
    failed = 1;
    for (const p of problems) console.log(`FAIL ${file}  ${p}`);
  } else {
    console.log(`ok   ${file}`);
  }
}
process.exit(failed);
