// Build a reproducible ZIP from explicitly listed runtime inputs.
// node tools/build-release.mjs [--out <directory>]
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createContext, runInContext } from "node:vm";
import { createRequire } from "node:module";
import { MIMEType } from "node:util";

export const RUNTIME_FILES = [
  "manifest.json", "background.js", "content.js", "content.css",
  "options.html", "options.js", "options.css",
  "src/i18n.js", "src/layout.js", "src/store.js", "src/tokens.js",
  "src/backup.js", "src/journal.js", "src/presets.js", "src/trending.js",
  "src/channel-marks.js", "src/channel-marks.css",
  "icons/16.png", "icons/32.png", "icons/48.png", "icons/128.png"
];
const RUNTIME = new Set(RUNTIME_FILES);
const CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
// Bound the in-memory snapshot and decompressed ZIP check. An accidental
// large input must not make packaging read gigabytes of working data.
const MAX_BYTES = 128 * 1024 * 1024;
const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
class ReleaseBuildError extends Error {
  constructor(code, file) {
    super(`${code}${file ? `: ${file}` : ""}`);
    this.code = code;
  }
}
const fail = (code, file = "") => { throw new ReleaseBuildError(code, file); };

function readRuntime(root, file, snapshot) {
  if (snapshot.has(file)) return snapshot.get(file);
  const path = join(root, file);
  if (!existsSync(path)) fail("MISSING_RUNTIME_FILE", file);
  if (realpathSync(path) !== path) fail("SYMLINK_RUNTIME_FILE", file);
  const stat = lstatSync(path);
  if (!stat.isFile()) fail("NOT_A_RUNTIME_FILE", file);
  if (stat.size + [...snapshot.values()].reduce((n, b) => n + b.length, 0) > MAX_BYTES) fail("PACKAGE_TOO_LARGE");
  const bytes = readFileSync(path);
  snapshot.set(file, bytes);
  return bytes;
}

function json(bytes, file) {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { fail("INVALID_JSON", file); }
}

function manifestResources(manifest) {
  if (manifest?.manifest_version !== 3 || typeof manifest.version !== "string" ||
      !/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) fail("INVALID_MANIFEST");
  const files = [manifest.background?.service_worker, manifest.options_page];
  for (const item of manifest.content_scripts || []) files.push(...(item.js || []), ...(item.css || []));
  files.push(...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {}));
  for (const file of files) {
    if (!RUNTIME.has(file)) fail("UNLISTED_MANIFEST_RESOURCE");
  }
}

