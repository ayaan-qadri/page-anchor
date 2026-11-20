/**
 * Save-as-PNG/PDF check in real Firefox, which runs extension scripts in a separate compartment and captures through its own off-screen path.
 *
 * Starts a hidden Firefox over WebDriver BiDi, installs the built extension temporarily, draws a stroke, saves the page both ways and checks the files.
 *
 * Usage: pnpm build:firefox && node scripts/firefox-export.mjs
 * Env: FIREFOX_BIN=<path to firefox>, PA_EXT_DIR=<built extension dir>, PA_HEADED=1 to show the window.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { inflateSync } from 'zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = process.env.PA_EXT_DIR ? path.resolve(process.env.PA_EXT_DIR) : path.join(ROOT, '.output', 'firefox-mv3');
const FIREFOX = process.env.FIREFOX_BIN ?? (process.platform === 'win32' ? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' : 'firefox');
const PORT = 9300 + Math.floor(Math.random() * 600);

const results = [];
function record(name, pass, metrics) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(metrics)}`);
}

const PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Firefox export check</title></head>
<body style="margin:0">
<div style="position:fixed;top:0;left:0;right:0;height:40px;background:rgb(255,0,0)"></div>
<div style="height:1000px;background:rgb(0,0,255)"></div>
<div style="height:1000px;background:rgb(0,255,0)"></div>
<div style="height:1000px;background:rgb(0,0,0)"></div>
</body></html>`;
const server = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  r.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-ff-'));
fs.writeFileSync(
  path.join(profile, 'user.js'),
  [
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("browser.download.folderList", 2);',
    `user_pref("browser.download.dir", ${JSON.stringify(profile)});`,
    'user_pref("browser.download.always_ask_before_handling_new_types", false);',
    // Lets the check read the clipboard back without Firefox's paste prompt.
    'user_pref("dom.events.testing.asyncClipboard", true);',
  ].join('\n')
);
const firefox = spawn(FIREFOX, [...(process.env.PA_HEADED ? [] : ['--headless']), '--no-remote', '--profile', profile, `--remote-debugging-port=${PORT}`, '--width=1280', '--height=800'], {
  stdio: 'ignore',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  ws = await new Promise((resolve) => {
    const socket = new globalThis.WebSocket(`ws://127.0.0.1:${PORT}/session`);
    socket.onopen = () => resolve(socket);
    socket.onerror = () => resolve(null);
  });
  if (!ws) await sleep(500);
}
if (!ws) throw new Error(`Firefox did not start (FIREFOX_BIN=${FIREFOX})`);

let nextId = 0;
const pending = new Map();
const consoleLines = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.type === 'error') reject(new Error(`${msg.error}: ${msg.message}`));
    else resolve(msg.result);
  } else if (msg.method === 'log.entryAdded' && /page.?anchor/i.test(msg.params.text ?? '')) {
    consoleLines.push(msg.params.text);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

function pngPixels(buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const idat = [];
  for (let at = 8; at < buffer.length; ) {
    const len = buffer.readUInt32BE(at);
    if (buffer.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(buffer.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const rgb = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < stride; i++) {
      const v = raw[y * (stride + 1) + 1 + i];
      rgb[y * stride + i] = (v + (y ? rgb[(y - 1) * stride + i] : 0)) & 0xff;
    }
  }
  return { width, height, at: (x, y) => [...rgb.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)] };
}
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 16);

try {
  await send('session.new', { capabilities: {} });
  await send('session.subscribe', { events: ['log.entryAdded'] });
  await send('webExtension.install', { extensionData: { type: 'path', path: EXT } });
  const context = (await send('browsingContext.getTree', {})).contexts[0].context;
  await send('browsingContext.navigate', { context, url, wait: 'complete' });
  await sleep(1500);
  const evaluate = async (expression) => (await send('script.evaluate', { expression, target: { context }, awaitPromise: true })).result.value;
  const keys = (values) => send('input.performActions', { context, actions: [{ type: 'key', id: 'kb', actions: values.flatMap((v) => [{ type: 'keyDown', value: v }]).concat([...values].reverse().map((v) => ({ type: 'keyUp', value: v }))) }] });

  // Alt+Shift+D opens the toolbar, P picks the pen.
  await keys(['\uE00A', '\uE008', 'D']);
  await sleep(1500);
  record('toolbar opens', await evaluate(`!!document.getElementById('page-anchor-host')?.shadowRoot?.querySelector('.pa-toolbar')`), {});
  await keys(['p']);
  await send('input.performActions', {
    context,
    actions: [
      {
        type: 'pointer',
        id: 'mouse',
        actions: [{ type: 'pointerMove', x: 300, y: 400 }, { type: 'pointerDown', button: 0 }, ...Array.from({ length: 10 }, (_, i) => ({ type: 'pointerMove', x: 300 + i * 40, y: 400, duration: 16 })), { type: 'pointerUp', button: 0 }],
      },
    ],
  });
  await sleep(800);

  for (const format of ['png', 'pdf']) {
    const before = new Set(fs.readdirSync(profile));
    await evaluate(`(() => { const t = document.getElementById('page-anchor-host').shadowRoot.querySelectorAll('.pa-toast-text'); t.forEach((e) => e.remove()); })()`);
    await evaluate(`document.getElementById('page-anchor-host').shadowRoot.querySelector('[data-action="export-${format}"]').click()`);
    const panel = await evaluate(`(() => { const p = document.getElementById('page-anchor-host').shadowRoot.querySelector('.pa-export-status'); return p ? p.textContent : '' })()`);
    record(`progress panel shows while saving as ${format.toUpperCase()}`, /^Saving page as (PNG image|PDF)/.test(panel), { panel });
    let toast = '';
    for (let i = 0; i < 120 && !toast; i++) {
      await sleep(500);
      toast = await evaluate(`(() => { const t = document.getElementById('page-anchor-host')?.shadowRoot?.querySelectorAll('.pa-toast-text'); return t && t.length ? t[t.length - 1].textContent : '' })()`);
    }
    let file = null;
    for (let i = 0; i < 20 && !file; i++) {
      file = fs.readdirSync(profile).find((f) => !before.has(f) && f.endsWith(`.${format}`)) ?? null;
      if (!file) await sleep(250);
    }
    const bytes = file ? fs.readFileSync(path.join(profile, file)) : null;
    if (format === 'png') {
      const img = bytes ? pngPixels(bytes) : null;
      const scale = img ? img.width / 1280 : 1;
      const at = (x, y) => img.at(Math.round(x * scale), Math.round(y * scale));
      const checks = img && {
        size: [img.width, img.height],
        bar: near(at(5, 10), [255, 0, 0]),
        blue: near(at(5, 500), [0, 0, 255]),
        green: near(at(5, 1500), [0, 255, 0]),
        black: near(at(5, 2500), [0, 0, 0]),
        stroke: [395, 400, 405].some((y) => !near(at(500, y), [0, 0, 255])),
        // Where the progress panel sat on screen (bottom centre); it must step out of every screenshot.
        noPanel: [600, 650, 700].every((y) => near(at(640, y), [0, 0, 255])),
      };
      record('Firefox saves the page as PNG with the drawing', toast === 'Page saved as PNG' && !!checks && Math.abs(img.height - 3000 * scale) <= 2 && checks.bar && checks.blue && checks.green && checks.black && checks.stroke && checks.noPanel, {
        toast,
        ...checks,
      });
    } else {
      const text = bytes?.toString('latin1') ?? '';
      record('Firefox saves the page as PDF', toast === 'Page saved as PDF' && text.startsWith('%PDF-1.4') && text.endsWith('%%EOF\n'), { toast, bytes: bytes?.length ?? 0 });
    }
  }

  const shadow = `document.getElementById('page-anchor-host').shadowRoot`;
  const lastToast = () => evaluate(`(() => { const t = ${shadow}.querySelectorAll('.pa-toast-text'); return t.length ? t[t.length - 1].textContent : '' })()`);
  // Each input gets its own pointer source; a touch source sends touch pointer events, as a phone does.
  const source = (input) => ({ type: 'pointer', id: input, parameters: { pointerType: input } });
  const clickAt = (input, x, y) => send('input.performActions', { context, actions: [{ ...source(input), actions: [{ type: 'pointerMove', x, y }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
  // The page is scrolled so the area sits across the blue and green bands, where the stroke is at y=400.
  await evaluate('window.scrollTo(0, 300)');
  for (const [input, action] of ['mouse', 'touch'].flatMap((i) => ['area-png', 'area-pdf', 'area-copy'].map((a) => [i, a]))) {
    const label = input === 'touch' ? ' by touch' : '';
    // Firefox opens each saved PDF in a new tab, which would leave the test page in the background.
    await send('browsingContext.activate', { context });
    const before = new Set(fs.readdirSync(profile));
    await evaluate(`${shadow}.querySelectorAll('.pa-toast-text').forEach((e) => e.remove())`);
    await evaluate(`${shadow}.querySelector('[data-action="capture-area"]').click()`);
    await sleep(300);
    await send('input.performActions', {
      context,
      // Lifted mid-move, as a quick finger does.
      actions: [{ ...source(input), actions: [{ type: 'pointerMove', x: 200, y: 50 }, { type: 'pointerDown', button: 0 }, ...Array.from({ length: 6 }, (_, i) => ({ type: 'pointerMove', x: 200 + (i + 1) * 50, y: 50 + (i + 1) * 100, duration: 16 })), { type: 'pointerUp', button: 0 }] }],
    });
    await sleep(300);
    const btn = JSON.parse(await evaluate(`(() => { const r = ${shadow}.querySelector('[data-action="${action}"]')?.getBoundingClientRect(); return JSON.stringify(r && r.width ? [r.x + r.width / 2, r.y + r.height / 2] : null) })()`));
    if (!btn) {
      record(`Capture area shows the ${action} button${label}`, false, {});
      continue;
    }
    const started = Date.now();
    await clickAt(input, Math.round(btn[0]), Math.round(btn[1]));
    let toast = '';
    for (let i = 0; i < 40 && !toast; i++) {
      await sleep(250);
      toast = await lastToast();
    }
    // Polled every 250ms, so this is an upper bound.
    const ms = Date.now() - started;
    if (action === 'area-copy') {
      const copied = JSON.parse(
        await evaluate(`(async () => { try { const [item] = await navigator.clipboard.read(); const b = await createImageBitmap(await item.getType('image/png')); return JSON.stringify([b.width, b.height]); } catch (e) { return JSON.stringify(String(e)); } })()`)
      );
      record(`Firefox copies a selected area${label}`, toast === 'Copied to clipboard' && Array.isArray(copied) && copied[1] === copied[0] * 2, { toast, copied, ms });
      continue;
    }
    const format = action === 'area-png' ? 'png' : 'pdf';
    let file = null;
    for (let i = 0; i < 20 && !file; i++) {
      file = fs.readdirSync(profile).find((f) => !before.has(f) && f.endsWith(`.${format}`)) ?? null;
      if (!file) await sleep(250);
    }
    const bytes = file ? fs.readFileSync(path.join(profile, file)) : null;
    if (bytes && process.env.PA_KEEP_DIR) fs.writeFileSync(path.join(process.env.PA_KEEP_DIR, `firefox-area.${format}`), bytes);
    if (format === 'png') {
      const img = bytes ? pngPixels(bytes) : null;
      const scale = img ? img.width / 300 : 1;
      // Area is x 200..500, y 50..650 on screen, so document y 350..950; the stroke runs x 300..660 at document y 400.
      const at = (x, y) => img.at(Math.round(x * scale), Math.round(y * scale));
      const checks = img && {
        size: [img.width, img.height],
        ratio: Math.abs(img.height / img.width - 2) < 0.02,
        blue: near(at(5, 5), [0, 0, 255]),
        stroke: [45, 50, 55].some((y) => !near(at(150, y), [0, 0, 255])),
        noStrokeLeftOfIt: near(at(50, 50), [0, 0, 255]),
      };
      record(`Firefox saves a selected area as PNG${label}`, toast === 'Area saved as PNG' && !!checks && checks.ratio && checks.blue && checks.stroke && checks.noStrokeLeftOfIt, { toast, ...checks, ms });
    } else {
      const text = bytes?.toString('latin1') ?? '';
      const mediaBox = /\/MediaBox \[[^\]]*\]/.exec(text)?.[0];
      // One page the size of the 300x600 area on screen, at 0.75pt per CSS pixel.
      record(`Firefox saves a selected area as PDF${label}`, toast === 'Area saved as PDF' && text.startsWith('%PDF-1.4') && text.includes('/Count 1') && mediaBox === '/MediaBox [0 0 225 450]', { toast, mediaBox, ms });
    }
  }
} catch (error) {
  record('firefox run crashed', false, { error: String(error?.message ?? error) });
} finally {
  record('no extension errors in the console', consoleLines.length === 0, { console: consoleLines.slice(0, 5) });
  try {
    await send('session.end', {});
  } catch {}
  firefox.kill();
  server.close();
  await sleep(800);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
}

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
