import assert from "node:assert/strict";
import { optionsPage } from "./options-page.mjs";

const page = await optionsPage({ consent: false });
try {
  assert.equal(page.document.querySelector("#appSettings").hidden, true);
  assert.equal(page.document.querySelector("#privacySetup").hidden, false);
  assert.match(page.document.querySelector("#privacyEnable").textContent, /同意/);
  assert.deepEqual(page.reads, ["privacyConsent"], "Only consent is read before agreement");
  assert.equal(page.logs.length, 0, "Diagnostics wait for agreement");

  page.document.querySelector("#privacyEnable").click();
  await page.settle();
  assert.equal(page.document.querySelector("#appSettings").hidden, false);
  assert.equal(page.document.querySelector("#privacySetup").hidden, true);
  assert.ok(page.reads.includes("cards"));
  assert.match(page.document.querySelector("#deckList").textContent, /彩雲のの/);
  console.log("ok   settings disclose local use before accessing cards or recording diagnostics");
} finally {
  page.close();
}