function htmlReferences(bytes, file, Parser, html, sniffEncoding) {
  // Bound the token/tree audit independently of the much larger preset corpus.
  // Accidental large documents must not balloon the packaging memory budget.
  if (bytes.length > 1024 * 1024) fail("UNSUPPORTED_RUNTIME_HTML", file);
  if (sniffEncoding(bytes) !== "UTF-8") fail("UNSUPPORTED_RUNTIME_HTML", file);
  let source;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("UNSUPPORTED_RUNTIME_HTML", file); }
  if (source.includes("\0")) fail("UNSUPPORTED_RUNTIME_HTML", file);

  const starts = new Map(), ends = new Map();
  class AuditedParser extends Parser {
    onStartTag(token) {
      starts.set(token.location.startOffset, token.tagName);
      if (starts.size + ends.size > 20000) fail("UNSUPPORTED_RUNTIME_HTML", file);
      super.onStartTag(token);
    }
    onEndTag(token) {
      ends.set(token.location.startOffset, token.tagName);
      if (starts.size + ends.size > 20000) fail("UNSUPPORTED_RUNTIME_HTML", file);
      super.onEndTag(token);
    }
  }
  // This flag chooses HTML grammar, not code execution. parse5 never runs JS.
  const document = AuditedParser.parse(source, { scriptingEnabled: true, sourceCodeLocationInfo: true });
  const getAttr = (node, name, namespace = undefined) =>
    node.attrs?.find((attr) => attr.name === name && attr.namespace === namespace)?.value;
  const explicitClosers = new Set(["script", "style", "noscript", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "template", "select"]);
  const startNodes = new Map(), endNodes = new Map(), references = [];
  const stack = [{ node: document, inTemplate: false }];
  let base = null, firstReference = Infinity;
  const addReference = (value, at) => {
    if (value == null) return;
    references.push(value);
    firstReference = Math.min(firstReference, at);
  };
  const ensureUTF8 = (label) => {
    if (label == null) return;
    try { if (new TextDecoder(label).encoding === "utf-8") return; }
    catch { /* unsupported labels are not part of the release HTML profile */ }
    fail("UNSUPPORTED_RUNTIME_HTML", file);
  };
  while (stack.length) {
    const { node, inTemplate } = stack.pop();
    const location = node.sourceCodeLocation;
    if (node.tagName && location) {
      const at = location.startTag?.startOffset ?? location.startOffset;
      if (startNodes.has(at)) fail("UNSUPPORTED_RUNTIME_HTML", file);
      startNodes.set(at, node.tagName.toLowerCase());
      if (location.endTag) {
        if (endNodes.has(location.endTag.startOffset)) fail("UNSUPPORTED_RUNTIME_HTML", file);
        endNodes.set(location.endTag.startOffset, node.tagName.toLowerCase());
      }
      if (node.namespaceURI === html.NS.HTML) {
        if (explicitClosers.has(node.tagName) && !location.endTag) {
          fail("UNSUPPORTED_RUNTIME_HTML", file);
        }
        if (node.tagName === "meta") {
          ensureUTF8(getAttr(node, "charset"));
          if (getAttr(node, "http-equiv")?.toLowerCase() === "content-type") {
            try { ensureUTF8(new MIMEType(getAttr(node, "content") || "").params.get("charset")); }
            catch { fail("UNSUPPORTED_RUNTIME_HTML", file); }
          }
        }
        if (node.tagName === "base" && getAttr(node, "href") != null) {
          // A single base, before resources, makes initial loads and later
          // template activation share one URL context. Other forms are refused.
          if (inTemplate || base) fail("UNSUPPORTED_RUNTIME_HTML", file);
          base = { value: getAttr(node, "href"), at };
        }
        if (node.tagName === "script" || node.tagName === "link") {
          const reference = node.tagName === "script" ? getAttr(node, "src") : getAttr(node, "href");
          addReference(reference, at);
        }
      } else if (node.namespaceURI === html.NS.SVG && node.tagName === "script") {
        // SVG uses href (or legacy xlink:href), never HTML's src attribute.
        const reference = getAttr(node, "href") ?? getAttr(node, "href", html.NS.XLINK);
        addReference(reference, at);
      }
    }
    // Include ordinary templates as potential dependencies, and declarative
    // shadow roots as active dependencies, even when the DOM library is older.
    if (node.content) stack.push({ node: node.content, inTemplate: true });
    for (let i = (node.childNodes?.length || 0) - 1; i >= 0; i--) {
      stack.push({ node: node.childNodes[i], inTemplate });
    }
  }
  // Table foster parenting can move a later base ahead of an earlier script
  // in the DOM. Compare source offsets only after collecting every reference.
  if (base && base.at > firstReference) fail("UNSUPPORTED_RUNTIME_HTML", file);
  // The tokenizer sees tags even if an older tree builder discards them (for
  // example, links in modern selects). Never accept such an unchecked tree.
  for (const [at, name] of starts) if (startNodes.get(at) !== name.toLowerCase()) fail("UNSUPPORTED_RUNTIME_HTML", file);
  for (const [at, name] of ends) if (endNodes.get(at) !== name.toLowerCase()) fail("UNSUPPORTED_RUNTIME_HTML", file);
  return { references, base: base?.value ?? null };
}

