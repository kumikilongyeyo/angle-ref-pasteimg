import test from 'node:test';
import assert from 'node:assert/strict';
import { ARP, makeScan, tPose, profileFacingLeft, close, deg } from './helpers.js';

const { normalizeScan } = ARP.normalize;
const { solvePose, boneDirs, torsoBasis } = ARP.solver;
const { BONES } = ARP.constants;
const idx = (bone) => BONES.find((b) => b.bone === bone).i;

test('MediaPipe world -> camera space is [x, -y, -z]', () => {
  const scan = makeScan(tPose());
  const n = normalizeScan(scan);
  const w = scan.worldLandmarks[11]; // leftShoulder
  assert.deepEqual(n.points.leftShoulder, [w.x, -w.y, -w.z]);
});

test('front T-pose: person faces the viewer, their left arm points to the viewer’s right', () => {
  const pose = solvePose(normalizeScan(makeScan(tPose())));
  const [side, up, fwd] = pose.torsoBasis;
  assert.ok(close(up, [0, 1, 0], 1e-9), `up ${up}`);
  assert.ok(close(fwd, [0, 0, 1], 1e-9), `forward ${fwd} should face the viewer (+z)`);
  assert.ok(close(side, [1, 0, 0], 1e-9), `side ${side}`);
  assert.ok(close(pose.camDirs[idx('leftUpperArm')], [1, 0, 0], 1e-9));
  assert.ok(close(pose.camDirs[idx('rightUpperArm')], [-1, 0, 0], 1e-9));
  assert.ok(pose.camDirs[idx('head')][1] > 0.8, 'head points up');
  assert.ok(pose.camDirs[idx('leftCalf')][1] < -0.99, 'shins point down');
});

test('profile facing the viewer’s left: forward is -x, left side is towards the camera', () => {
  const pose = solvePose(normalizeScan(makeScan(profileFacingLeft())));
  const fwd = pose.torsoBasis[2];
  assert.ok(fwd[0] < -0.99, `forward ${fwd} should be -x`);
  // the feet point where the body faces
  assert.ok(pose.camDirs[idx('leftFoot')][0] < -0.9, 'feet point forward (-x)');
});

test('basis is orthonormal and right-handed', () => {
  for (const f of [tPose(), profileFacingLeft()]) {
    const B = torsoBasis(normalizeScan(makeScan(f)).points);
    const { dot, cross, len } = ARP.math;
    for (const v of B) assert.ok(Math.abs(len(v) - 1) < 1e-9);
    assert.ok(Math.abs(dot(B[0], B[1])) < 1e-9 && Math.abs(dot(B[1], B[2])) < 1e-9 && Math.abs(dot(B[0], B[2])) < 1e-9);
    assert.ok(close(cross(B[0], B[1]), B[2], 1e-9));
  }
});

test('boneDirs follows AngleRef’s table: 14 entries, [0] is the shoulder line', () => {
  const p = normalizeScan(makeScan(tPose())).points;
  const d = boneDirs(p);
  assert.equal(d.length, 14);
  assert.ok(close(d[0], [1, 0, 0], 1e-9), 'right shoulder -> left shoulder');
});

test('rotating the whole body rotates every output the same way (pose is view-independent)', () => {
  const { rotYPR, matMulVec, angle } = ARP.math;
  const R = rotYPR(0.7, 0.2, -0.1);
  const f = tPose();
  const rot = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, matMulVec(R, v)]));
  const a = solvePose(normalizeScan(makeScan(f))), b = solvePose(normalizeScan(makeScan(rot)));
  for (let i = 1; i < 14; i++) assert.ok(deg(angle(matMulVec(R, a.camDirs[i]), b.camDirs[i])) < 1e-6, `bone ${i}`);
  assert.ok(deg(angle(matMulVec(R, a.torsoBasis[2]), b.torsoBasis[2])) < 1e-6);
});
