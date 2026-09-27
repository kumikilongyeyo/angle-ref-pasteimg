// Which retry recovers MediaPipe misses? node bench/retry-probe.mjs file...
import { chromium } from 'playwright';
import { serve } from './server.mjs';
const files = process.argv.slice(2);
const srv = await serve(8793);
const b = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.goto('http://localhost:8793/bench/harness.html');
await p.waitForFunction(() => window.benchReady);
const out = await p.evaluate(async (files) => {
  const { PoseLandmarker } = await import('/vendor/mediapipe/vision_bundle.mjs');
  const lm = await PoseLandmarker.createFromOptions({ wasmLoaderPath: '/vendor/mediapipe/wasm/vision_wasm_internal.js', wasmBinaryPath: '/vendor/mediapipe/wasm/vision_wasm_internal.wasm' },
    { baseOptions: { modelAssetPath: '/models/pose_landmarker_heavy.task', delegate: 'GPU' }, runningMode: 'IMAGE', numPoses: 3, minPoseDetectionConfidence: 0.3, minPosePresenceConfidence: 0.3 });
  const variant = (img, kind) => {
    const w = img.naturalWidth, h = img.naturalHeight;
    let c;
    if (kind === 'orig') { c = new OffscreenCanvas(w, h); c.getContext('2d').drawImage(img, 0, 0); }
    if (kind === 'padBottom') { c = new OffscreenCanvas(Math.round(w * 1.5), Math.round(h * 2)); const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, Math.round(w * 0.25), Math.round(h * 0.1)); }
    if (kind === 'padAll') { c = new OffscreenCanvas(w * 2, h * 2); const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, w / 2, h / 2); }
    if (kind === 'square') { const s = Math.max(w, h); c = new OffscreenCanvas(s, s); const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, s, s); g.drawImage(img, (s - w) / 2, (s - h) / 2); }
    if (kind === 'flip') { c = new OffscreenCanvas(w, h); const g = c.getContext('2d'); g.translate(w, 0); g.scale(-1, 1); g.drawImage(img, 0, 0); }
    return c;
  };
  const res = [];
  for (const f of files) {
    const img = new Image(); img.src = '/tests/fixtures/images/' + f; await img.decode();
    const row = { f };
    for (const k of ['orig', 'square', 'padBottom', 'padAll', 'flip']) { const r = lm.detect(variant(img, k)); row[k] = r.landmarks.length ? +(r.landmarks[0].slice(11, 25).reduce((s, q) => s + q.visibility, 0) / 14).toFixed(2) : 0; }
    res.push(row);
  }
  return res;
}, files);
console.table(out);
await b.close(); srv.close();
