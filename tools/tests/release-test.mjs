// Exercise real ZIPs with private working files beside the runtime sources.
// unzip is an independent reader; the assertions do not reuse the packager's
// ZIP directory parser or its list of permitted output entries.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { JSDOM } from "jsdom";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";

const root = new URL("../..", import.meta.url).pathname;
const subject = process.env.OD_RELEASE || new URL("../build-release.mjs", import.meta.url).pathname;
const { buildRelease } = await import(pathToFileURL(subject).href);
const base = mkdtempSync(join(tmpdir(), "oshideck-release-test-"));
const channel = `UC${"a".repeat(22)}`;
let failed = 0, sequence = 0;
const check = (label, ok) => { if (!ok) failed++; console.log(`${ok ? "ok   " : "FAIL "}${label}`); };
const write = (folder, file, data) => {
  const path = join(folder, file); mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data));
};
function fixture() {
  const dir = join(base, `case-${sequence++}`); mkdirSync(dir);
  // Derive actual runtime dependencies from Chrome's manifest and the options
  // document, with the worker's transitive readers included explicitly here.
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const files = new Set(["manifest.json", manifest.background.service_worker, manifest.options_page,
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((s) => [...s.js, ...s.css]), "src/backup.js", "src/vault.js"]);
  const dom = new JSDOM(readFileSync(join(root, "options.html"), "utf8"));
  for (const el of dom.window.document.querySelectorAll("script[src], link[rel=stylesheet]")) files.add(el.getAttribute("src") || el.getAttribute("href"));
  dom.window.close();
  for (const file of files) { mkdirSync(dirname(join(dir, file)), { recursive: true }); copyFileSync(join(root, file), join(dir, file)); }
  write(dir, "tools/hooks/public-names.tsv", readFileSync(join(root, "tools/hooks/public-names.tsv")));
  write(dir, "presets/index.json", { format: 2, presets: [{ channel, file: `${channel}.json` }] });
  write(dir, `presets/${channel}.json`, { format: 2, name: "Example channel", channel,
    cards: [{ scope: "channel", tokens: [{ type: "text", value: "hello" }] }] });
  for (const file of ["YT_subscribe.csv", ".DS_Store", "nijipuka.jpg", "chat-private/raw.json", "node_modules/private.js", ".git/config", "src/private-notes.txt", "presets/unindexed.json"]) write(dir, file, "private fixture data");
  return dir;
}
function refused(dir, code) {
  try { buildRelease({ root: dir }); return false; }
  catch (error) { return error.code === code; }
}
const unpack = (zip, file) => execFileSync("unzip", ["-p", zip, file]);
// Stub the OS lookup only; never replace HOME or write the real account name.
function asAccount(account, work) {
  const original = os.homedir;
  os.homedir = () => join(base, account);
  syncBuiltinESMExports();
  try { return work(); }
  finally { os.homedir = original; syncBuiltinESMExports(); }
}
const approve = (dir, file, line) => write(dir, "tools/hooks/public-names.tsv",
  `${file}\t${createHash("sha256").update(line).digest("hex")}\n`);
function publicNameFixture(name = "FixturePerson") {
  const dir = fixture(), file = `presets/${channel}.json`;
  const raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
  raw.name = name;
  const text = JSON.stringify(raw, null, 2) + "\n";
  write(dir, file, text);
  approve(dir, file, text.split("\n")[2]);
  return { dir, file, text };
}