function runtimeDependencies(snapshot) {
  let Parser, html, sniffEncoding;
  try {
    const require = createRequire(import.meta.url);
    ({ Parser, html } = require("parse5"));
    sniffEncoding = require("html-encoding-sniffer");
  }
  catch { fail("MISSING_BUILD_DEPENDENCY"); }
  // Different hosts catch //host references; different schemes also catch
  // forms such as "https:options.js", which inherit a same-scheme base host.
  // Let the URL parser handle controls and escapes before checking locality.
  const origins = [new URL("https://oshideck.invalid/"), new URL("http://oshideck-check.invalid/")];
  const documentURLs = (file) => origins.map((origin) => new URL(file, origin));
  const checkedURLs = (urls, importer) => {
    if (urls.some((url, i) => url.origin !== origins[i].origin) ||
        urls.some((url) => url.pathname !== urls[0].pathname || url.search !== urls[0].search || url.hash !== urls[0].hash)) {
      fail("UNLISTED_RUNTIME_DEPENDENCY", importer);
    }
    return urls;
  };
  const localURLs = (value, importer, bases = documentURLs(importer)) => {
    try {
      return checkedURLs(bases.map((base) => new URL(value, base)), importer);
    } catch { fail("UNLISTED_RUNTIME_DEPENDENCY", importer); }
  };
  const requireFile = (specifier, importer, module = false, bases = documentURLs(importer)) => {
    const urls = localURLs(specifier, importer, bases);
    try {
      if (module && !/^(?:\.{1,2}\/|\/)/.test(specifier)) throw new Error();
      if (!RUNTIME.has(decodeURIComponent(urls[0].pathname.slice(1)))) throw new Error();
    } catch { fail("UNLISTED_RUNTIME_DEPENDENCY", importer); }
  };
  // Audit a bounded HTML profile without script execution or network access.
  // Comments/raw text stay text; discarded or ambiguous markup fails closed.
  for (const [file, bytes] of snapshot) if (file.endsWith(".html")) {
    const result = htmlReferences(bytes, file, Parser, html, sniffEncoding);
    const bases = result.base === null ? documentURLs(file) : localURLs(result.base, file);
    for (const reference of result.references) requireFile(reference, file, false, bases);
  }
  // Ask Node's module parser for static imports/re-exports; do not evaluate
  // packaged code or try to recognise JavaScript with regular expressions.
  // Every allowed JS file is parsed, so imports in its dependencies are checked
  // too. The flag enables this parser API without requiring it for the CLI.
  const scripts = [...snapshot].filter(([file]) => file.endsWith(".js"))
    .map(([file, bytes]) => [file, bytes.toString("utf8")]);
  const temporary = mkdtempSync(join(tmpdir(), "oshideck-imports-"));
  try {
    // A regular file avoids a synchronous parent/child pipe stalling while
    // transferring the source snapshot. It is fully written before spawning.
    const input = join(temporary, "scripts.json");
    writeFileSync(input, JSON.stringify(scripts));
    const parsed = spawnSync(process.execPath, ["--experimental-vm-modules", "--input-type=module", "-e", `
    import {readFileSync} from 'node:fs';
    import {SourceTextModule} from 'node:vm';
    const result=[];
    for(const [file,source] of JSON.parse(readFileSync(process.argv[1],'utf8'))){
      try { result.push([file,new SourceTextModule(source).dependencySpecifiers]); }
      catch { console.log(JSON.stringify({error:file})); process.exit(0); }
    }
    console.log(JSON.stringify({imports:result}));
    `, input], { stdio: ["ignore", "pipe", "pipe"], maxBuffer: MAX_BYTES, timeout: 30000 });
    if (parsed.error || parsed.status !== 0) fail("DEPENDENCY_PARSER_FAILED");
    const result = json(parsed.stdout, "runtime dependencies");
    if (result.error) fail("INVALID_RUNTIME_SCRIPT", result.error);
    for (const [file, imports] of result.imports) {
      for (const specifier of imports) requireFile(specifier, file, true);
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

function knownSecrets(root) {
  const file = join(root, ".env");
  const values = existsSync(file) ? readFileSync(file, "utf8").split("\n").flatMap((line) => {
    const match = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!match || !/KEY|TOKEN|SECRET|PASSWORD/i.test(match[1])) return [];
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    return value.length >= 12 ? [value] : [];
  }) : [];
  if (process.env.HOLODEX_API_KEY?.length >= 12) values.push(process.env.HOLODEX_API_KEY);
  return values;
}

function publicNameRules(root) {
  let source;
  try { source = readFileSync(join(root, "tools/hooks/public-names.tsv"), "utf8"); }
  catch { fail("INVALID_PUBLIC_NAME_RULES"); }
  const rules = new Set();
  for (const line of source.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_.\/-]+)\t([0-9a-f]{64})$/.exec(line);
    if (!match || match[1].startsWith("/") || /(^|\/)\.\.(\/|$)/.test(match[1])) fail("INVALID_PUBLIC_NAME_RULES");
    rules.add(line);
  }
  return rules;
}

function saysAccount(text, account) {
  if (!account) return false;
  const lower = text.toLowerCase();
  let at = lower.indexOf(account);
  while (at >= 0) {
    if (at === 0 || !/[A-Za-z]/.test(lower[at - 1])) return true;
    at = lower.indexOf(account, at + 1);
  }
  return false;
}

