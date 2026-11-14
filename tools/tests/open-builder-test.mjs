// Follow the real chat click through the worker URL into the real builder.
import { contentPage, CHANNEL } from "./content-page.mjs";
import { backgroundPage } from "./background-page.mjs";
import { optionsPage } from "./options-page.mjs";
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; console.log(`${ok ? "ok   " : "FAIL "}${label}`); };
const OTHER = "UC" + "b".repeat(22);
const worker = backgroundPage();
const mutate = (op, args) => worker.send({ type: "mutate", op, args });
await mutate("ensureDeck", { channelId: OTHER, name: "Other deck" });
const chat = await contentPage({ preset: false });
try {
  const button = chat.root.querySelector('[aria-label="Open the deck builder"]');
  check("even an empty chat deck offers the builder", !!button);
  button.click();
  await chat.advance();
  const message = chat.messages.findLast((m) => m.type === "openOptions");
  check("the chat sends its channel with the builder request", message?.channelId === CHANNEL);
  const reply = await worker.send({ ...message, name: "Current channel" });
  const opened = worker.opened.at(-1);
  const url = new URL(opened?.url);
  check("the worker opens the builder with this channel selected",
    reply.ok && url.pathname === "/options.html" && url.searchParams.get("channel") === CHANNEL);
  check("opening an unsaved channel creates an empty named deck",
    worker.read().decks[CHANNEL]?.length === 0 && worker.read().channelMeta[CHANNEL]?.name === "Current channel");
  await worker.settle();
  check("opening a channel deck remains visible in diagnostics",
    worker.read().journal?.some((entry) => entry.kind === "operation" && entry.op === "ensureDeck" && entry.status === "ok"));
  const page = await optionsPage({ url: `https://extension.test${url.pathname}${url.search}`, initialData: worker.read() });
  try {
    const active = () => page.document.querySelector('.deck-row[data-on] .deck-name')?.textContent;
    check("the linked deck wins over the first saved deck", active() === "Current channel" &&
      page.document.querySelector("#deckHeader strong")?.textContent === "Current channel");
    check("the new deck is ready to receive cards", !!page.document.querySelector("#deckCards .muted"));
    page.document.querySelector(".deck-row").click(); await page.settle();
    await page.window.OshiDeck.store.runOp("setSettings", { patch: { rows: 1 } }); await page.settle();
    check("a later storage refresh preserves a deck chosen manually", active() === "Other deck");
  } finally { page.close(); }
  await mutate("addCard", { channelId: CHANNEL, scope: CHANNEL,
    card: { id: "held", tokens: [{ type: "text", value: "keep this card" }] } });
  await mutate("setChannel", { channelId: CHANNEL, color: "#1234AB", name: "Custom name" });
  await worker.send({ type: "openOptions", channelId: CHANNEL, name: "Incoming name" });
  check("reopening preserves cards, custom name and colour",
    worker.read().decks[CHANNEL]?.includes("held") && worker.read().channelMeta[CHANNEL]?.color === "#1234AB" &&
    worker.read().channelMeta[CHANNEL]?.name === "Custom name");
  await Promise.all([
    worker.send({ type: "openOptions", channelId: CHANNEL }),
    mutate("addCard", { channelId: CHANNEL, scope: CHANNEL,
      card: { id: "racing", tokens: [{ type: "text", value: "saved while opening" }] } })
  ]);
  check("a concurrent chat save survives opening the builder", worker.read().decks[CHANNEL]?.includes("racing"));
  for (const channelId of [undefined, "__proto__", "https://example.invalid/"]) {
    await worker.send({ type: "openOptions", channelId });
    check("a missing or invalid channel opens general settings", worker.opened.at(-1)?.options === true);
  }
  for (const value of [OTHER, "UC" + "z".repeat(22), "__proto__", ""]) {
    const p = await optionsPage({ url: `https://extension.test/options.html?channel=${value}`, initialData: worker.read() });
    try {
      check("known links select their deck; stale or invalid links fall back safely",
        p.document.querySelector('.deck-row[data-on] .deck-name')?.textContent === "Other deck");
    } finally { p.close(); }
  }
  const broken = backgroundPage(); broken.faults.read = true;
  const refused = await broken.send({ type: "openOptions", channelId: CHANNEL });
  check("a failed deck read does not open a misleading builder", !refused.ok && broken.opened.length === 0);
} catch (error) { check(error.stack, false); }
finally { chat.close(); }
process.exitCode = failures ? 1 : 0;