try {
  const dir = fixture();
  const built = buildRelease({ root: dir, out: join(dir, "first") });
  const names = execFileSync("unzip", ["-Z1", built.archive], { encoding: "utf8" }).trim().split("\n");
  const privateNames = ["YT_subscribe.csv", ".DS_Store", "nijipuka.jpg", "chat-private/", "node_modules/", ".git/", "tools/", "src/private-notes.txt", "presets/unindexed.json"];
  check("private workspace files stay out of a successful build", privateNames.every((p) => !names.some((n) => n === p || n.startsWith(p))));
  check("the manifest lives at the ZIP root", names.includes("manifest.json") && JSON.parse(unpack(built.archive, "manifest.json")).version === built.report.version);
  const index = JSON.parse(unpack(built.archive, "presets/index.json"));
  const preset = JSON.parse(unpack(built.archive, `presets/${channel}.json`));
  check("only indexed presets are bundled with their original contents", index.presets.length === 1 && preset.cards[0].tokens[0].value === "hello" && built.report.presets === 1 && built.report.cards === 1);
  const dom = new JSDOM(unpack(built.archive, "options.html").toString("utf8"));
  const resources = [...dom.window.document.querySelectorAll("script[src], link[rel=stylesheet]")].map((e) => e.getAttribute("src") || e.getAttribute("href"));
  check("the options page has every script and stylesheet it requests", resources.length > 0 && resources.every((file) => names.includes(file)));
  dom.window.close();
  const boot = join(base, "packaged-worker");
  write(boot, "package.json", { type: "module" });
  for (const file of names) write(boot, `extension/${file}`, unpack(built.archive, file));
  let workerOpened = false;
  try {
    const folder = join(boot, "extension");
    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import {readFileSync} from 'node:fs';
      import {pathToFileURL,fileURLToPath} from 'node:url';
      import {webcrypto} from 'node:crypto';
      if(!globalThis.crypto)globalThis.crypto=webcrypto;
      const folder=${JSON.stringify(folder)}, base=pathToFileURL(folder+'/');let listener, consent;
      globalThis.chrome={runtime:{id:'release-fixture',getURL:p=>new URL(p,base).href,
        getManifest:()=>JSON.parse(readFileSync(new URL('manifest.json',base))),
        onMessage:{addListener:fn=>listener=fn}},action:{onClicked:{addListener(){}}},
        storage:{local:{get:async()=>({privacyConsent:consent}),set:async()=>{},remove:async()=>{}}}};
      globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(readFileSync(fileURLToPath(url)))});
      await import(new URL('background.js',base));
      const request=()=>new Promise(done=>listener({type:'presets',channelId:${JSON.stringify(channel)}},{},done));
      if((await request()).ok)throw Error('Worker data was available before consent');
      consent=1;
      const reply=await request();
      if(!reply.ok||reply.value.length!==1||reply.value[0].channel!==${JSON.stringify(channel)})throw Error('Preset not loaded');
    `], { stdio: "pipe" });
    workerOpened = true;
  } catch { /* the named assertion below must notice any missing dependency */ }
  check("the packaged worker loads its own modules and indexed preset", workerOpened);
  const mask = process.umask(0o077);
  let second;
  try { second = buildRelease({ root: dir, out: join(dir, "second") }); }
  finally { process.umask(mask); }
  check("the same inputs produce the same ZIP bytes", readFileSync(built.archive).equals(readFileSync(second.archive)));
  const digest = (data) => createHash("sha256").update(data).digest("hex");
  check("the checksum report identifies the actual archive and files", second.report.sha256 === built.report.sha256 &&
    digest(readFileSync(built.archive)) === built.report.sha256 && built.report.entries.length === names.length &&
    built.report.entries.every((f) => names.includes(f.path) &&
      digest(readFileSync(join(boot, "extension", f.path))) === f.sha256));

  const dependencies = [
    ["worker imports", "background.js", 'import "./src/private-extra.js";\n'],
    ["transitive imports", "src/journal.js", 'export { default as extra } from "./private-extra.js";\n'],
    ["options scripts", "options.html", '<script src="src/private-extra.js"></script>\n'],
    ["options stylesheets", "options.html", '<link rel="stylesheet" href="src/private-extra.css">\n'],
    ["HTML base elements", "options.html", '<base href="https://outside.invalid/">\n'],
    ["relative HTML base paths", "options.html", '<base href="src/">\n'],
    ["absolute resource URLs", "options.html", '<script src="https://oshideck.invalid/options.js"></script>\n'],
    ["protocol-relative resource URLs", "options.html", '<script src="//oshideck.invalid/options.js"></script>\n'],
    ["absolute base URLs sharing the parser origin", "options.html", '<base href="https://oshideck.invalid/">\n'],
    ["C0-prefixed script URLs", "options.html", '<script src="&#1;//oshideck.invalid/options.js"></script>\n'],
    ["C0-prefixed absolute script URLs", "options.html", '<script src="&#31;https://oshideck.invalid/options.js"></script>\n'],
    ["raw-control script URLs", "options.html", '<script src="\u0001//oshideck.invalid/options.js"></script>\n'],
    ["C0-prefixed stylesheet URLs", "options.html", '<link rel="stylesheet" href="&#1;//oshideck.invalid/options.css">\n'],
    ["stylesheet hrefs with misleading src attributes", "options.html", '<link rel="stylesheet" href="//oshideck.invalid/options.css" src="options.css">\n'],
    ["C0-prefixed base URLs", "options.html", '<base href="&#1;//oshideck.invalid/">\n'],
    ["raw-control base URLs", "options.html", '<base href="\u001fhttps://oshideck.invalid/">\n'],
    ["same-scheme references", "options.html", '<script src="https:options.js"></script>\n'],
    ["same-scheme base URLs", "options.html", '<base href="https:./">\n']
  ];
  for (const [label, file, prefix] of dependencies) {
    const dir = fixture();
    const original = readFileSync(join(dir, file), "utf8");
    write(dir, file, file.endsWith(".html") ? original.replace("<head>", `<head>${prefix}`) : prefix + original);
    write(dir, "src/private-extra.js", "export default 1;\n");
    write(dir, "src/private-extra.css", "body { color: red; }\n");
    check(`unlisted ${label} prevent publishing`, refused(dir, "UNLISTED_RUNTIME_DEPENDENCY") && !existsSync(join(dir, "dist")));
  }
  const quoted = fixture();
  write(quoted, "background.js", readFileSync(join(quoted, "background.js"), "utf8") +
    '\n// import "./comment.js";\nconst example = `import "./template.js"`;\n');
  write(quoted, "options.html", '<!-- <script src="ignored.js"></script> -->\n' +
    readFileSync(join(quoted, "options.html"), "utf8").replace('src="options.js"', 'data-example=">" src="options&#46;js?version=1#ready"'));
  let quotedBuild;
  try { quotedBuild = buildRelease({ root: quoted }); } catch { /* the assertion reports the failure */ }
  check("comments templates and HTML entities do not invent dependencies", !!quotedBuild);

  const localControl = fixture();
  write(localControl, "options.html", readFileSync(join(localControl, "options.html"), "utf8")
    .replace("<head>", '<head><base href="&#31;./">')
    .replace('src="options.js"', 'src="&#1;options.js?version=1#ready"'));
  let localBuild;
  try { localBuild = buildRelease({ root: localControl }); } catch { /* the assertion reports the failure */ }
  check("URL controls on references that stay local remain allowed", !!localBuild);

  // Keep these pages minimal: the normal head's stylesheets would already
  // reject a late base and hide the table's reversal of source/DOM order.
  for (const [label, markup, allowed] of [
    ["foster-parented base cannot hide a preceding script dependency",
      '<table><script src="i18n.js"></script><base href="src/"></table>', false],
    ["a base before a table script in the source remains supported",
      '<table><base href="src/"><script src="i18n.js"></script></table>', true]
  ]) {
    const dir = fixture();
    write(dir, "options.html", `<!doctype html><html><head><meta charset="utf-8"></head><body>${markup}</body></html>`);
    let built;
    if (allowed) {
      try { built = buildRelease({ root: dir }); } catch { /* named assertion below */ }
    }
    check(label, allowed ? !!built : refused(dir, "UNSUPPORTED_RUNTIME_HTML") && !existsSync(join(dir, "dist")));
  }

  // These are real Chrome parser differences, not fictitious script spellings.
  // Use the normal document structure so a rejection has to detect the actual
  // hidden reference (or explicitly refuse markup the tree builder discards).
  const externalLink = '<link rel="stylesheet" href="https://example.invalid/x.css">';
  const externalBase = '<base href="https://example.invalid/">';
  const hiddenResources = [
    ["noscript comment escape", "body", `<noscript><!--</noscript>${externalLink}--></noscript>`, "UNSUPPORTED_RUNTIME_HTML"],
    ["noscript base escape", "head", `<noscript><!--</noscript>${externalBase}--></noscript>`, "UNSUPPORTED_RUNTIME_HTML"],
    ["template noscript escape", "body", `<template><noscript><!--</noscript></template>${externalLink}<template>--></template>`, "UNLISTED_RUNTIME_DEPENDENCY"],
    ["select stylesheet", "body", `<select>${externalLink}</select>`, "UNSUPPORTED_RUNTIME_HTML"],
    ["select base", "body", `<select>${externalBase}</select>`, "UNSUPPORTED_RUNTIME_HTML"],
    ["open shadow stylesheet", "body", `<div><template shadowrootmode="open">${externalLink}</template></div>`, "UNLISTED_RUNTIME_DEPENDENCY"],
    ["closed shadow script", "body", '<div><template shadowrootmode="closed"><script src="src/unlisted.js"></script></template></div>', "UNLISTED_RUNTIME_DEPENDENCY"],
    ["nested template script", "body", '<template><template><script src="src/unlisted.js"></script></template></template>', "UNLISTED_RUNTIME_DEPENDENCY"],
    ["SVG href script", "body", '<svg><script href="src/unlisted.js"></script></svg>', "UNLISTED_RUNTIME_DEPENDENCY"],
    ["SVG xlink script", "body", '<svg><script xlink:href="src/unlisted.js"></script></svg>', "UNLISTED_RUNTIME_DEPENDENCY"],
    ["SVG href precedence", "body", '<svg><script href="src/unlisted.js" xlink:href="options.js"></script></svg>', "UNLISTED_RUNTIME_DEPENDENCY"],
    ["template base", "head", '<template><base href="./"></template>', "UNSUPPORTED_RUNTIME_HTML"],
    ["late base", "body", '<base href="./">', "UNSUPPORTED_RUNTIME_HTML"],
    ["multiple bases", "head", '<base href="./"><base href="./">', "UNSUPPORTED_RUNTIME_HTML"],
    ["unclosed raw text", "body", '<noscript>', "UNSUPPORTED_RUNTIME_HTML"]
  ];
  for (const [label, section, markup, code] of hiddenResources) {
    const dir = fixture(), original = readFileSync(join(dir, "options.html"), "utf8");
    write(dir, "options.html", original.replace(`<${section}>`, `<${section}>${markup}`));
    check(`${label} cannot hide a release dependency`, refused(dir, code) && !existsSync(join(dir, "dist")));
  }

  const inertHTML = fixture();
  const examples = `<noscript>${externalLink}<script src="unlisted.js"></script></noscript>
    <!-- ${externalLink} -->
    <div data-example='${externalLink}'>&lt;script src="unlisted.js"&gt;</div>
    <script>const example = '${externalLink}';</script>
    <textarea>${externalLink}</textarea>`;
  write(inertHTML, "options.html", readFileSync(join(inertHTML, "options.html"), "utf8").replace("<body>", `<body>${examples}`));
  let inertBuild;
  try { inertBuild = buildRelease({ root: inertHTML }); } catch { /* named assertion below */ }
  check("scripting-enabled noscript comments attributes and raw text stay inert", !!inertBuild);

  const localTemplates = fixture();
  write(localTemplates, "options.html", readFileSync(join(localTemplates, "options.html"), "utf8")
    .replace("<body>", `<body><template><link rel="stylesheet" href="options.css"></template>
      <div><template shadowrootmode="open"><script src="options.js"></script></template></div>
      <svg><script href="options.js"></script><script xlink:href="options.js"></script></svg>`));
  let templatesBuild;
  try { templatesBuild = buildRelease({ root: localTemplates }); } catch { /* named assertion below */ }
  check("local template shadow and SVG dependencies remain supported", !!templatesBuild);

  const utf8BOM = fixture();
  write(utf8BOM, "options.html", Buffer.concat([Buffer.from([239, 187, 191]), readFileSync(join(utf8BOM, "options.html"))]));
  let bomBuild;
  try { bomBuild = buildRelease({ root: utf8BOM }); } catch { /* named assertion below */ }
  check("UTF-8 HTML with a BOM remains supported", !!bomBuild);

  for (const [label, encode] of [
    ["UTF-16", (text) => Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, "utf16le")])],
    ["invalid UTF-8", (text) => Buffer.concat([Buffer.from(text), Buffer.from([255])])],
    ["legacy charset", (text) => text.replace('charset="utf-8"', 'charset="windows-1252"')],
    ["NUL", (text) => text + "\0"],
    ["oversized", (text) => text + " ".repeat(1024 * 1024)],
    ["excessive tag count", (text) => text.replace("<body>", "<body>" + "<span></span>".repeat(10001))]
  ]) {
    const dir = fixture(); write(dir, "options.html", encode(readFileSync(join(dir, "options.html"), "utf8")));
    check(`${label} HTML is explicitly refused`, refused(dir, "UNSUPPORTED_RUNTIME_HTML"));
  }

  const manifestDir = fixture(), manifest = JSON.parse(readFileSync(join(manifestDir, "manifest.json")));
  manifest.content_scripts[0].js.push("tools/private-helper.js");
  write(manifestDir, "manifest.json", manifest); write(manifestDir, "tools/private-helper.js", "// private fixture");
  check("unlisted manifest resources are refused", refused(manifestDir, "UNLISTED_MANIFEST_RESOURCE"));

  const missing = fixture(); unlinkSync(join(missing, "src/journal.js"));
  check("a missing worker dependency is reported before publishing", refused(missing, "MISSING_RUNTIME_FILE") && !existsSync(join(missing, "dist")));

  const link = fixture(), elsewhere = join(base, "linked-sources");
  renameSync(join(link, "src"), elsewhere); symlinkSync(elsewhere, join(link, "src"), "dir");
  check("symlinked runtime directories cannot supply package files", refused(link, "SYMLINK_RUNTIME_FILE"));

  const badIndex = fixture();
  write(badIndex, "presets/index.json", { format: 2, presets: [{ channel: [channel], file: `${channel}.json` }] });
  check("a channel id must be a string rather than a coercible array", refused(badIndex, "INVALID_PRESET_INDEX"));
  write(badIndex, "presets/index.json", { format: 2, presets: [{ channel, file: "../unindexed.json" }] });
  check("a preset filename cannot escape its indexed channel", refused(badIndex, "INVALID_PRESET_INDEX"));

  const empty = fixture(), raw = JSON.parse(readFileSync(join(empty, `presets/${channel}.json`)));
  raw.cards[0].tokens = []; write(empty, `presets/${channel}.json`, raw);
  check("empty cards are refused by the shipped preset validator", refused(empty, "INVALID_PRESET"));
  raw.cards[0].tokens = [null]; write(empty, `presets/${channel}.json`, raw);
  check("malformed tokens produce a validation error", refused(empty, "INVALID_PRESET"));

  const secretDir = fixture(), secret = `fixture-${randomUUID()}`;
  write(secretDir, ".env", `HOLODEX_API_KEY=${secret}\n`);
  write(secretDir, "content.js", readFileSync(join(secretDir, "content.js"), "utf8") + `\n// ${secret}\n`);
  let secretError;
  try { buildRelease({ root: secretDir }); } catch (error) { secretError = error; }
  check("a locally configured key never enters a package", secretError?.code === "PRIVATE_CONTENT" && !existsSync(join(secretDir, "dist")));
  check("a privacy refusal does not echo the key", !!secretError && !secretError.message.includes(secret));

  const personal = fixture(), comment = ["", "Users", "release-fixture", "project"].join("/");
  write(personal, "content.js", readFileSync(join(personal, "content.js"), "utf8") + `\n// ${comment}\n`);
  check("home directory paths cannot enter the ZIP", refused(personal, "PRIVATE_CONTENT"));
  const address = ["reader", "example.invalid"].join("@");
  write(personal, "content.js", readFileSync(join(root, "content.js"), "utf8") + `\n// ${address}\n`);
  check("private-looking addresses cannot enter the ZIP", refused(personal, "PRIVATE_CONTENT"));

  asAccount("fixtureperson", () => {
    const named = fixture(), accountText = "FixturePerson42";
    write(named, "options.js", readFileSync(join(named, "options.js"), "utf8") + `\n// ${accountText}\n`);
    let error;
    try { buildRelease({ root: named }); } catch (caught) { error = caught; }
    check("an uncommitted account name is refused before creating a ZIP", error?.code === "PRIVATE_CONTENT" && !existsSync(join(named, "dist")));
    check("an account-name refusal does not reveal the name", !!error && !error.message.toLowerCase().includes("fixtureperson"));

    const ordinary = fixture();
    write(ordinary, "options.js", readFileSync(join(ordinary, "options.js"), "utf8") + '\n// myfixtureperson is a longer word\n');
    let built;
    try { built = buildRelease({ root: ordinary }); } catch { /* named assertion below */ }
    check("an account substring inside a longer word stays allowed", !!built);

    const allowed = publicNameFixture();
    let approved;
    try { approved = buildRelease({ root: allowed.dir }); } catch { /* named assertion below */ }
    check("a reviewed public name remains allowed at its exact path and line", !!approved);

    const changed = publicNameFixture();
    const raw = JSON.parse(changed.text);
    raw.cards[0].tokens[0].value = "FixturePerson private note";
    write(changed.dir, changed.file, JSON.stringify(raw, null, 2) + "\n");
    check("a reviewed name line does not approve other lines in its preset", refused(changed.dir, "PRIVATE_CONTENT"));

    const moved = publicNameFixture();
    write(moved.dir, "options.js", readFileSync(join(moved.dir, "options.js"), "utf8") +
      '\nconst publicExample = {\n' + moved.text.split("\n")[2] + '\n};\n');
    check("a public-name approval cannot move to a different file", refused(moved.dir, "PRIVATE_CONTENT"));

    const bytes = fixture(), line = "// FixturePerson public example";
    approve(bytes, "options.js", line);
    write(bytes, "options.js", readFileSync(join(bytes, "options.js"), "utf8") + "\n" + line.replace("// ", "//\0") + "\n");
    check("public-name approval uses raw bytes before NUL normalisation", refused(bytes, "PRIVATE_CONTENT"));

    const withAddress = publicNameFixture("FixturePerson " + ["reader", "example.invalid"].join("@"));
    check("a public-name approval never exempts a private address", refused(withAddress.dir, "PRIVATE_CONTENT"));
  });
  asAccount("r.indev+", () => {
    const literal = fixture();
    write(literal, "options.js", readFileSync(join(literal, "options.js"), "utf8") + '\n// rXindevvv\n');
    let built;
    try { built = buildRelease({ root: literal }); } catch { /* named assertion below */ }
    check("account punctuation is literal rather than a regular expression", !!built);
    write(literal, "options.js", readFileSync(join(literal, "options.js"), "utf8") + '\n// r.indev+\n');
    check("a literal account with punctuation is still refused", refused(literal, "PRIVATE_CONTENT"));
  });
  const missingRules = fixture(); unlinkSync(join(missingRules, "tools/hooks/public-names.tsv"));
  check("missing public-name rules refuse the build", refused(missingRules, "INVALID_PUBLIC_NAME_RULES"));
  const badRules = fixture(); write(badRules, "tools/hooks/public-names.tsv", "not a valid rule\n");
  check("malformed public-name rules refuse the build", refused(badRules, "INVALID_PUBLIC_NAME_RULES"));

  const cli = fixture(), marker = `private-output-${randomUUID()}`, output = join(cli, marker);
  write(cli, "tools/build-release.mjs", readFileSync(subject, "utf8"));
  write(cli, marker, "an existing file");
  const alias = join(base, "cli-alias"); symlinkSync(join(cli, "tools"), alias, "dir");
  const cliFile = join(alias, "build-release.mjs"), cliOutput = join(cli, "cli-output");
  // The copied CLI has the same development dependency as the real tool;
  // runtime files in the ZIP must still work without node_modules.
  const cliEnv = { ...process.env, NODE_PATH: join(root, "node_modules") };
  const launched = spawnSync(process.execPath, [cliFile, "--out", cliOutput], { encoding: "utf8", env: cliEnv });
  check("the CLI builds when invoked through a path alias", launched.status === 0 && existsSync(join(cliOutput, `oshideck-${built.report.version}.zip`)));
  const response = spawnSync(process.execPath, [cliFile, "--out", output], { encoding: "utf8", env: cliEnv });
  check("unexpected CLI failures do not expose filesystem paths", response.status !== 0 && /^FAIL [A-Z_]+\s*$/.test(response.stderr) && !response.stderr.includes(marker));
  const missingDependency = spawnSync(process.execPath, [cliFile, "--out", join(cli, "without-dependencies")],
    { encoding: "utf8", env: { ...process.env, NODE_PATH: "" } });
  check("a missing build dependency fails without exposing local paths", missingDependency.status !== 0 &&
    missingDependency.stderr.trim() === "FAIL MISSING_BUILD_DEPENDENCY" && !existsSync(join(cli, "without-dependencies")));
} catch (error) {
  check("a clean runtime build finishes", false);
  console.log(error.code || error.name);
} finally { rmSync(base, { recursive: true, force: true }); }
process.exit(failed);
