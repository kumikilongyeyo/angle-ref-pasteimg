// Loads the extension's classic content scripts into this process (they fill globalThis.ARP),
// and builds synthetic MediaPipe results for fixtures.
await import('../src/shared/constants.js');
await import('../src/shared/math.js');
await import('../src/pose/normalize-landmarks.js');
await import('../src/pose/confidence.js');
await import('../src/pose/landmarks-to-transforms.js');
await import('../src/camera/projection-error.js');
await import('../src/camera/camera-fitter.js');

export const ARP = globalThis.ARP;
const { LM } = ARP.constants;

/**
 * Build a MediaPipe-shaped scan from a named 3D skeleton given in CAMERA space
 * (+x viewer's right, +y up, +z towards the viewer; metres, hips near the origin).
 * The 2D landmarks are its orthographic projection into a width x height picture.
 */
export function makeScan(cam, { width = 800, height = 900, visibility = {}, defaultVis = 0.99, pxPerM = 380, originY = 0.5 } = {}) {
  const landmarks = [], worldLandmarks = [];
  for (const [name, i] of Object.entries(LM)) {
    const p = cam[name];
    if (!p) throw new Error(`fixture missing ${name}`);
    worldLandmarks[i] = { x: p[0], y: -p[1], z: -p[2], visibility: visibility[name] ?? defaultVis, presence: 1 };
    landmarks[i] = { x: 0.5 + (p[0] * pxPerM) / width, y: originY - (p[1] * pxPerM) / height, z: -p[2], visibility: visibility[name] ?? defaultVis, presence: 1 };
  }
  return { landmarks, worldLandmarks, width, height };
}

/** a T-pose facing the camera (the person's left is the viewer's right) */
export function tPose() {
  const s = {
    nose: [0, 0.62, 0.08],
    leftShoulder: [0.2, 0.5, 0], rightShoulder: [-0.2, 0.5, 0],
    leftElbow: [0.48, 0.5, 0], rightElbow: [-0.48, 0.5, 0],
    leftWrist: [0.74, 0.5, 0], rightWrist: [-0.74, 0.5, 0],
    leftIndex: [0.84, 0.5, 0], rightIndex: [-0.84, 0.5, 0],
    leftHip: [0.11, 0, 0], rightHip: [-0.11, 0, 0],
    leftKnee: [0.12, -0.44, 0.02], rightKnee: [-0.12, -0.44, 0.02],
    leftAnkle: [0.12, -0.86, 0], rightAnkle: [-0.12, -0.86, 0],
    leftHeel: [0.12, -0.9, -0.04], rightHeel: [-0.12, -0.9, -0.04],
    leftFootIndex: [0.13, -0.92, 0.14], rightFootIndex: [-0.13, -0.92, 0.14],
  };
  return fillFace(s);
}

/** standing in profile, facing the viewer's LEFT (so the person's left side is towards the camera) */
export function profileFacingLeft() {
  const s = {
    nose: [-0.1, 0.62, 0],
    leftShoulder: [0, 0.5, 0.18], rightShoulder: [0, 0.5, -0.18],
    leftElbow: [0, 0.22, 0.2], rightElbow: [0, 0.22, -0.2],
    leftWrist: [-0.05, -0.04, 0.2], rightWrist: [-0.05, -0.04, -0.2],
    leftIndex: [-0.07, -0.14, 0.2], rightIndex: [-0.07, -0.14, -0.2],
    leftHip: [0, 0, 0.1], rightHip: [0, 0, -0.1],
    leftKnee: [-0.02, -0.44, 0.1], rightKnee: [-0.02, -0.44, -0.1],
    leftAnkle: [0, -0.86, 0.1], rightAnkle: [0, -0.86, -0.1],
    leftHeel: [0.05, -0.9, 0.1], rightHeel: [0.05, -0.9, -0.1],
    leftFootIndex: [-0.14, -0.92, 0.1], rightFootIndex: [-0.14, -0.92, -0.1],
  };
  return fillFace(s);
}

function fillFace(s) {
  const n = s.nose;
  const lsh = s.leftShoulder, rsh = s.rightShoulder;
  const side = [(lsh[0] - rsh[0]) / 0.4, 0, (lsh[2] - rsh[2]) / 0.4]; // unit-ish, person's left
  const off = (k) => [n[0] + side[0] * k, n[1] + 0.03, n[2] + side[2] * k];
  const face = {
    leftEyeInner: off(0.015), leftEye: off(0.03), leftEyeOuter: off(0.045),
    rightEyeInner: off(-0.015), rightEye: off(-0.03), rightEyeOuter: off(-0.045),
    leftEar: [n[0] + side[0] * 0.07, n[1], n[2] + side[2] * 0.07 - 0.06],
    rightEar: [n[0] - side[0] * 0.07, n[1], n[2] - side[2] * 0.07 - 0.06],
    mouthLeft: [n[0] + side[0] * 0.02, n[1] - 0.04, n[2]], mouthRight: [n[0] - side[0] * 0.02, n[1] - 0.04, n[2]],
    leftPinky: s.leftIndex, rightPinky: s.rightIndex, leftThumb: s.leftIndex, rightThumb: s.rightIndex,
  };
  return { ...s, ...face };
}

export const close = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
export const deg = (r) => (r * 180) / Math.PI;
