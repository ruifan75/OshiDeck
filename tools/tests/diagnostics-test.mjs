// Exercise the actual writer, content script and options page. Reports must
// explain the outcome without retaining wording or changing an action's result.
import { backgroundPage } from "./background-page.mjs";
import { contentPage, CHANNEL } from "./content-page.mjs";
import { optionsPage } from "./options-page.mjs";
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "ok   " : "FAIL "}${label}`); };
const secret = "private-chat-wording-and-filename";
const card = (id = secret) => ({ id, scope: CHANNEL, tokens: [{ type: "text", value: secret }] });
const write = (p, op, args) => p.send({ type: "mutate", op, args });

try {
  const p = backgroundPage();
  const added = await write(p, "addCard", { channelId: CHANNEL, scope: CHANNEL, card: card() });
  const reused = await write(p, "addCard", { channelId: CHANNEL, scope: CHANNEL, card: card("other-id") });
  await p.settle();
  let report = await p.send({ type: "journal", read: true });
  const ops = (report.value || []).filter((e) => e.kind === "operation");
  check("the real worker records successful and reused saves", added.ok && reused.ok &&
    ops.some((e) => e.op === "addCard" && e.status === "ok" && e.duplicate === false) &&
    ops.some((e) => e.op === "addCard" && e.duplicate === true));
  check("operation logs use card aliases and never copy wording or ids", ops.length >= 2 && ops.every((e) => /^c\d+$/.test(e.card)) && ops[0].card === ops[1].card &&
    !JSON.stringify(report).includes(secret));
  await write(p, "setSettings", { patch: { mode: "list", hold: 12345, autoSend: true } });
  await p.settle();
  report = await p.send({ type: "journal", read: true });
  check("settings snapshots contain the applied settings", report.states.some((e) => e.kind === "settings" &&
    e.settings.mode === "list" && e.settings.hold === 12345 && e.settings.autoSend === true));
  const rejected = await write(p, "editCard", { id: secret, tokens: [null] });
  p.faults.cards = true;
  const failed = await write(p, "setSettings", { patch: { folded: true } });
  await p.settle();
  p.faults.cards = false;
  report = await p.send({ type: "journal", read: true });
  check("operation refusal and failed storage writes have distinct reasons", !rejected.ok && !failed.ok &&
    report.value.some((e) => e.op === "editCard" && e.reason === "rejected" && e.status === "failed") &&
    report.value.some((e) => e.op === "setSettings" && e.reason === "storage-write" && e.status === "failed"));
  p.faults.read = true;
  const unreadable = await write(p, "setSettings", { patch: { folded: false } });
  await p.settle();
  p.faults.read = false;
  report = await p.send({ type: "journal", read: true });
  check("failed storage reads remain diagnosable from the pending log", !unreadable.ok &&
    report.value.some((e) => e.op === "setSettings" && e.reason === "storage-read"));
  check("prototype operation names cannot select an inherited branch",
    (await write(p, "toString", {})).reason === "unknown-op");

  p.faults.log = true;
  const stillSaved = await write(p, "setSettings", { patch: { rows: 1 } });
  await p.settle();
  report = await p.send({ type: "journal", read: true });
  check("a failed diagnostic write does not fail a successful user action", stillSaved.ok && p.read().settings.rows === 1);
  check("an unpersisted diagnostic is still exportable", report.value.some((e) => e.op === "setSettings" && e.status === "ok") &&
    report.states.some((e) => e.kind === "settings" && e.settings.rows === 1));
  p.faults.log = false;
  await write(p, "setSettings", { patch: { rows: 2 } });
  await p.settle();
  check("the next successful diagnostic write retries the pending batch",
    p.read().journalState.some((e) => e.kind === "settings" && e.settings.rows === 2) &&
    p.read().journal.some((e) => e.kind === "settings" && e.settings.rows === 1));
  p.faults.clear = true;
  const notCleared = await p.send({ type: "journal", clear: true });
  p.faults.clear = false;
  check("a failed clear does not discard diagnostics", !notCleared.ok && (await p.send({ type: "journal", read: true })).value.length > 0);
  await p.send({ type: "journal", clear: true });
  report = await p.send({ type: "journal", read: true });
  check("clearing diagnostics clears entries snapshots and pending data", report.value.length === 0 && report.states.length === 0);
  p.journal.record({ kind: "settings", settings: { mode: "list", hold: 12345, autoSend: true, rows: 2 } });
  await p.settle();
  check("clearing diagnostics allows an unchanged state to be recorded again", p.read().journal.some((e) => e.kind === "settings"));
} catch (error) { check(`worker: ${error.stack}`, false); }

try {
  const p = backgroundPage();
  const release = p.pauseLog();
  await write(p, "setSettings", { patch: { rows: 1 } });
  await p.settle();
  const second = write(p, "setSettings", { patch: { rows: 2 } });
  const result = await Promise.race([second, new Promise((done) => setTimeout(() => done(null), 150))]);
  release(); await second; await p.settle();
  check("a stalled diagnostic write cannot block the next card operation", result?.ok && p.read().settings.rows === 2);
} catch (error) { check(`independent queue: ${error.stack}`, false); }

try {
  const p = backgroundPage();
  p.journal.record({ kind: "panel", reason: "empty" }); await p.settle();
  const release = p.pauseClear();
  const clearing = p.send({ type: "journal", clear: true });
  await p.settle();
  await write(p, "setSettings", { patch: { rows: 1 } });
  release(); await clearing; await p.settle();
  const report = await p.send({ type: "journal", read: true });
  check("clearing diagnostics preserves operations that arrive during the clear", report.value.some((e) => e.op === "setSettings") &&
    report.states.some((e) => e.kind === "settings" && e.settings.rows === 1) && !report.states.some((e) => e.kind === "panel"));
} catch (error) { check(`concurrent clear: ${error.stack}`, false); }

try {
  const p = backgroundPage({ files: { "presets/index.json": { presets: [
    { channel: CHANNEL, file: `${CHANNEL}.json` }
  ] }, [`presets/${CHANNEL}.json`]: { format: 2, channel: CHANNEL, name: secret,
    cards: [{ scope: "channel", tokens: [null] }] } } });
  await p.send({ type: "presets", channelId: CHANNEL });
  await p.send({ type: "presets", channelId: "UCbbbbbbbbbbbbbbbbbbbbbb" });
  await p.settle();
  const entries = (await p.send({ type: "journal", read: true })).value;
  check("an invalid bundled preset differs from an absent preset", entries.some((e) => e.status === "invalid" && e.code?.startsWith("validation.")) &&
    entries.some((e) => e.status === "absent"));
  check("preset validation does not log a preset name or token contents", !JSON.stringify(entries).includes(secret));
  const missing = backgroundPage();
  await missing.send({ type: "presets", channelId: CHANNEL });
  await missing.settle();
  check("an unreadable preset index is recorded distinctly", (await missing.send({ type: "journal", read: true })).value
    .some((e) => e.status === "index-unreadable"));
} catch (error) { check(`presets: ${error.stack}`, false); }

try {
  const p = backgroundPage();
  const j = p.journal;
  j.record({ kind: "panel", reason: "empty", channelId: CHANNEL });
  j.record({ kind: "colour", colourSource: "automatic", channelId: CHANNEL });
  j.record({ kind: "panel", reason: "empty", channelId: CHANNEL });
  await p.settle();
  check("alternating unchanged observations do not flood the log", p.read().journal.filter((e) => e.kind === "panel").length === 1);
  const payload = JSON.parse('{"kind":"error","what":"uncaught","name":"'+secret+'","message":"'+secret+'","tokens":["'+secret+'"],"toString":"'+secret+'","__proto__":{"color":"'+secret+'"}}');
  j.record(payload);
  j.record({ kind: "draw", reason: "below-min", messages: 1 });
  j.record({ kind: "draw", reason: "below-min", messages: 2 });
  j.record({ kind: "draw", reason: "holding", hits: 6 });
  await p.settle();
  const entries = p.read().journal;
  check("diagnostics whitelist fields even for prototype names", entries.some((e) => e.kind === "error" && e.what === "uncaught") &&
    !JSON.stringify(entries).includes(secret));
  check("draw counter changes are sampled but changed decisions are immediate", entries.filter((e) => e.kind === "draw").length === 2 &&
    entries.some((e) => e.kind === "draw" && e.reason === "holding"));
  j.record({ kind: "draw", reason: "holding", card: "c1", hits: 6 });
  j.record({ kind: "draw", reason: "holding", card: "c2", hits: 6 });
  j.record({ kind: "draw", reason: "below-min", min: 6, messages: 1 });
  j.record({ kind: "draw", reason: "below-min", min: 8, messages: 1 });
  await p.settle();
  check("a new held card or changed threshold bypasses draw sampling", ["c1", "c2"].every((card) =>
    p.read().journal.some((e) => e.kind === "draw" && e.card === card)) && [6, 8].every((min) =>
    p.read().journal.some((e) => e.kind === "draw" && e.min === min)));
  for (let i = 0; i < 400; i++) j.record({ kind: "play", status: "filled", card: j.cardId(`drawn:${secret}${i}`) });
  await p.settle();
  check("the expanded log is capped and keeps its last state separately", p.read().journal.length === j.LIMIT &&
    p.read().journalState.some((e) => e.kind === "panel" && e.reason === "empty"));
} catch (error) { check(`policy: ${error.stack}`, false); }

for (const mode of ["hand", "list"]) {
  const p = await contentPage({ mode, cards: [secret], preset: false });
  try {
    check(`${mode}: the real panel logs its rendered state and environment`, p.logs.some((e) => e.kind === "panel" && e.reason === "ready" && e.shown === 1) &&
      p.logs.some((e) => e.kind === "environment" && e.settings.mode === mode));
    await p.settings({ folded: true });
    check(`${mode}: folding records the effective panel state`, p.logs.some((e) => e.kind === "panel" && e.reason === "folded"));
    await p.settings({ folded: false });
    const play = p.root.querySelector(mode === "hand" ? ".od-card-play" : ".od-listcard-play");
    play.click(); await p.advance();
    check(`${mode}: playing records input without claiming delivery`, p.logs.some((e) => e.kind === "play" && e.status === "filled") &&
      !p.logs.some((e) => e.kind === "play" && e.status === "clicked"));
    p.comment("private-below-floor-phrase"); await p.advance(4500);
    check(`${mode}: the draw log explains a wave below its minimum`, p.logs.some((e) => e.kind === "draw" &&
      e.reason === "below-min" && e.min === 6 && e.maxCount === 1));
    await p.draw("another-private-drawn-phrase");
    check(`${mode}: a burst records its hold without retaining wording`, p.logs.some((e) => e.kind === "draw" && e.reason === "holding" && e.hits === 6) &&
      !JSON.stringify(p.logs).includes("another-private-drawn-phrase") && !JSON.stringify(p.logs).includes(secret));
    await p.settings({ suggest: false });
    check(`${mode}: disabled suggestions explain why no card is drawn`, p.logs.some((e) => e.kind === "draw" && e.reason === "disabled"));
    let clicks = 0;
    const send = p.document.createElement("yt-button-renderer");
    send.id = "send-button";
    const button = p.document.createElement("button");
    button.addEventListener("click", () => clicks++);
    send.append(button);
    p.document.querySelector("yt-live-chat-message-input-renderer").append(send);
    const press = () => p.root.querySelector(mode === "hand" ? ".od-card-play" : ".od-listcard-play")
      .dispatchEvent(new p.window.MouseEvent("click", { shiftKey: true, bubbles: true }));
    press(); await p.advance(1000);
    check(`${mode}: a send log means the real button was clicked`, clicks === 1 && p.logs.some((e) => e.kind === "play" && e.status === "clicked"));
    button.disabled = true;
    press(); await p.advance(1000);
    check(`${mode}: an unavailable send button records a timeout`, clicks === 1 && p.logs.some((e) => e.kind === "play" && e.status === "timeout"));
    const error = new p.window.TypeError(secret);
    p.window.dispatchEvent(new p.window.ErrorEvent("error", { error, message: secret,
      filename: "chrome-extension://fixture/content.js", lineno: 44, colno: 8 }));
    check(`${mode}: unexpected errors keep the code location without their message`, p.logs.some((e) => e.kind === "error" &&
      e.what === "uncaught" && e.file === "content.js" && e.line === 44) && !JSON.stringify(p.logs).includes(secret));
  } catch (error) { check(`${mode}: ${error.stack}`, false); }
  finally { p.close(); }
}

const busy = await contentPage({ preset: false });
try {
  for (let i = 0; i < 6; i++) busy.comment("below share");
  for (let i = 0; i < 24; i++) busy.comment(`other reaction ${i}`);
  await busy.advance(4500);
  check("the draw summary distinguishes a small share from a small count", busy.logs.some((e) => e.kind === "draw" &&
    e.reason === "below-share" && e.messages === 30 && e.belowShare === 1 && e.belowMin === 24));
} catch (error) { check(`burst: ${error.stack}`, false); }
finally { busy.close(); }

const owned = await contentPage({ cards: [secret], preset: false });
try {
  for (let i = 0; i < 6; i++) owned.comment(secret);
  await owned.advance(4500);
  check("an existing card is named as the reason a burst was refused", owned.logs.some((e) => e.kind === "draw" &&
    e.reason === "ineligible" && e.owned === 1 && e.ineligible === 1));
} catch (error) { check(`owned: ${error.stack}`, false); }
finally { owned.close(); }

const member = await contentPage({ preset: false });
try {
  const chip = member.document.createElement("yt-live-chat-author-chip");
  member.document.querySelector("yt-live-chat-message-input-renderer").append(chip);
  for (const owner of [CHANNEL, "UCbbbbbbbbbbbbbbbbbbbbbb"]) for (let i = 0; i < 6; i++) {
    const row = member.comment("");
    const image = member.document.createElement("img");
    image.setAttribute("data-emoji-id", `${owner}/private-emoji`);
    image.setAttribute("alt", secret);
    row.querySelector("#message").append(image);
  }
  await member.advance(4500);
  check("membership and wrong-channel refusals have separate counters", member.logs.some((e) => e.kind === "draw" &&
    e.reason === "ineligible" && e.membership === "no" && e.membershipBlocked === 1 && e.elsewhereBlocked === 1) &&
    !JSON.stringify(member.logs).includes(secret));
} catch (error) { check(`membership: ${error.stack}`, false); }
finally { member.close(); }

const o = await optionsPage();
try {
  const originalPicker = o.document.querySelector(".hue-pick");
  const countSays = () => o.document.querySelector("#journalStatus").textContent === o.window.OshiDeck.i18n.t("opt.journalCount", o.logs.length);
  check("the initial diagnostic count cannot be overwritten by an older read", countSays());
  const input = o.document.querySelector("#importFile");
  Object.defineProperty(input, "files", { configurable: true, value: [{ name: secret, text: async () => "not json" }] });
  input.dispatchEvent(new o.window.Event("change", { bubbles: true })); await o.settle();
  check("the real file reader logs invalid JSON without the filename", o.logs.some((e) => e.kind === "file" && e.source === "backup" && e.reason === "invalid-json") &&
    !JSON.stringify(o.logs).includes(secret));
  Object.defineProperty(input, "files", { configurable: true, value: [{ name: secret, text: async () => JSON.stringify({ cards: [null] }) }] });
  input.dispatchEvent(new o.window.Event("change", { bubbles: true })); await o.settle();
  check("the real file reader records the validation code", o.logs.some((e) => e.kind === "file" && e.code === "validation.cardInvalid"));
  check("new diagnostics update the count without rebuilding the builder", countSays() && o.document.querySelector(".hue-pick") === originalPicker);
  let downloaded;
  o.window.Blob = Blob;
  o.window.URL.createObjectURL = (blob) => { downloaded = blob; return "blob:fixture"; };
  o.window.URL.revokeObjectURL = () => {};
  o.window.HTMLAnchorElement.prototype.click = () => {};
  o.document.querySelector("#journalBtn").click(); await o.settle();
  const text = downloaded ? await downloaded.text() : "";
  const disclosure = o.window.OshiDeck.i18n.t("ui.journalPrivacy");
  check("the options page and actual export disclose identifiers and membership", text.includes(disclosure) &&
    o.document.querySelector('[data-i18n="ui.journalPrivacy"]')?.textContent === disclosure);
  const current = text.split("書き出し時の状態:\n")[1]?.split("\n\n")[0] || "";
  check("the real export includes a current settings snapshot", current.includes('"mode":"hand"') && current.includes("environment"));
  check("the exported report excludes file and chat contents", !!text && !text.includes(secret));
} catch (error) { check(`options: ${error.stack}`, false); }
finally { o.close(); }
process.exitCode = failures ? 1 : 0;
