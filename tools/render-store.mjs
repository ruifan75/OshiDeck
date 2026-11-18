// Run capture-store.mjs first, then render-store.mjs for the same version.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const version = process.argv.find(arg => arg.startsWith('--version='))?.slice(10)
  || JSON.parse(readFileSync(join(repo, 'manifest.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid artwork version');

const outputScale = Number(process.argv.find(arg => arg.startsWith('--scale='))?.slice(8) || 1);
if (![1, 2, 3].includes(outputScale)) throw Error('Use --scale=1, 2 or 3');

const folder = join(repo, 'store-assets', version);
const provenancePath = join(folder, 'raw', 'provenance.json');
if (!existsSync(provenancePath)) throw Error('Run node tools/capture-store.mjs --version=' + version + ' first');
const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
if (provenance.version !== version || !provenance.languages.includes('ja')) {
  throw Error('Capture the Japanese screenshots for ' + version + ' first');
}

// The template's relative paths resolve alongside the versioned captures.
const layoutPath = join(folder, 'layout.html');
writeFileSync(layoutPath, readFileSync(join(repo, 'store-assets', 'layout.html')));
const layoutUrl = pathToFileURL(layoutPath).href;

const browser = process.env.CHROME_BIN || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome'
].find(existsSync);
if (!browser) throw Error('Set CHROME_BIN to a Chrome or Chromium executable');

const temp = mkdtempSync(join(tmpdir(), 'oshideck-store-render-'));
const child = spawn(browser, [
  '--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-gpu', '--user-data-dir=' + join(temp, 'profile'), 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
child.stderr.resume();

let buffer = '';
let sequence = 0;
const pending = new Map();
child.stdio[4].setEncoding('utf8');
child.stdio[4].on('data', data => {
  buffer += data;
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const task = pending.get(message.id);
    if (!task) continue;
    pending.delete(message.id);
    clearTimeout(task.timer);
    if (message.error) task.reject(Error(JSON.stringify(message.error)));
    else task.resolve(message.result);
  }
});

const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(Error('CDP timeout: ' + method));
  }, 20000);
  pending.set(id, { resolve, reject, timer });
  child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
});

async function evaluate(sessionId, expression) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}

const decodeResources = 'document.fonts.ready.then(() => Promise.all([...document.images].map(image => image.decode())))';

async function openLayout() {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Page.navigate', { url: layoutUrl }, sessionId);
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await evaluate(sessionId, "document.readyState === 'complete' && !!document.querySelector('[data-capture]')");
    if (ready) {
      await evaluate(sessionId, decodeResources);
      return { targetId, sessionId };
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Store artwork layout did not load');
}

function brandPainted(sessionId, png) {
  return evaluate(sessionId, `(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + ${JSON.stringify(png)};
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 250;
    canvas.height = 70;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 20 * ${outputScale}, 20 * ${outputScale},
      250 * ${outputScale}, 70 * ${outputScale}, 0, 0, 250, 70);
    const pixels = ctx.getImageData(0, 0, 250, 70).data;
    let bright = 0;
    for (let n = 0; n < pixels.length; n += 4) {
      if (pixels[n] > 180 && pixels[n + 1] > 150 && pixels[n + 2] > 180) bright++;
    }
    return bright > 150;
  })()`);
}

try {
  const layout = await openLayout();
  const artboards = await evaluate(layout.sessionId, `[...document.querySelectorAll('[data-capture]')].map(node => ({
    name: node.dataset.capture,
    html: node.outerHTML,
    width: node.offsetWidth,
    height: node.offsetHeight
  }))`);
  await send('Target.closeTarget', { targetId: layout.targetId });

  const suffix = outputScale === 1 ? '' : '@' + outputScale + 'x';
  const artifacts = [];
  for (const { name, html, width, height } of artboards) {
    const { targetId, sessionId } = await openLayout();
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: outputScale, mobile: false }, sessionId);
    await evaluate(sessionId, `(() => {
      document.body.innerHTML = ${JSON.stringify(html)};
      document.body.style.cssText = 'margin:0;padding:0;display:block';
      scrollTo(0, 0);
      return ${decodeResources};
    })()`);
    // Give Chrome two frames to paint the new single-artboard document.
    await evaluate(sessionId, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await evaluate(sessionId, `(() => {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      document.body.getBoundingClientRect();
      return new Promise(resolve => setTimeout(resolve, 80));
    })()`);
    await send('Page.bringToFront', {}, sessionId);
    await evaluate(sessionId, 'new Promise(resolve => setTimeout(resolve, 300))');

    const screenshot = { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 }, captureBeyondViewport: true };
    let { data } = await send('Page.captureScreenshot', screenshot, sessionId);
    if (!await brandPainted(sessionId, data)) {
      await evaluate(sessionId, 'new Promise(resolve => setTimeout(resolve, 700))');
      ({ data } = await send('Page.captureScreenshot', screenshot, sessionId));
      if (!await brandPainted(sessionId, data)) throw Error('Brand header was not painted: ' + name);
    }

    const file = name + suffix + '.png';
    writeFileSync(join(folder, file), Buffer.from(data, 'base64'));
    artifacts.push({ file, width: width * outputScale, height: height * outputScale });
    console.log('Rendered', name, width * outputScale + 'x' + height * outputScale);
    await send('Target.closeTarget', { targetId });
  }

  writeFileSync(join(folder, 'exports' + suffix + '.json'), JSON.stringify({
    version,
    artworkRevision: 3,
    sourceScale: provenance.sourceScale,
    outputScale,
    artifacts,
    source: 'layout.html and raw screenshots; see raw/provenance.json'
  }, null, 2) + '\n');
} finally {
  try {
    await send('Browser.close');
  } catch {}
  child.kill();
}
