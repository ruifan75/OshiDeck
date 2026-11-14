// Real CSS contrast regression check. Run: npm run test:theme
// Set CHROME_BIN when Chrome/Chromium is installed outside these paths.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const chrome = process.env.CHROME_BIN || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"
].find(existsSync);
if (!chrome) throw new Error("Chrome is required for test:theme; set CHROME_BIN");
const dir = mkdtempSync(join(tmpdir(), "oshideck-theme-"));
const css = readFileSync(process.env.OD_CSS || new URL("../content.css", import.meta.url), "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body><div id="oshideck-root">
<div class="od-bar"><span class="od-channel">頻道 Channel</span>
<span class="od-common">共通</span><span class="od-peek">Preview</span>
<span class="od-bar-line">Empty deck</span><button class="od-text-button">編輯</button>
<button class="od-pool-tab" data-current>Pool</button></div>
<div class="od-card" data-size="large"><button class="od-card-play">
<span class="od-card-body">測試 Test</span></button><div class="od-card-tools">
<button class="od-icon-button">+</button></div></div>
<div class="od-card" data-size="large"><button class="od-card-play">
<span class="od-card-body" data-length="long">Long card</span></button></div>
<div class="od-listcard"><button class="od-listcard-play">清單 List <span class="od-times">×2</span></button></div>
<span class="od-peek" data-warning>Warning</span><button class="od-notice-action">Undo</button>
</div><div class="od-save-menu"><div class="od-save-heading">Save to</div>
<button class="od-target"><span class="od-target-label">Channel</span>
<span class="od-target-detail">Detail</span></button></div>
<div class="od-grab"><button class="od-grab-plus">+</button></div><pre id="report"></pre>
<script>
const failures = [], results = [];
const root = document.querySelector('#oshideck-root');
const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
const colors = new Map();
function rgba(color) {
  if (colors.has(color)) return colors.get(color);
  ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
  const value = [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v);
  colors.set(color, value);
  return value;
}
function over(fg, bg) { return fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])); }
function luminance(rgb) {
  return rgb.slice(0, 3).reduce((sum, v, i) => {
    v /= 255; return sum + [0.2126, 0.7152, 0.0722][i] * (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  }, 0);
}
function contrast(a, b) {
  const l = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l[0] + .05) / (l[1] + .05);
}
function check(label, condition) { if (!condition) failures.push(label); }
function background(el, page) {
  if (!el || el === document.body) return page;
  const style = getComputedStyle(el);
  const base = over(rgba(style.backgroundColor), background(el.parentElement, page));
  const stops = style.backgroundImage.match(/rgb[a]?[\\(][^)]*\\)/g);
  if (!stops) return base;
  const painted = stops.map((stop) => over(rgba(stop), base)).sort((a, b) => luminance(a) - luminance(b));
  return document.documentElement.hasAttribute('dark') ? painted.at(-1) : painted[0];
}
for (const hostVars of [false, true]) {
  for (const dark of [false, true, false]) {
    document.documentElement.toggleAttribute('dark', dark);
    const page = dark ? [15,15,15] : [255,255,255];
    document.body.style.background = dark ? '#0f0f0f' : '#fff';
    for (const [name, value] of Object.entries({
      '--yt-live-chat-primary-text-color': dark ? '#f1f1f1' : '#0f0f0f',
      '--yt-live-chat-secondary-text-color': dark ? '#aaa' : '#606060',
      '--yt-live-chat-background-color': dark ? '#0f0f0f' : '#fff'
    })) {
      if (hostVars) document.documentElement.style.setProperty(name, value);
      else document.documentElement.style.removeProperty(name);
    }
    const label = (dark ? 'dark' : 'light') + (hostVars ? ' host' : ' fallback');
    let minimum = Infinity;
    for (const mode of ['hand', 'list']) {
      root.dataset.mode = mode;
      for (const hue of [0, 60, 120, 180, 240, 320]) {
        root.style.setProperty('--od-scope-hue', hue);
        for (const el of document.querySelectorAll('.od-channel,.od-common,.od-peek,.od-bar-line,.od-text-button,.od-pool-tab,.od-listcard-play,.od-times,.od-notice-action,.od-target-label,.od-target-detail,.od-save-heading,.od-grab-plus')) {
          const ratio = contrast(rgba(getComputedStyle(el).color), background(el, page));
          minimum = Math.min(minimum, ratio);
          check(label + ' ' + mode + ' ' + el.className + ' contrast ' + ratio.toFixed(2), ratio >= 4.5);
        }
      }
      for (const card of document.querySelectorAll('.od-card')) {
        // Both ends of the actual rendered gradient must support the card text.
        const stops = getComputedStyle(card).backgroundImage.match(/rgb[a]?[\\(][^)]*\\)/g) || [];
        check(label + ' card has gradient', stops.length === 2);
        for (const stop of stops) {
          const text = card.querySelector('.od-card-body');
          const ratio = contrast(rgba(getComputedStyle(text).color), rgba(stop));
          check(label + ' card text contrast ' + ratio.toFixed(2), ratio >= 4.5);
          const icon = card.querySelector('.od-icon-button');
          if (icon) check(label + ' tool icon contrast', contrast(rgba(getComputedStyle(icon).color), over(rgba(getComputedStyle(icon).backgroundColor), rgba(stop))) >= 4.5);
        }
      }
    }
    results.push(label + ': minimum text contrast ' + minimum.toFixed(2));
  }
}
document.querySelector('#report').textContent = JSON.stringify({ failures, results });
</script></body></html>`;
try {
  const fixture = join(dir, "theme.html");
  writeFileSync(fixture, html);
  const result = spawnSync(chrome, ["--headless", "--no-sandbox", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", "--disable-background-networking", "--disable-component-update",
    `--user-data-dir=${join(dir, "profile")}`, "--dump-dom", pathToFileURL(fixture).href],
  { encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error([result.error?.message, result.stderr].filter(Boolean).join("\n"));
  const report = result.stdout.match(/<pre id="report">([^<]+)<\/pre>/)?.[1];
  if (!report) throw new Error("Browser did not produce a theme report");
  const { failures, results } = JSON.parse(report.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  for (const line of results) console.log(line);
  if (failures.length) throw new Error(failures.join("\n"));
  console.log("ok   live light/dark switches, host colours and fallbacks, cards/list/menu/grab");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
