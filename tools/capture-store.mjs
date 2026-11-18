// Build the versioned release ZIP before capturing the demo.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repo = fileURLToPath(new URL('..', import.meta.url));
const version = process.argv.find(arg => arg.startsWith('--version='))?.slice(10)
  || JSON.parse(readFileSync(join(repo, 'manifest.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid capture version');

const sourceScale = 5;
const output = join(repo, 'store-assets', version, 'raw');
const releaseZip = join(repo, 'dist', 'oshideck-' + version + '.zip');
if (!existsSync(releaseZip)) throw Error('Build the release ZIP for ' + version + ' first');
const browser = process.env.CHROME_BIN || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome'
].find(existsSync);
if (!browser) throw Error('Set CHROME_BIN to a Chrome or Chromium executable');
mkdirSync(output, { recursive: true });

const root = mkdtempSync(join(tmpdir(),'oshideck-store-capture-'));
const extension = join(root, 'extension');
mkdirSync(extension);
execFileSync('unzip', ['-q', releaseZip, '-d', extension]);
const child = spawn(browser, [
  '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--disable-gpu',
  '--user-data-dir=' + join(root, 'profile'), '--window-size=1280,900', 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
child.stderr.resume();
let sequence = 0;
let buffer = '';
const pending = new Map();
const events = new Map();
child.stdio[4].setEncoding('utf8');
child.stdio[4].on('data', data => {
  buffer += data;
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (message.id) {
      const task = pending.get(message.id);
      if (!task) continue;
      pending.delete(message.id);
      clearTimeout(task.timer);
      if (message.error) task.reject(Error(JSON.stringify(message.error)));
      else task.resolve(message.result);
    } else {
      const callback = events.get(message.method);
      if (callback) callback(message.params, message.sessionId);
    }
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
const evaluate = async (session, expression) => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (session, expression, label, ms = 6000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await evaluate(session, expression)) return;
    await pause(100);
  }
  throw Error('Wait failed: ' + label);
};
const page = async width => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  return { targetId, sessionId };
};

async function screenshot(session, file, selector) {
  const settings = { format: 'png', captureBeyondViewport: !!selector };
  if (selector) {
    settings.clip = await evaluate(session, `(() => {
      const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height, scale: 1 };
    })()`);
  }
  const { data } = await send('Page.captureScreenshot', settings, session);
  writeFileSync(join(output, file + '.png'), Buffer.from(data, 'base64'));
}

const channel = 'UC' + '0'.repeat(22);
const name = 'サンプル';
const languages = process.argv.includes('--all-languages') ? ['ja', 'zh-TW', 'en'] : ['ja'];
const sampleTexts = ['👏👏👏👏👏', '🦢✨🦢✨🦢✨', 'ただいまー', 'はい！はい！はい！はい！', '🦢',
  '🎶✨🎶✨', 'おかえり！', '88888888', '💜💜💜', 'おつかれさま！'];
const preset = {
  format: 2,
  name,
  channel,
  cards: sampleTexts.map(value => ({ scope: 'channel', tokens: [{ type: 'text', value }] }))
};
function chatHTML(lang){
 const L=lang==='ja'?['操作デモ','チャット','メッセージを入力','送信']:lang==='en'?['Interaction demo','Chat','Type a message','Send']:['操作示範','聊天室','輸入訊息','送出'];
 return `<!doctype html><html dark><head><meta charset="utf-8"><meta itemprop="channelId" content="${channel}"><style>
 *{box-sizing:border-box}html,body{margin:0;width:420px;background:#101010;color:#f1f1f1;font-family:Roboto,Arial,"Hiragino Kaku Gothic ProN",sans-serif}
 body{--yt-live-chat-primary-text-color:#f1f1f1;--yt-live-chat-secondary-text-color:#aaa;--yt-live-chat-background-color:#101010;--yt-live-chat-border-color:#333}
 header{padding:18px 18px 14px;border-bottom:1px solid #333;display:flex;align-items:center;gap:10px;font-size:15px}header small{margin-left:auto;color:#aaa;font-size:11px}
 .channel{padding:18px;display:flex;gap:12px;align-items:center;border-bottom:1px solid #2a2a2a}.channel .avatar{width:38px;height:38px;border-radius:50%;background:#242424;display:grid;place-items:center;font-size:22px}.channel strong{font-size:14px}.channel small{display:block;color:#888;font-size:11px;margin-top:5px}
 yt-live-chat-item-list-renderer,yt-live-chat-message-input-renderer,yt-live-chat-text-input-field-renderer{display:block}
 #item-scroller{height:245px;overflow:hidden;padding:14px 12px 8px}yt-live-chat-text-message-renderer{display:block;position:relative;padding:9px 18px 9px 4px;font-size:14px;line-height:1.4;min-height:39px}.author{color:#999;margin-right:10px;font-size:12px}.avatar-dot{display:inline-grid;place-items:center;background:#302c38;color:#c9b2da;border-radius:50%;width:22px;height:22px;font-size:10px;margin-right:8px;vertical-align:middle}
 #input-panel{background:#101010;border-top:1px solid #2d2d2d}yt-live-chat-message-input-renderer{padding:15px 18px 10px}#input-label{font-size:11px;color:#aaa;margin-bottom:5px}#editor{min-height:35px;outline:0;border-bottom:1px solid #555;padding:6px 0;font-size:14px}#editor:empty::before{content:'${L[2]}';color:#777}#send-button{display:flex;justify-content:flex-end;padding-top:9px}#send-button button{border:0;border-radius:16px;padding:5px 14px;background:#242424;color:#777;font-size:12px}
 </style></head><body><header>${L[1]}</header><div class="channel"><div class="avatar">O</div><div><strong>${name}</strong></div></div>
 <ytd-video-description-infocards-section-renderer hidden><h3>${name}</h3><a href="/channel/${channel}">channel</a></ytd-video-description-infocards-section-renderer>
 <yt-live-chat-item-list-renderer><div id="item-scroller"><div id="items">
 ${['🦢✨🦢✨🦢✨','88888888','ありがとう！','👏👏👏👏👏','ただいまー'].map((v,i)=>`<yt-live-chat-text-message-renderer ${i===2?'id="sample"':''}><span class="avatar-dot">${String(i+1).padStart(2,'0')}</span><span class="author">視聴者 ${String(i+1).padStart(2,'0')}</span><span id="message">${v}</span></yt-live-chat-text-message-renderer>`).join('')}
 </div></div></yt-live-chat-item-list-renderer>
 <div id="input-panel"><yt-live-chat-message-input-renderer><div id="input-label">メッセージ</div><yt-live-chat-text-input-field-renderer id="input"><div id="editor" contenteditable="true"></div></yt-live-chat-text-input-field-renderer><div id="send-button"><button disabled>${L[3]}</button></div></yt-live-chat-message-input-renderer></div></body></html>`;
}

try {
  const { id } = await send('Extensions.loadUnpacked', { path: extension });
  const { sessionId: options } = await page(1184);
  await send('Page.navigate', { url: `chrome-extension://${id}/options.html?channel=${channel}` }, options);
  await waitFor(options, '!!globalThis.OshiDeck?.store', 'options');

  for (const language of languages) {
    const patch = { mode: 'hand', cardSize: 'large', rows: 2, autoSend: false, suggest: false, sortBy: 'manual', language };
    await evaluate(options, `(async () => {
      await chrome.storage.local.clear();
      const store = OshiDeck.store;
      const channelId = ${JSON.stringify(channel)};
      await store.apply('setSettings', { patch: ${JSON.stringify(patch)} });
      const cards = OshiDeck.presets.cardsFor(${JSON.stringify(preset)}, channelId);
      await store.apply('loadPreset', { channelId, name: ${JSON.stringify(name)}, cards });
      const data = await store.read();
      if (data.cards.some(card => card.tokens.some(token => token.type !== 'text'))) {
        throw Error('Sample must contain only standard text and emoji');
      }
      for (const card of data.cards.slice(5)) {
        await store.apply('removeFromDeck', { channelId, cardId: card.id });
      }
    })()`);
    await send('Page.reload', {}, options);
    await waitFor(options, "document.querySelectorAll('#deckCards .browse-card').length === 5", 'five standard cards in deck');

    const { targetId, sessionId: chat } = await page(420);
    await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 650, deviceScaleFactor: sourceScale, mobile: false }, chat);
    const response = Buffer.from(chatHTML(language)).toString('base64');
    events.set('Fetch.requestPaused', ({ requestId }, sessionId) => {
      if (sessionId !== chat) return;
      send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: response
      }, chat).catch(() => {});
    });
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document' }] }, chat);
    await send('Page.navigate', { url: 'https://www.youtube.com/live_chat?v=DEMO0000001&is_popout=1' }, chat);
    await waitFor(chat, "document.querySelectorAll('.od-card-body').length === 5", 'real extension hand');
    await pause(1300);
    await screenshot(chat, language + '-chat');
    await screenshot(chat, language + '-hand', '#oshideck-root');

    await send('Emulation.setDeviceMetricsOverride', { width: 1184, height: 800, deviceScaleFactor: sourceScale, mobile: false }, options);
    await evaluate(options, "document.querySelector('.decks').scrollIntoView({ block: 'start' })");
    await pause(500);
    await screenshot(options, language + '-builder', '.decks');

    await evaluate(chat, "document.querySelector('#sample').dispatchEvent(new Event('pointerover', { bubbles: true }))");
    await waitFor(chat, "!!document.querySelector('.od-grab-plus')", 'chat capture button');
    await evaluate(chat, "document.querySelector('.od-grab-plus').click()");
    await waitFor(chat, "!!document.querySelector('.od-save-menu')", 'save menu');
    await pause(200);
    await screenshot(chat, language + '-save');

    await evaluate(chat, "document.querySelector('.od-save-menu [data-scope=channel]').click()");
    await waitFor(chat, "document.querySelectorAll('.od-card-body').length === 6", 'saved sixth card');
    await pause(500);
    await screenshot(chat, language + '-saved', '#oshideck-root');
    await evaluate(chat, "[...document.querySelectorAll('.od-card-play')].find(card => card.innerText.includes('ありがとう')).click()");
    await waitFor(chat, "document.querySelector('#editor').textContent.includes('ありがとう')", 'card filled editor');
    await pause(300);
    await screenshot(chat, language + '-filled', '#input-panel');
    await send('Target.closeTarget', { targetId });
    console.log('Captured actual ' + version + ' UI at ' + sourceScale + 'x:', language);
  }

  writeFileSync(join(output, 'provenance.json'), JSON.stringify({
    version,
    channel,
    displayName: name,
    sampleSource: 'Generic text and standard emoji; no creator/member artwork',
    sourceScale,
    languages,
    releaseZipSha256: createHash('sha256').update(readFileSync(releaseZip)).digest('hex'),
    capture: 'Actual extension loaded from release ZIP. Builder and card actions run through the real worker and storage. '
      + 'The chat page, channel name and messages are controlled examples.'
  }, null, 2) + '\n');
  console.log('Source captures saved under store-assets/' + version + '/raw');
} finally {
  try {
    await send('Browser.close');
  } catch {}
  child.kill();
}
