// MediaPipe Pose Landmarker, fully local (wasm + models bundled in the extension; the picture
// never leaves the machine). Keeps all 33 landmarks AND the 33 world landmarks — the world ones
// are what the rig solver needs.
//
// Model ladder, as in the user's Magic Poser scanner: Heavy/GPU -> Heavy/CPU -> Full/CPU.
import { PoseLandmarker } from '../../vendor/mediapipe/vision_bundle.mjs';

const LADDER = [
  { model: 'pose_landmarker_heavy', delegate: 'GPU' },
  { model: 'pose_landmarker_heavy', delegate: 'CPU' },
  { model: 'pose_landmarker_full', delegate: 'CPU' },
];
const MAX_SIDE = 1600; // bigger pictures are scaled down first: no accuracy gain, much slower

let base = (p) => p;
let ready = null;
/** which rung of the ladder is running */
export let engine = null;

export function configureScanner(assetUrl) {
  base = assetUrl;
  ready = null;
}

async function create({ model, delegate }) {
  // only the SIMD build is bundled (every Chrome that runs MV3 has wasm SIMD)
  const fileset = { wasmLoaderPath: base('vendor/mediapipe/wasm/vision_wasm_internal.js'), wasmBinaryPath: base('vendor/mediapipe/wasm/vision_wasm_internal.wasm') };
  const lm = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: base(`models/${model}.task`), delegate },
    runningMode: 'IMAGE',
    numPoses: 3,
    minPoseDetectionConfidence: 0.3,
    minPosePresenceConfidence: 0.3,
    outputSegmentationMasks: false,
  });
  // one throwaway detect compiles the GPU programs, so the user's first scan isn't the slow one,
  // and proves the delegate actually works here
  const c = new OffscreenCanvas(64, 64);
  c.getContext('2d').fillRect(0, 0, 64, 64);
  lm.detect(c);
  engine = { model, delegate };
  return lm;
}

export function warmScanner() {
  ready ??= (async () => {
    let lastErr;
    for (const rung of LADDER) {
      try {
        return await create(rung);
      } catch (e) {
        lastErr = e;
        console.warn('[angleref-pose] scanner rung failed', rung, e);
      }
    }
    ready = null;
    throw lastErr ?? new Error('pose model failed to load');
  })();
  return ready;
}

/** size of the picture in the frame, times how clearly it was seen, times how central it is */
function personScore(lms, minSeen = 3) {
  const core = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].map((i) => lms[i]);
  // a waist-up portrait may show only the head and shoulders clearly: three joints is a person
  const seen = core.filter((p) => (p.visibility ?? 0) >= 0.3 && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1);
  if (seen.length < minSeen) return 0;
  const xs = seen.map((p) => p.x), ys = seen.map((p) => p.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const vis = core.reduce((s, p) => s + (p.visibility ?? 0), 0) / core.length;
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  const centrality = 1 - 0.5 * Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) / 0.7);
  return span * vis * centrality;
}

const plain = (p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0, presence: p.presence ?? 1 });

/**
 * @param {ImageBitmap | OffscreenCanvas | HTMLCanvasElement | HTMLImageElement} source
 * @returns {Promise<null | {landmarks: object[], worldLandmarks: object[], width: number, height: number, people: number, engine: object, ms: number}>}
 */
/**
 * The picture as MediaPipe sees it on each try. Its person detector misses people it would
 * track fine once found — seen from behind, cropped at the waist, or framed tight — and letting
 * it see the same picture with room around it recovers most of them (bench/retry-probe.mjs).
 * Each try returns a canvas plus where the original sits inside it.
 */
function tries(source, w, h) {
  const plainTry = { name: 'as is', draw: () => ({ canvas: source, ox: 0, oy: 0, W: w, H: h }) };
  const pad = (name, W, H, ox, oy) => ({
    name,
    draw: () => {
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext('2d');
      g.fillStyle = '#808080';
      g.fillRect(0, 0, W, H);
      g.drawImage(source, ox, oy, w, h);
      return { canvas: c, ox, oy, W, H };
    },
  });
  const s = Math.max(w, h);
  return [
    plainTry,
    pad('square', s, s, Math.round((s - w) / 2), Math.round((s - h) / 2)),
    pad('room below', Math.round(w * 1.5), Math.round(h * 2), Math.round(w * 0.25), Math.round(h * 0.1)),
  ];
}

/**
 * @param {ImageBitmap | OffscreenCanvas | HTMLCanvasElement | HTMLImageElement} source
 * @returns {Promise<null | {landmarks: object[], worldLandmarks: object[], width: number, height: number, people: number, engine: object, ms: number, retry: string}>}
 */
export async function scanPose(source) {
  const lm = await warmScanner();
  const w0 = source.width, h0 = source.height;
  const k = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  let input = source;
  if (k < 1) {
    input = new OffscreenCanvas(Math.round(w0 * k), Math.round(h0 * k));
    input.getContext('2d').drawImage(source, 0, 0, input.width, input.height);
  }
  const w = input.width, h = input.height;
  const t0 = performance.now();
  for (const t of tries(input, w, h)) {
    const { canvas, ox, oy, W, H } = t.draw();
    const r = lm.detect(canvas);
    if (!r.landmarks?.length || !r.worldLandmarks?.length) continue;
    // back into the original picture's normalised coordinates
    const lms = r.landmarks.map((l) => l.map((p) => ({ ...plain(p), x: (p.x * W - ox) / w, y: (p.y * H - oy) / h })));
    // a second look also finds bodies in things that are not people (a cat on a chair, a lynx):
    // ask for more evidence, and the dock tells the user to check the outline
    const scores = lms.map((l) => personScore(l, t.name === 'as is' ? 3 : 4));
    const best = scores.indexOf(Math.max(...scores));
    if (scores[best] <= 0) continue;
    return {
      landmarks: lms[best],
      worldLandmarks: r.worldLandmarks[best].map(plain),
      width: w,
      height: h,
      people: scores.filter((sc) => sc > 0.25 * scores[best]).length,
      engine,
      retry: t.name,
      ms: Math.round(performance.now() - t0),
    };
  }
  return null;
}
