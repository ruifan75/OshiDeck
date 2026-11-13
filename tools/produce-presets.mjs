// A resumable rebuild, separate from both the old candidates and shipped sets.
//   node tools/produce-presets.mjs --run chat-presets-YYYYMMDD --plan
// The run starts with channels.json: a fresh, unmerged Holodex snapshot.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync,
  copyFileSync, unlinkSync, openSync, closeSync } from "node:fs";
import { resolve, join, relative, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { chatLines } from "./chat-lines.mjs";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const root = new URL("..", import.meta.url).pathname;
export const RECIPE = "karaoke-10pct-2-plus-ordinary-13-v1";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Download workers share one CPU-heavy lane. A failed inspection or miner
// releases the lane too, so another channel can still finish.
function serial() {
  let queue = Promise.resolve();
  return (task) => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
}

export const karaoke = (video) => video.topic_id === "singing" &&
  video.duration >= 2400 && video.duration <= 16000 &&
  (video.mentions || []).length === 0;
export const ordinary = (video) => video.topic_id !== "singing" &&
  video.topic_id !== "membersonly" && video.duration > 600;

export function save(file, value) {
  writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

export function readKey() {
  if (process.env.HOLODEX_API_KEY) return process.env.HOLODEX_API_KEY;
  const line = readFileSync(join(root, ".env"), "utf8").split("\n")
    .find((value) => /^HOLODEX_API_KEY\s*=/.test(value));
  if (!line) throw new Error("Missing HOLODEX_API_KEY");
  return line.slice(line.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
}

export function api(key) {
  // A shared queue spaces requests even when two channel workers run together.
  let queue = Promise.resolve();
  let cooldown = 0;
  return async (query) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const turn = queue.then(async () => {
        await sleep(1000);
        if (cooldown > Date.now()) await sleep(cooldown - Date.now());
      });
      queue = turn.catch(() => {});
      await turn;
      let response;
      try {
        response = await fetch(`https://holodex.net/api/v2/${query}`, {
          headers: { "X-APIKEY": key, Accept: "application/json" },
          signal: AbortSignal.timeout(30000)
        });
      } catch (_) {
        if (attempt === 3) throw new Error("Holodex connection failed after four attempts");
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (response.ok) {
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error("Unexpected Holodex response");
        return data;
      }
      const error = new Error(`Holodex HTTP ${response.status}`);
      if (response.status === 401 || response.status === 403) {
        error.fatal = true;
        throw error;
      }
      if (response.status === 429) {
        const header = response.headers.get("retry-after");
        const seconds = header && Number.isFinite(Number(header)) ? Number(header) : 0;
        const until = seconds ? Date.now() + seconds * 1000 : Date.parse(header || "");
        cooldown = Math.max(Date.now() + 60000, Number.isFinite(until) ? until : 0);
        console.log("Holodex rate limited; respecting Retry-After and waiting at least 60 seconds");
      }
      if (attempt === 3 || (response.status !== 429 && response.status < 500)) throw error;
      await sleep(3000 * (attempt + 1));
    }
  };
}

const shape = (video) => ({
  id: video.id, at: video.available_at, title: video.title,
  duration: video.duration, topic: video.topic_id || null,
  mentions: (video.mentions || []).map((channel) => channel.id)
});

export async function planChannel(channel, ask) {
  const query = `videos?channel_id=${encodeURIComponent(channel.id)}&type=stream&status=past` +
    "&limit=50&sort=available_at&order=desc&include=mentions";
  const songs = await ask(`${query}&topic=singing`);
  const talk = [];
  let exhausted = false;
  let scanned = 0;
  // Reserves allow missing replays to be replaced by the next newest stream.
  // Bound the history scan, and record that bound rather than claiming absence.
  for (let offset = 0; offset < 500; offset += 50) {
    const page = await ask(`${query}&offset=${offset}`);
    scanned += page.length;
    talk.push(...page.filter(ordinary));
    if (page.length < 50) { exhausted = true; break; }
    if (new Set(talk.map((video) => video.id)).size >= 39) break;
  }
  const unique = (videos) => [...new Map(videos.map((video) => [video.id, shape(video)])).values()];
  const singing = unique(songs.filter(karaoke));
  const ordinaryStreams = unique(talk);
  if ([...singing, ...ordinaryStreams].some((video) => !/^[A-Za-z0-9_-]{11}$/.test(video.id))) {
    throw new Error("Holodex returned an invalid video id");
  }
  return {
    recipe: RECIPE, channel: channel.id, name: channel.japanese || channel.name,
    fetchedAt: new Date().toISOString(), targets: { singing: 2, ordinary: 13 },
    singing, ordinary: ordinaryStreams,
    search: { singingListed: songs.length, singingLimit: 50, ordinaryScanned: scanned,
      ordinaryExhausted: exhausted, ordinaryLimit: 500 }
  };
}

export async function planAll(run, { ask, jobs = 2 } = {}) {
  const channels = JSON.parse(readFileSync(join(run, "channels.json"), "utf8"))
    .filter((channel) => !channel.inactive).sort((a, b) => b.subscribers - a.subscribers);
  if (new Set(channels.map((channel) => channel.id)).size !== channels.length ||
      channels.some((channel) => !/^UC[A-Za-z0-9_-]{22}$/.test(channel.id))) {
    throw new Error("The channel snapshot contains duplicate or invalid ids");
  }
  for (const folder of ["plans", "errors"]) mkdirSync(join(run, folder), { recursive: true });
  let next = 0, completed = 0, skipped = 0, failed = 0, fatal;
  const started = new Date().toISOString();
  const progress = (finished = false) => save(join(run, "planning.json"), {
    recipe: RECIPE, started, updated: new Date().toISOString(), total: channels.length,
    completed, skipped, failed, state: fatal ? "failed" : finished ? "finished" : "running"
  });
  const worker = async () => {
    while (!fatal && next < channels.length) {
      const channel = channels[next++];
      const file = join(run, "plans", `${channel.id}.json`);
      if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).recipe === RECIPE) {
        skipped++;
        progress();
        continue;
      }
      try {
        const plan = await planChannel(channel, ask);
        save(file, plan);
        const errorFile = join(run, "errors", `${channel.id}.plan.json`);
        if (existsSync(errorFile)) unlinkSync(errorFile);
        completed++;
        console.log(`plan ${completed + skipped}/${channels.length} ${channel.id}: ` +
          `${plan.singing.length} karaoke / ${plan.ordinary.length} ordinary candidates`);
      } catch (error) {
        failed++;
        save(join(run, "errors", `${channel.id}.plan.json`), {
          channel: channel.id, at: new Date().toISOString(), error: error.message
        });
        console.error(`FAIL plan ${channel.id}: ${error.message}`);
        if (error.fatal) fatal = error;
      }
      progress();
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  progress(true);
  if (fatal) throw fatal;
  if (failed) throw Object.assign(new Error(`${failed} channels failed planning; run --plan again to retry`), { retryable: true });
  return { total: channels.length, completed, skipped };
}

const clean = (value) => String(value).replaceAll(homedir(), "~");

export async function inspectChat(file) {
  let messages = 0;
  const lines = chatLines(file);
  for await (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); }
    catch (_) { throw new Error(`Invalid JSON in ${basename(file)}`); }
    for (const action of entry.replayChatItemAction?.actions || []) {
      if (action.addChatItemAction?.item?.liveChatTextMessageRenderer?.authorExternalChannelId) messages++;
    }
  }
  return messages;
}

