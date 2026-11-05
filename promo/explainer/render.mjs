/**
 * Renders film.build.html frame by frame with headless Chrome (DevTools protocol, no npm deps)
 * and encodes it with ffmpeg. The soundtrack is rendered in the page with an OfflineAudioContext.
 *
 *   node render.mjs --stills 0,7.5,20 --out stills     PNG stills at those seconds
 *   node render.mjs --video ../mindpool-explainer.mp4  the whole film, 30 fps, with sound
 *   options: --fps 30  --from 0 --to <end>  --scale 1  --no-audio
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes(`--${name}`);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1920, H = 1080, scale = Number(opt('scale', '1')), fps = Number(opt('fps', '30'));
const PORT = 9300 + Math.floor(Math.random() * 500);

const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'mp-film-'))}`,
    '--hide-scrollbars', '--disable-gpu', '--mute-audio', '--force-color-profile=srgb', `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => chrome.kill());

async function connect() {
    for (let i = 0; i < 100; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
            const page = list.find((t) => t.type === 'page');
            if (page) return page.webSocketDebuggerUrl;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Chrome did not start');
}

const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: scale, mobile: false });
await send('Page.navigate', { url: pathToFileURL(path.join(here, 'film.build.html')).href });
for (let i = 0; i < 200; i++) {
    if (await evaluate('typeof window.__ready === "object"').catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 100));
}
await evaluate('window.__ready');
const duration = await evaluate('window.__duration');
console.log(`film loaded: ${duration}s`);

const frame = async (t, format = 'jpeg') => {
    await evaluate(`(window.__frame(${t}), new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`);
    const shot = await send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? 94 : undefined, captureBeyondViewport: false });
    return Buffer.from(shot.data, 'base64');
};

if (opt('stills')) {
    const out = path.resolve(here, opt('out', 'stills'));
    mkdirSync(out, { recursive: true });
    for (const t of opt('stills').split(',').map(Number)) {
        const file = path.join(out, `t${t.toFixed(2).padStart(6, '0')}.png`);
        writeFileSync(file, await frame(t, 'png'));
        console.log(file);
    }
} else if (opt('video')) {
    const out = path.resolve(here, opt('video'));
    const from = Number(opt('from', '0')), to = Number(opt('to', String(duration)));
    const frames = Math.round((to - from) * fps);
    let audio;
    if (!flag('no-audio')) {
        audio = path.join(here, 'soundtrack.wav');
        const b64 = await evaluate(`window.__renderAudio(${from}, ${to})`);
        writeFileSync(audio, Buffer.from(b64, 'base64'));
        console.log(`soundtrack: ${audio}`);
    }
    const ff = spawn('ffmpeg', [
        '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
        ...(audio ? ['-i', audio] : []),
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-tune', 'animation',
        ...(audio ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
        '-movflags', '+faststart', out,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const started = Date.now();
    for (let i = 0; i < frames; i++) {
        const buf = await frame(from + i / fps);
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
        if (i % (fps * 5) === 0) console.log(`frame ${i}/${frames} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    console.log(`✔ ${out} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
ws.close();
chrome.kill();
process.exit(0);