function checkPrivateContent(snapshot, secrets, publicNames) {
  // Match the commit hook: a literal, case-insensitive account name bounded
  // on the left by a non-ASCII-letter. Very short names are too ambiguous.
  const login = basename(homedir()).toLowerCase();
  const account = login.length >= 4 ? login : "";
  const address = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const publicAddress = /^(?:[^@]+@users\.noreply\.github\.com|noreply@anthropic\.com)$/i;
  const home = /(?:\/Users\/|\/home\/|[A-Z]:[\\/]Users[\\/])[^/\\\s"'`]+/i;
  const credential = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
  for (const [file, bytes] of snapshot) {
    if (secrets.some((value) => bytes.includes(Buffer.from(value)))) fail("PRIVATE_CONTENT", file);
    if (!/\.(?:json|js|css|html)$/.test(file)) continue;
    const text = bytes.toString("utf8");
    if (home.test(text) || credential.test(text) ||
        [...text.matchAll(address)].some(([value]) => !publicAddress.test(value))) fail("PRIVATE_CONTENT", file);
    if (saysAccount(text, account)) {
      for (let start = 0; start < bytes.length;) {
        const newline = bytes.indexOf(10, start);
        const end = newline < 0 ? bytes.length : newline;
        const line = bytes.subarray(start, end);
        // Only the name check has an exception, bound to this path and the
        // original line bytes. Decoding/normalising must never grant approval.
        if (saysAccount(line.toString("utf8"), account) && !publicNames.has(file + "\t" + sha256(line))) fail("PRIVATE_CONTENT", file);
        start = end + 1;
      }
    }
  }
}

function presetValidator(snapshot) {
  // Use the readers being shipped, without exposing the process or filesystem
  // to their script context. Their validation does not write browser storage.
  const context = createContext({ OshiDeck: {}, URL, TextEncoder, TextDecoder,
    chrome: { runtime: { id: "release-build" }, storage: { local: {
      get: async () => ({}), set: async () => {}
    } } } });
  for (const file of ["src/tokens.js", "src/backup.js", "src/store.js", "src/presets.js"]) {
    try { runInContext(snapshot.get(file).toString("utf8"), context, { filename: file, timeout: 1000 }); }
    catch { fail("INVALID_RUNTIME_SCRIPT", file); }
  }
  return context.OshiDeck.presets.validate;
}

function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { ...options, env: { ...process.env, TZ: "UTC" }, timeout: 120000 });
  if (result.error || result.status !== 0) fail(`${binary.toUpperCase()}_FAILED`);
  return result.stdout;
}

// Only ordinary ZIP is needed at the bounded size above. Inspect metadata
// before asking unzip for a byte stream; nothing is extracted onto disk.
function zipEntries(bytes) {
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) ||
      bytes.readUInt16LE(end + 8) !== bytes.readUInt16LE(end + 10) || bytes.readUInt16LE(end + 20)) fail("INVALID_ZIP");
  const count = bytes.readUInt16LE(end + 10), start = bytes.readUInt32LE(end + 16);
  if (count === 65535 || start + bytes.readUInt32LE(end + 12) !== end) fail("INVALID_ZIP");
  const entries = []; let at = start;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) fail("INVALID_ZIP");
    const nameSize = bytes.readUInt16LE(at + 28), extraSize = bytes.readUInt16LE(at + 30), commentSize = bytes.readUInt16LE(at + 32);
    const next = at + 46 + nameSize + extraSize + commentSize;
    if (next > end) fail("INVALID_ZIP");
    const name = bytes.subarray(at + 46, at + 46 + nameSize).toString("utf8");
    const local = bytes.readUInt32LE(at + 42), compressed = bytes.readUInt32LE(at + 20);
    if (extraSize || commentSize || bytes.readUInt16LE(at + 12) || bytes.readUInt16LE(at + 14) !== 33 ||
        (bytes.readUInt16LE(at + 8) & 1) || ((bytes.readUInt32LE(at + 38) >>> 16) & 0o170000) === 0o120000) fail("ZIP_PRIVATE_METADATA");
    if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 28)) fail("INVALID_ZIP");
    const localNameSize = bytes.readUInt16LE(local + 26);
    if (bytes.subarray(local + 30, local + 30 + localNameSize).toString("utf8") !== name ||
        local + 30 + localNameSize + compressed > start) fail("INVALID_ZIP");
    entries.push({ name, size: bytes.readUInt32LE(at + 24) });
    at = next;
  }
  if (at !== end) fail("INVALID_ZIP");
  return entries;
}

