globalThis.OshiDeck = { tokens: { collectTokens: () => [], harvestEmoji: () => {} } };
globalThis.Node = { ELEMENT_NODE: 1 };
globalThis.document = { querySelector: () => null };
require("../../src/trending.js");
const { signature } = globalThis.OshiDeck.trending;

const t = (s) => [{ type: "text", value: s }];
const CH = "UCaaaaaaaaaaaaaaaaaaaaaa/heart";
const e = (...ids) => ids.map((id) => ({ type: "youtubeEmoji", emojiId: id }));

let fail = 0;
const same = (label, variants) => {
  const sigs = variants.map(signature);
  const ok = new Set(sigs).size === 1;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label.padEnd(14)} ${JSON.stringify(sigs)}`);
};
const differ = (label, a, b) => {
  const ok = signature(a) !== signature(b);
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
};

console.log("--- same reaction should collapse to one signature ---");
same("拍手",       [t("8"), t("888"), t("88888888888")]);
same("コール",     [t("はいはいはいはい"), t("はい！はい！はい！はい！"), t("はい はい")]);
same("わこつ",     [t("わこつ"), t("わこつ〜"), t("わこつ！！！")]);
same("メン限連打", [e(CH), e(CH, CH), e(CH, CH, CH, CH)]);
same("公開絵文字", [e(":purple:"), e(":purple:", ":purple:", ":purple:")]);
same("推しコール", [t("\u{1F426}\u{200D}\u{1F525}\u26E9"), t("\u{1F426}\u{200D}\u{1F525}\u26E9\u{1F426}\u{200D}\u{1F525}\u26E9")]);
same("混在",       [t("すごい"), t("すごい。。。")]);

console.log("\n--- different reactions must stay apart ---");
differ("888 vs おつ",            t("888"), t("おつ"));
differ("メン限 vs 公開の絵文字",  e(CH), e(":purple:"));
same("はい系",       [t("はい"), t("はいはい"), t("はい！はい！はい！はい！")]);
differ("わこつ vs うぽつ",        t("わこつ"), t("うぽつ"));

console.log("\n--- ranking window ---");
process.exit(fail);
