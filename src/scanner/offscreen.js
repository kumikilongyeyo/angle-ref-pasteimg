// Offscreen document: hosts MediaPipe (WASM + WebGL) at the extension's origin, away from
// AngleRef's page (no CSP fights, no global collisions). Only ever sees the picture the user
// put in the dock.
import { configureScanner, scanPose, warmScanner, engine } from './pose-scanner.mjs';

configureScanner((p) => chrome.runtime.getURL(p));

const IDLE_CLOSE_MS = 10 * 60 * 1000; // free the model's memory when nobody has scanned for a while
let idle;
const touch = () => {
  clearTimeout(idle);
  idle = setTimeout(() => window.close(), IDLE_CLOSE_MS);
};
touch();

// one scan at a time; a newer picture replaces one that hasn't started
let running = false;
let pending = null;

async function pump() {
  if (running || !pending) return;
  const job = pending;
  pending = null;
  running = true;
  try {
    const blob = await (await fetch(job.image)).blob();
    const bmp = await createImageBitmap(blob);
    try {
      job.reply({ ok: true, result: await scanPose(bmp) });
    } finally {
      bmp.close();
    }
  } catch (e) {
    console.warn('[angleref-pose] scan failed', e);
    job.reply({ ok: false, error: String(e?.message ?? e) });
  } finally {
    running = false;
    touch();
    void pump();
  }
}

chrome.runtime.onMessage.addListener((m, _sender, sendResponse) => {
  if (m?.target !== 'arps-offscreen') return false;
  touch();
  if (m.type === 'warm') {
    warmScanner().then(
      () => sendResponse({ ok: true, engine }),
      (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }),
    );
    return true;
  }
  if (m.type === 'scan') {
    pending?.reply({ ok: false, error: 'superseded' });
    pending = { image: m.image, reply: sendResponse };
    void pump();
    return true;
  }
  return false;
});
