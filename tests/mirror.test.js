import test from 'node:test';
import assert from 'node:assert/strict';
import { ARP, makeScan, tPose, profileFacingLeft, close } from './helpers.js';

const { normalizeScan, mirrorScan, flipFacingScan } = ARP.normalize;
const { solvePose } = ARP.solver;
const { BONES } = ARP.constants;
const idx = (bone) => BONES.find((b) => b.bone === bone).i;

function leftArmUp() {
  const f = tPose();
  f.leftElbow = [0.22, 0.78, 0];
  f.leftWrist = [0.24, 1.04, 0];
  f.leftIndex = [0.24, 1.14, 0];
  f.leftPinky = f.leftThumb = f.leftIndex;
  return f;
}

// AngleRef's own mirror of a pose (its minified Ife(): negate x of every direction, swap the
// left/right bones, and flip the basis) — our landmark-level mirror must agree with it.
function angleRefMirror({ camDirs, torsoBasis }) {
  const e = camDirs.map((t) => [-t[0], t[1], t[2]]);
  for (const [a, b] of [[2, 5], [3, 6], [4, 7], [8, 11], [9, 12], [10, 13]]) [e[a], e[b]] = [e[b], e[a]];
  e[0] = [-e[0][0], -e[0][1], -e[0][2]];
  const [n, u, t] = torsoBasis;
  return { camDirs: e, torsoBasis: [[n[0], -n[1], -n[2]], [-u[0], u[1], u[2]], [-t[0], t[1], t[2]]] };
}

test('mirror: the raised left arm becomes a raised right arm', () => {
  const m = solvePose(normalizeScan(mirrorScan(makeScan(leftArmUp()))));
  assert.ok(m.camDirs[idx('rightUpperArm')][1] > 0.9, 'right arm up after mirror');
  assert.ok(Math.abs(m.camDirs[idx('leftUpperArm')][1]) < 1e-9, 'left arm level after mirror');
});

test('mirror agrees with AngleRef’s own mirror() on every bone and the torso', () => {
  for (const f of [leftArmUp(), profileFacingLeft()]) {
    const scan = makeScan(f);
    const ours = solvePose(normalizeScan(mirrorScan(scan)));
    const theirs = angleRefMirror(solvePose(normalizeScan(scan)));
    for (let i = 0; i < 14; i++) assert.ok(close(ours.camDirs[i], theirs.camDirs[i], 1e-9), `bone ${i}: ${ours.camDirs[i]} vs ${theirs.camDirs[i]}`);
    // their basis mirror keeps the side vector's sign convention of the unmirrored frame; compare up/forward
    assert.ok(close(ours.torsoBasis[1], theirs.torsoBasis[1], 1e-9));
    assert.ok(close(ours.torsoBasis[2], theirs.torsoBasis[2], 1e-9));
  }
});

test('mirror twice is the identity', () => {
  const scan = makeScan(leftArmUp());
  const twice = mirrorScan(mirrorScan(scan));
  const flat = (a) => a.flatMap((p) => [p.x, p.y, p.z, p.visibility]);
  assert.ok(close(flat(twice.worldLandmarks), flat(scan.worldLandmarks), 1e-12));
  assert.ok(close(flat(twice.landmarks), flat(scan.landmarks), 1e-12));
});

test('turn around: same silhouette, body faces the other way, sides swapped', () => {
  const scan = makeScan(leftArmUp());
  const t = flipFacingScan(scan);
  const a = normalizeScan(scan), b = normalizeScan(t);
  // the same set of picture points
  const pts = (n) => Object.values(n.img).map((p) => p.map((v) => v.toFixed(6)).join()).sort();
  assert.deepEqual(pts(a), pts(b));
  const pa = solvePose(a), pb = solvePose(b);
  assert.ok(pa.torsoBasis[2][2] > 0.99 && pb.torsoBasis[2][2] < -0.99, 'front becomes back');
  // the arm raised on the viewer's right is now the person's RIGHT arm (seen from behind)
  assert.ok(pb.camDirs[idx('rightUpperArm')][1] > 0.9 && Math.abs(pb.camDirs[idx('leftUpperArm')][1]) < 1e-9);
  assert.deepEqual(flipFacingScan(t).worldLandmarks, scan.worldLandmarks);
});
