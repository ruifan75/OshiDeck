// Catches calls to functions that do not exist.
//
// `node --check` only parses; a missing function is a runtime error, and in a
// content script it surfaces as a dead button rather than a failed build.
//
// This is a text scan, not a parser: it collects every name declared anywhere
// in the file and flags bare calls to names that appear nowhere. Scope is
// deliberately ignored — the failure worth catching is a name that does not
// exist at all, which is what a bad edit leaves behind.
import { readFileSync } from "node:fs";

const GLOBALS = new Set([
  "console", "document", "window", "globalThis", "chrome", "location", "navigator",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask",
  "requestAnimationFrame", "cancelAnimationFrame", "fetch", "structuredClone",
  "Object", "Array", "String", "Number", "Boolean", "Math", "JSON", "Date", "RegExp",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "Error", "TypeError", "Symbol",
  "Proxy", "Reflect", "BigInt", "Intl", "URL", "URLSearchParams", "Blob", "File",
  "FileReader", "FormData", "Headers", "Request", "Response", "AbortController",
  "MutationObserver", "ResizeObserver", "IntersectionObserver", "PerformanceObserver",
  "performance", "crypto", "Node", "Element", "HTMLElement", "Event", "CustomEvent",
  "InputEvent", "KeyboardEvent", "PointerEvent", "MouseEvent", "DataTransfer",
  "DocumentFragment", "Range", "Selection", "getComputedStyle", "alert", "confirm",
  "prompt", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
  "decodeURIComponent", "require", "process", "module", "exports"
]);

// Every name bound anywhere in the file, in any scope. Scope is deliberately
// ignored — the failure worth catching is a name that exists nowhere.
//
// Parameters need care: a rule as loose as /(\w+)\s*\(/ would treat the call
// site itself as a declaration, and the check would pass on everything.
function declared(src) {
  const names = new Set();

  const addName = (name) => {
    if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
  };

  // Anything inside a binding pattern: {a, b: c, d = 1}, [x, ...rest], a = 1
  const addPattern = (text) => {
    for (const part of text.split(",")) {
      const name = part.split(":").pop().split("=")[0].replace(/[[\]{}.]/g, "").trim();
      addName(name);
    }
  };

  for (const m of src.matchAll(/(?:^|[^.\w$])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) {
    if (m[1]) addName(m[1]);
    addPattern(m[2]);
  }
  for (const m of src.matchAll(/(?:const|let|var)\s+([^=;\n]+?)\s*(?:=|;|\bof\b|\bin\b)/g)) addPattern(m[1]);
  for (const m of src.matchAll(/class\s+([A-Za-z_$][\w$]*)/g)) addName(m[1]);
  for (const m of src.matchAll(/import\s+(?:\*\s+as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\}|([A-Za-z_$][\w$]*))/g)) {
    if (m[1]) addName(m[1]);
    if (m[2]) addPattern(m[2].replace(/\bas\b/g, ":"));
    if (m[3]) addName(m[3]);
  }
  for (const m of src.matchAll(/catch\s*\(([^)]*)\)/g)) addPattern(m[1]);
  // Accessors read as calls at their definition site.
  for (const m of src.matchAll(/\b(?:get|set)\s+([A-Za-z_$][\w$]*)\s*\(/g)) addName(m[1]);

  // Arrow parameters, both (a, b) => and a =>
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) addPattern(m[1]);
  for (const m of src.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*=>/g)) addName(m[1]);

  return names;
}

let failed = 0;
for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, "utf8");
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    // Regex literals hold things that look like calls: /\b(?:get)/ reads as
    // a call to b(). Only after a token that cannot end an expression, so
    // division is not mistaken for one.
    .replace(/([(,=:[!&|?{};+\-*%^~]|\breturn\b|^)(\s*)\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuyv]*/g,
             "$1$2/re/");

  const known = declared(stripped);
  const missing = new Map();

  // Bare calls only: `foo(` but not `x.foo(`, `new Foo(`, `function foo(`.
  for (const m of stripped.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[2];
    if (known.has(name) || GLOBALS.has(name)) continue;
    // Keywords that can legally precede "(" — `async (a) =>` is not a call.
    if (/^(if|for|while|switch|catch|return|typeof|await|new|function|class|do|else|async|get|set|yield|void|delete|in|of|instanceof|throw|case)$/.test(name)) continue;
    const line = stripped.slice(0, m.index).split("\n").length;
    if (!missing.has(name)) missing.set(name, line);
  }

  if (missing.size) {
    failed = 1;
    for (const [name, line] of missing) {
      console.log(`FAIL ${file}:${line}  ${name}() is called but never defined`);
    }
  } else {
    console.log(`ok   ${file}`);
  }
}

process.exit(failed);
