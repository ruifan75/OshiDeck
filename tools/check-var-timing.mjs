// Catches a custom property that composes another one in its own declaration.
//
// `--a: oklch(... var(--b))` is resolved on the element that declares it, and
// descendants inherit the resolved value. So a descendant setting --b cannot
// change --a — the colour silently stays whatever the declaring element had.
// This shipped: every channel stripe painted the default hue.
import { readFileSync } from "node:fs";

let failed = 0;
for (const file of process.argv.slice(2)) {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

  // Which custom properties are set somewhere other than where they are composed.
  const setElsewhere = new Set();
  for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) setElsewhere.add(m[1]);

  const problems = [];
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]*var\(\s*(--[\w-]+)[^;}]*)/g)) {
    const [, outer, value, inner] = m;
    if (!setElsewhere.has(inner)) continue;
    // A plain alias (--a: var(--b)) is fine; the trap is composing it into a
    // larger value that descendants are expected to re-resolve.
    if (value.trim() === `var(${inner})`) continue;
    problems.push(`${outer} composes ${inner}; a descendant setting ${inner} cannot change ${outer}`);
  }

  if (problems.length) {
    failed = 1;
    for (const p of problems) console.log(`FAIL ${file}  ${p}`);
  } else {
    console.log(`ok   ${file}`);
  }
}
process.exit(failed);
