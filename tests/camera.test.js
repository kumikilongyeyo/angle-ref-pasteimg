import test from 'node:test';
import assert from 'node:assert/strict';
import { ARP, makeScan, tPose, deg } from './helpers.js';

const { normalizeScan } = ARP.normalize;
const { projectionError } = ARP.projection;
const { fitCamera } = ARP.camera;

function crouchish() {
  const f = tPose();
  // bent arms and legs so the silhouette has depth to disagree about
  f.leftElbow = [0.3, 0.3, 0.25]; f.leftWrist = [0.2, 0.45, 0.45]; f.leftIndex = [0.18, 0.5, 0.55];
  f.rightKnee = [-0.15, -0.3, 0.35]; f.rightAnkle = [-0.14, -0.7, 0.2];
  return f;
}

test('projection error is 0 for an exact orthographic projection, >0 otherwise', () => {
  const n = normalizeScan(makeScan(crouchish()));
  const w = Object.fromEntries(ARP.projection.ANCHORS.map((k) => [k, 1]));
  assert.ok(projectionError(n.points, n.img, w).error < 1e-12);
  const { rotY, matMulVec } = ARP.math;
  const rot = Object.fromEntries(Object.entries(n.points).map(([k, v]) => [k, matMulVec(rotY(0.5), v)]));
  assert.ok(projectionError(rot, n.img, w).error > 0.01);
});

test('fit recovers a yaw drift between the world landmarks and the picture', () => {
  const f = crouchish();
  const scan = makeScan(f);
  // world landmarks drift 25° in yaw; the 2D picture is the truth
  const { rotY, matMulVec } = ARP.math;
  const drift = rotY((25 * Math.PI) / 180);
  const drifted = makeScan(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, matMulVec(drift, v)])));
  scan.worldLandmarks = drifted.worldLandmarks;
  const fit = fitCamera(normalizeScan(scan));
  assert.ok(fit.after < fit.before / 20, `error ${fit.before} -> ${fit.after}`);
  assert.ok(Math.abs(fit.ypr[0] + 25) < 2.5, `yaw ${fit.ypr}`);
});

test('fit leaves an already-matching body alone', () => {
  const fit = fitCamera(normalizeScan(makeScan(crouchish())));
  assert.ok(Math.hypot(...fit.ypr) < 1, `ypr ${fit.ypr}`);
});