export function command(binary, args, { cwd, timeout = 900000 } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", timedOut = false, killTimer;
    const capture = (data) => { output = (output + data).slice(-200000); };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 10000);
    }, timeout);
    child.on("error", (error) => { clearTimeout(timer); reject(new Error(clean(error.message))); });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      done({ code, output: clean(output), timedOut });
    });
  });
}

export const needsLogin = (output) => /sign in|log ?in|not a bot|confirm your age|age.restricted|HTTP Error 403/i.test(output);

// Holodex can leave topic empty even for a members-only archive. These are
// video eligibility answers, not failures of the network or the whole channel.
// Match the actual error line, so a public title mentioning membership stays.
export function unavailableReason(output) {
  for (const line of output.split("\n").filter((line) => /^ERROR:/.test(line))) {
    if (/Join this channel to get access to members-only content|This video is available to this channel's members on level:/i.test(line)) return "members-only";
    if (/This (?:live stream recording|video) is not available\./i.test(line)) return "not-available";
    if (/We're processing this video\. Check back later\./i.test(line)) return "processing";
  }
  return null;
}
export const unavailable = (output) =>
  /There are no subtitles|no live chat|chat replay is (?:not available|disabled)|Private video|Video unavailable|has been removed|not available in your country/i.test(output) ||
  unavailableReason(output) !== null;

const fragmentParseFailure = (output) => /^ERROR: Unable to download video subtitles for ['"]live_chat['"]:[^\n]*Expecting value:/m.test(output);

// yt-dlp can reuse a failed HTML fragment on every retry. Move this video's
// incomplete downloader files aside before a fresh request. Preserve them for
// inspection; completed chats and any other video's fragments stay in place.
export function quarantinePartial(run, video) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(video)) throw new Error("Invalid video id for retry");
  const raw = join(run, "raw");
  const base = `${video}.live_chat.json`;
  const fragmentPrefix = `${base}.part-Frag`;
  const files = readdirSync(raw).filter((file) =>
    file === `${base}.part` || file === `${base}.ytdl` || file === `${base}.part.ytdl` ||
    (file.startsWith(fragmentPrefix) && /^\d+(?:\.part|\.ytdl)?$/.test(file.slice(fragmentPrefix.length))));
  if (!files.length) return [];
  const dir = join(run, "partial-retries", video, `${Date.now()}-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  for (const file of files) renameSync(join(raw, file), join(dir, file));
  save(join(dir, "manifest.json"), { video, at: new Date().toISOString(), files,
    reason: "A live_chat response could not be parsed; request fresh fragments." });
  console.log(`retry ${video}: preserved ${files.length} incomplete downloader files`);
  return files;
}

function freezeMiner(run) {
  const dir = join(run, "code");
  const files = ["tools/mine-chat.mjs", "tools/chat-lines.mjs", "tools/scope.mjs", "src/tokens.js", "src/backup.js",
    "src/store.js", "src/trending.js", "src/presets.js"];
  const snapshot = join(run, "code.json");
  if (existsSync(snapshot)) {
    const held = JSON.parse(readFileSync(snapshot, "utf8"));
    for (const [file, hash] of Object.entries(held.hashes)) {
      if (createHash("sha256").update(readFileSync(join(dir, file))).digest("hex") !== hash) {
        throw new Error("The frozen miner changed; start a separate run");
      }
    }
    return held;
  }
  const hashes = {};
  for (const file of files) {
    const source = readFileSync(join(root, file));
    if (source.toString().includes(homedir())) throw new Error("A miner source contains a private home path");
    mkdirSync(join(dir, file, ".."), { recursive: true });
    copyFileSync(join(root, file), join(dir, file));
    hashes[file] = createHash("sha256").update(source).digest("hex");
  }
  const value = { recipe: RECIPE, at: new Date().toISOString(), hashes };
  save(snapshot, value);
  return value;
}

export async function mineAll(run, { jobs = 2, browser = "firefox", retryDelayMs = 2000, cacheDirs = [
  join(homedir(), "oshideck-sing", "chat"),
  join(homedir(), "oshideck-sing", "rotation-20261026", "chat"), join(root, "chat")
] } = {}) {
  const lock = join(run, "mining.lock");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    try { process.kill(pid, 0); throw new Error("A miner is already running"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
    unlinkSync(lock);
  }
  const fd = openSync(lock, "wx");
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  try {
    for (const folder of ["raw", "logs", "downloads", "manifests", "results", "candidates"]) {
      mkdirSync(join(run, folder), { recursive: true });
    }
    const snapshot = freezeMiner(run);
    const fingerprint = createHash("sha256").update(JSON.stringify(snapshot.hashes)).digest("hex");
    const compatible = new Set([fingerprint, ...(snapshot.compatibleFingerprints || [])]);
    const channels = JSON.parse(readFileSync(join(run, "channels.json"), "utf8"))
      .filter((channel) => !channel.inactive).sort((a, b) => b.subscribers - a.subscribers);
    const pending = new Map(channels.map((channel) => [channel.id, channel]));
    const active = new Map();
    const parseOne = serial();
    let parsing = null;
    let completed = 0, skipped = 0, failed = 0, consecutiveErrors = 0, fatal;
    let cookieRequired = false;
    const started = new Date().toISOString();
    const progress = (finished = false) => save(join(run, "mining.json"), {
      recipe: RECIPE, fingerprint, started, updated: new Date().toISOString(), total: channels.length,
      completed, skipped, failed, active: [...active], remaining: pending.size,
      maxDownloadWorkers: jobs, maxParserWorkers: 1, parsing,
      state: fatal || (finished && failed) ? "failed" : finished ? "finished" : "running"
    });
    const replay = async (video, channel) => {
      const name = `${video.id}.live_chat.json`;
      const own = join(run, "raw", name);
      const statusFile = join(run, "downloads", `${video.id}.json`);
      const status = existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, "utf8")) : null;
      const previousReason = status?.state === "error" ? unavailableReason(status.reason || "") : null;
      if (previousReason) {
        save(statusFile, { ...status, state: "unavailable", reasonCode: previousReason,
          reclassifiedAt: new Date().toISOString() });
        return null;
      }
      if (status?.state === "unavailable") return null;
      if (status?.state === "error" && fragmentParseFailure(status.reason || "")) quarantinePartial(run, video.id);
      for (const dir of [...cacheDirs, join(run, "raw")]) {
        const file = join(dir, name);
        if (!existsSync(file)) continue;
        if (file === own && status?.state !== "ok") {
          unlinkSync(file);
          continue;
        }
        const messages = await parseOne(() => inspectChat(file));
        if (messages) return { file, owned: file === own, messages };
      }
      const base = ["--ignore-config", "--skip-download", "--write-subs", "--sub-langs", "live_chat",
        "--sub-format", "json", "--no-progress", "--socket-timeout", "25", "--retries", "2",
        "--fragment-retries", "2", "--sleep-requests", "1", "--sleep-subtitles", "2",
        "-o", "raw/%(id)s.%(ext)s", `https://www.youtube.com/watch?v=${video.id}`];
      let result;
      for (let attempt = 0; attempt < 3; attempt++) {
        const useBrowser = cookieRequired && browser;
        console.log(`download ${channel.id} ${video.id}${useBrowser ? " (Firefox login)" : ""}`);
        const args = useBrowser ? ["--cookies-from-browser", browser, ...base] : base;
        result = await command("yt-dlp", args, { cwd: run });
        writeFileSync(join(run, "logs", `${video.id}.txt`), result.output);
        const reasonCode = unavailableReason(result.output);
        if (reasonCode) {
          save(statusFile, { state: "unavailable", channel: channel.id, video: video.id,
            at: new Date().toISOString(), reasonCode, reason: result.output.slice(-1500) });
          return null;
        }
        const messages = result.code === 0 && existsSync(own) ? await parseOne(() => inspectChat(own)) : 0;
        if (messages) {
          save(statusFile, { state: "ok", channel: channel.id, video: video.id, messages,
            browser: useBrowser || null, at: new Date().toISOString() });
          return { file: own, owned: true, messages };
        }
        // Login failures take precedence over generic "unavailable" wording.
        if (needsLogin(result.output) && browser && !useBrowser) {
          cookieRequired = true;
          continue;
        }
        if (result.code === 0 || (!needsLogin(result.output) && unavailable(result.output))) {
          save(statusFile, { state: "unavailable", channel: channel.id, video: video.id,
            at: new Date().toISOString(), reason: result.output.slice(-1500) });
          return null;
        }
        if (fragmentParseFailure(result.output)) quarantinePartial(run, video.id);
        await sleep(retryDelayMs * (attempt + 1));
      }
      save(statusFile, { state: "error", channel: channel.id, video: video.id,
        at: new Date().toISOString(), reason: result.output.slice(-1500) });
      throw new Error(`Chat download failed for ${video.id}; see its log`);
    };
    const worker = async () => {
      while (!fatal && pending.size) {
        const channel = [...pending.values()].find((channel) => existsSync(join(run, "plans", `${channel.id}.json`)));
        if (!channel) {
          const planning = JSON.parse(readFileSync(join(run, "planning.json"), "utf8"));
          if (planning.state !== "running" || Date.now() - Date.parse(planning.updated) > 1800000) {
            fatal = new Error("Some channels have no plan; resume --plan first");
            break;
          }
          await sleep(1000);
          continue;
        }
        pending.delete(channel.id);
        const resultFile = join(run, "results", `${channel.id}.json`);
        if (existsSync(resultFile)) {
          const held = JSON.parse(readFileSync(resultFile, "utf8"));
          if (compatible.has(held.fingerprint) && held.state !== "error" &&
              (held.state === "no-replay" || existsSync(join(run, "candidates", `${channel.id}.json`)))) {
            skipped++;
            progress();
            continue;
          }
        }
        active.set(channel.id, { singing: 0, ordinary: 0, phase: "downloading" });
        progress();
        try {
          const plan = JSON.parse(readFileSync(join(run, "plans", `${channel.id}.json`), "utf8"));
          if (plan.recipe !== RECIPE) throw new Error("The plan uses a different recipe");
          const streams = [];
          const owned = [];
          for (const kind of ["singing", "ordinary"]) {
            const target = kind === "singing" ? 2 : 13;
            for (const video of plan[kind]) {
              if (streams.filter((stream) => stream.kind === kind).length >= target) break;
              const got = await replay(video, channel);
              if (!got) continue;
              streams.push({ id: video.id, kind, file: relative(join(run, "manifests"), got.file) });
              if (got.owned) owned.push(got.file);
              active.get(channel.id)[kind]++;
              progress();
            }
          }
          let cards = 0;
          if (streams.length) {
            const manifest = join(run, "manifests", `${channel.id}.json`);
            save(manifest, { channel: channel.id, streams, output: `../candidates/${channel.id}.json` });
            active.get(channel.id).phase = "waiting-for-parser";
            progress();
            const mined = await parseOne(async () => {
              parsing = channel.id;
              active.get(channel.id).phase = "parsing";
              progress();
              try {
                return await command(process.execPath, [join(run, "code", "tools", "mine-chat.mjs"), "--manifest", manifest]);
              } finally {
                parsing = null;
                progress();
              }
            });
            writeFileSync(join(run, "logs", `${channel.id}.miner.txt`), mined.output);
            if (mined.code !== 0) throw new Error("The chat miner failed; see its log");
            const output = JSON.parse(readFileSync(join(run, "candidates", `${channel.id}.json`), "utf8"));
            cards = output.selected.length;
          }
          save(resultFile, { channel: channel.id, fingerprint, at: new Date().toISOString(),
            state: streams.length ? "complete" : "no-replay", cards,
            singing: active.get(channel.id).singing, ordinary: active.get(channel.id).ordinary });
          // Only this run's downloads, only after successful counting. Existing
          // measurement exports are never removed. This bounds disk use across
          // thousands of channels instead of keeping tens of thousands of chats.
          for (const file of owned) if (existsSync(file)) unlinkSync(file);
          completed++;
          consecutiveErrors = 0;
          console.log(`mined ${completed + skipped}/${channels.length} ${channel.id}: ${cards} cards`);
        } catch (error) {
          failed++;
          save(resultFile, { channel: channel.id, fingerprint, state: "error", at: new Date().toISOString(), error: clean(error.message) });
          console.error(`FAIL mine ${channel.id}: ${clean(error.message)}`);
          // Do not hammer every channel when login or YouTube itself is broken.
          if (++consecutiveErrors >= 3) fatal = new Error("Three consecutive channels failed; resume after checking the logs");
        } finally {
          active.delete(channel.id);
          progress();
        }
      }
    };
    await Promise.all(Array.from({ length: jobs }, worker));
    progress(true);
    if (fatal) throw fatal;
    if (failed) throw new Error(`${failed} channels failed; rerun --mine to retry`);
    return { total: channels.length, completed, skipped };
  } finally {
    unlinkSync(lock);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--run");
  if (at < 0 || !args[at + 1] || !["--plan", "--mine", "--finish"].some((flag) => args.includes(flag))) {
    throw new Error("usage: node tools/produce-presets.mjs --run <directory> --plan|--mine|--finish");
  }
  const run = resolve(args[at + 1]);
  if (args.includes("--plan")) {
    const ask = api(readKey());
    for (let pass = 0; pass < 3; pass++) {
      try { await planAll(run, { ask }); break; }
      catch (error) { if (!error.retryable || pass === 2) throw error; }
    }
  }
  if (args.includes("--mine")) {
    await mineAll(run);
    await finishAll(run);
  } else if (args.includes("--finish")) await finishAll(run);
}

export async function finishAll(run) {
  const channels = JSON.parse(readFileSync(join(run, "channels.json"), "utf8"));
  const active = channels.filter((channel) => !channel.inactive);
  const results = active.map((channel) => {
    const file = join(run, "results", `${channel.id}.json`);
    if (!existsSync(file)) throw new Error("The rebuild still has unprocessed channels");
    const result = JSON.parse(readFileSync(file, "utf8"));
    if (!["complete", "no-replay"].includes(result.state)) throw new Error("The rebuild still has failed channels");
    return result;
  });
  // Keep the recorded mining code intact. Publishing policy is current:
  // starting decks stay in their own channel and keep that room's wording.
  const snapshot = freezeMiner(run);
  const fingerprint = createHash("sha256").update(JSON.stringify(snapshot.hashes)).digest("hex");
  const compatible = new Set([fingerprint, ...(snapshot.compatibleFingerprints || [])]);
  if (results.some((result) => !compatible.has(result.fingerprint))) throw new Error("Mixed miner versions in this rebuild");
  save(join(run, "code", "tools", "channels.json"), channels);
  const scoped = await command(process.execPath, [join(root, "tools", "scope.mjs"), "--all",
    "--dir", join(run, "candidates"), "--out", join(run, "presets"),
    "--channels", join(run, "channels.json")]);
  writeFileSync(join(run, "scope.log"), scoped.output);
  if (scoped.code !== 0) throw new Error("Scope generation failed; see scope.log");

  globalThis.OshiDeck = {};
  globalThis.document = { querySelector: () => null };
  globalThis.chrome = { runtime: { id: "x" }, storage: { local: { get: async () => ({}), set: async () => {} } } };
  for (const file of ["tokens.js", "backup.js", "store.js", "trending.js", "presets.js"]) {
    await import(pathToFileURL(join(run, "code", "src", file)).href);
  }
  const { presets, tokens, trending } = globalThis.OshiDeck;
  const index = [];
  let cards = 0, maxCards = 0, maxBytes = 0, totalBytes = 0, withReplay = 0;
  for (const result of results.filter((result) => result.state === "complete")) {
    const mine = JSON.parse(readFileSync(join(run, "candidates", `${result.channel}.json`), "utf8"));
    withReplay++;
    if (!mine.selected.length) continue;
    const file = `${result.channel}.preset.json`;
    const raw = readFileSync(join(run, "presets", file), "utf8");
    const preset = JSON.parse(raw);
    const problem = presets.validate(preset);
    if (problem) throw new Error(`${result.channel}: ${JSON.stringify(problem)}`);
    const local = new Map(mine.candidates.filter((card) => mine.selected.includes(card.signature))
      .map((card) => [card.signature, tokens.cardKey(card.tokens)]));
    for (const card of preset.cards) {
      if (card.scope !== "channel") throw new Error("A mined starting deck cannot create universal cards");
      if (local.get(trending.signature(card.tokens)) !== tokens.cardKey(card.tokens)) {
        throw new Error("A starting deck lost its channel's own wording");
      }
      for (const token of card.tokens.filter((token) => token.type === "youtubeEmoji")) {
        if (!token.src || new URL(token.src).protocol !== "https:") {
          throw new Error(`${result.channel}: member emoji has no HTTPS image`);
        }
      }
    }
    if (preset.cards.length !== mine.selected.length) throw new Error("A selected card was lost during scope generation");
    const bytes = Buffer.byteLength(raw);
    cards += preset.cards.length;
    totalBytes += bytes;
    maxCards = Math.max(maxCards, preset.cards.length);
    maxBytes = Math.max(maxBytes, bytes);
    index.push({ channel: result.channel, file });
  }
  save(join(run, "presets", "index.json"), { format: 2, presets: index });
  const summary = { recipe: RECIPE, completedAt: new Date().toISOString(), channels: active.length,
    withReplay, noReplay: results.filter((result) => result.state === "no-replay").length,
    presets: index.length, cards, maxCards, maxBytes, totalBytes,
    scope: { policy: "channel-only", status: "ready" } };
  save(join(run, "complete.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
}