export function buildRelease({ root = DEFAULT_ROOT, out = join(root, "dist") } = {}) {
  root = realpathSync(root);
  out = resolve(out);
  const snapshot = new Map();
  const manifest = json(readRuntime(root, "manifest.json", snapshot), "manifest.json");
  manifestResources(manifest);
  for (const file of RUNTIME_FILES) readRuntime(root, file, snapshot);
  runtimeDependencies(snapshot);
  const index = json(readRuntime(root, "presets/index.json", snapshot), "presets/index.json");
  if (!index || typeof index !== "object" || index.format !== 2 || !Array.isArray(index.presets) || !index.presets.length) fail("INVALID_PRESET_INDEX");
  const channels = new Set(), presetFiles = [];
  for (const entry of index.presets) {
    if (typeof entry?.channel !== "string" || !CHANNEL.test(entry.channel) || entry.file !== `${entry.channel}.json` || channels.has(entry.channel)) fail("INVALID_PRESET_INDEX");
    channels.add(entry.channel);
    presetFiles.push(`presets/${entry.file}`);
  }
  const fileList = [...RUNTIME_FILES, "presets/index.json", ...presetFiles].sort();
  if (fileList.length >= 65535) fail("PACKAGE_TOO_MANY_FILES");
  for (const file of fileList) readRuntime(root, file, snapshot);
  checkPrivateContent(snapshot, knownSecrets(root), publicNameRules(root));
  const validate = presetValidator(snapshot);
  let cards = 0;
  for (const entry of index.presets) {
    const file = `presets/${entry.file}`, preset = json(snapshot.get(file), file);
    const problem = validate(preset);
    if (problem) fail("INVALID_PRESET", file);
    if (preset.channel !== entry.channel || preset.cards.some((card) => card.scope !== "channel")) fail("INVALID_PRESET_SCOPE", file);
    for (const card of preset.cards) for (const token of card.tokens) {
      if (token.type !== "youtubeEmoji") continue;
      try { if (new URL(token.src).protocol !== "https:") fail("INVALID_PRESET_IMAGE", file); }
      catch { fail("INVALID_PRESET_IMAGE", file); }
    }
    cards += preset.cards.length;
  }

  const temporary = mkdtempSync(join(tmpdir(), "oshideck-release-"));
  try {
    const staging = join(temporary, "extension"); mkdirSync(staging);
    const stamp = new Date("1980-01-01T00:00:00Z");
    for (const file of fileList) {
      const target = join(staging, file); mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, snapshot.get(file), { mode: 0o644 });
      chmodSync(target, 0o644);
      utimesSync(target, stamp, stamp);
    }
    const archiveName = `oshideck-${manifest.version}.zip`, archive = join(temporary, archiveName);
    run("zip", ["-X", "-q", "-9", archive, "-@"], { cwd: staging, input: fileList.join("\n") + "\n" });
    const zip = readFileSync(archive), entries = zipEntries(zip);
    if (entries.length !== fileList.length || entries.some((e, i) => e.name !== fileList[i] || e.size !== snapshot.get(fileList[i]).length)) fail("ZIP_FILE_LIST_MISMATCH");
    run("unzip", ["-tqq", archive]);
    const size = fileList.reduce((n, file) => n + snapshot.get(file).length, 0);
    const contents = run("unzip", ["-p", archive], { maxBuffer: size + 1024 });
    let at = 0;
    const files = fileList.map((file) => {
      const bytes = snapshot.get(file), digest = sha256(bytes);
      if (sha256(contents.subarray(at, at + bytes.length)) !== digest) fail("ZIP_CONTENT_MISMATCH", file);
      at += bytes.length;
      return { path: file, bytes: bytes.length, sha256: digest };
    });
    if (at !== contents.length) fail("ZIP_CONTENT_MISMATCH");
    const report = { format: 1, version: manifest.version, archive: archiveName,
      archiveBytes: zip.length, sha256: sha256(zip), files: files.length,
      uncompressedBytes: size, presets: index.presets.length, cards,
      checks: { runtimeAllowlist: true, presetValidation: true, privateContent: true,
        zipMetadata: true, zipCRC: true, fileHashes: true }, entries: files };
    mkdirSync(out, { recursive: true });
    if (lstatSync(out).isSymbolicLink()) fail("SYMLINK_OUTPUT_DIRECTORY");
    out = realpathSync(out);
    const pending = join(out, `.${archiveName}.${randomUUID()}.tmp`);
    try { copyFileSync(archive, pending); renameSync(pending, join(out, archiveName)); }
    finally { rmSync(pending, { force: true }); }
    writeFileSync(join(out, `oshideck-${manifest.version}.manifest.json`), JSON.stringify(report, null, 2) + "\n");
    return { archive: join(out, archiveName), report };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--out" || !args[1])) fail("USAGE: node tools/build-release.mjs [--out <directory>]");
    const built = buildRelease(args.length ? { out: args[1] } : {});
    console.log(`Built ${relative(DEFAULT_ROOT, built.archive)}: ${built.report.files} files, ${built.report.presets} sets, ${built.report.cards} cards`);
    console.log(`ZIP ${built.report.archiveBytes} bytes; SHA-256 ${built.report.sha256}`);
  } catch (error) {
    console.error(`FAIL ${error instanceof ReleaseBuildError ? error.message : error.code || "BUILD_FAILED"}`);
    process.exitCode = 1;
  }
}
