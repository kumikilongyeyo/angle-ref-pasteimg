import test from 'node:test';
import assert from 'node:assert/strict';
import { ARP, makeScan, tPose, close, deg } from './helpers.js';

const { normalizeScan, landmarkConfidence } = ARP.normalize;
const { solvePose } = ARP.solver;
const { applyWeight, tier } = ARP.confidence;
const { BONES } = ARP.constants;
const idx = (bone) => BONES.find((b) => b.bone === bone).i;

/** the default AngleRef skeleton, roughly: arms down, in camera space */
function armsDown() {
  const f = tPose();
  f.leftElbow = [0.22, 0.22, 0]; f.leftWrist = [0.23, -0.04, 0]; f.leftIndex = [0.23, -0.14, 0];
  f.rightElbow = [-0.22, 0.22, 0]; f.rightWrist = [-0.23, -0.04, 0]; f.rightIndex = [-0.23, -0.14, 0];
  return f;
}

test('tiers and weights', () => {
  assert.equal(tier(0.9), 'sure');
  assert.equal(tier(0.5), 'unsure');
  assert.equal(tier(0.2), 'weak');
  assert.equal(applyWeight(0.9), 1);
  assert.equal(applyWeight(0.2), 0);
  assert.ok(applyWeight(0.5) > 0.5 && applyWeight(0.5) < 1);
});

test('a landmark outside the picture has no confidence, whatever MediaPipe says', () => {
  assert.equal(landmarkConfidence({ x: 0.5, y: 1.3, visibility: 0.99 }), 0);
  assert.equal(landmarkConfidence({ x: -0.2, y: 0.5, visibility: 0.99 }), 0);
  assert.ok(landmarkConfidence({ x: 0.5, y: 0.5, visibility: 0.8 }) === 0.8);
});

test('a hidden (weak, in-frame) forearm uses the picture’s guess', () => {
  const current = normalizeScan(makeScan(armsDown())).points;
  const pose = solvePose(normalizeScan(makeScan(tPose(), { visibility: { leftWrist: 0.1 } })), { current });
  assert.equal(pose.bones.leftLowerArm.source, 'guess');
  assert.ok(close(pose.camDirs[idx('leftLowerArm')], [1, 0, 0], 1e-9));
});

test('a weak forearm the user posed by hand keeps their edit', () => {
  const current = normalizeScan(makeScan(armsDown())).points;
  const pose = solvePose(normalizeScan(makeScan(tPose(), { visibility: { leftWrist: 0.1 } })), { current, edited: ['leftLowerArm'] });
  assert.equal(pose.bones.leftLowerArm.source, 'kept');
  assert.ok(pose.camDirs[idx('leftLowerArm')][1] < -0.9, `kept direction ${pose.camDirs[idx('leftLowerArm')]}`);
  // a SURE bone is taken from the picture even if it was edited: the picture shows it
  const sure = solvePose(normalizeScan(makeScan(tPose())), { current, edited: ['leftLowerArm'] });
  assert.equal(sure.bones.leftLowerArm.source, 'picture');
});

test('kept bones are kept relative to the torso, not the camera', () => {
  // the picture's body is turned 90°; a kept forearm must turn with it
  const { rotY, matMulVec, angle } = ARP.math;
  const R = rotY(Math.PI / 2);
  const turned = Object.fromEntries(Object.entries(tPose()).map(([k, v]) => [k, matMulVec(R, v)]));
  const current = normalizeScan(makeScan(tPose())).points; // current skeleton: T-pose facing us
  const pose = solvePose(normalizeScan(makeScan(turned, { visibility: { leftWrist: 0.1 } })), { current, edited: ['leftLowerArm'] });
  const expected = matMulVec(R, [1, 0, 0]);
  assert.ok(deg(angle(pose.camDirs[idx('leftLowerArm')], expected)) < 1e-6);
});

test('outside the picture with nothing to keep: the bone is skipped ([0,0,0] leaves AngleRef’s rest pose)', () => {
  const pose = solvePose(normalizeScan(makeScan(armsDown(), { width: 800, height: 900, pxPerM: 900, originY: 1.08 })));
  assert.deepEqual(pose.camDirs[idx('leftCalf')], [0, 0, 0]);
  assert.equal(pose.bones.leftCalf.source, 'rest');
});

test('an unsure bone the user edited blends between their edit and the picture', () => {
  const current = normalizeScan(makeScan(armsDown())).points;
  const pose = solvePose(normalizeScan(makeScan(tPose(), { visibility: { leftWrist: 0.55 } })), { current, edited: ['leftLowerArm'] });
  const d = pose.camDirs[idx('leftLowerArm')];
  assert.equal(pose.bones.leftLowerArm.source, 'blend');
  assert.ok(d[0] > 0.7 && d[1] < 0 && d[1] > -0.7, `between down and out, nearer out: ${d}`);
});

test('editedBones spots a hand-moved bone, ignores a whole-body turn', () => {
  const { rotY, matMulVec } = ARP.math;
  const ref = normalizeScan(makeScan(armsDown())).points;
  const turned = Object.fromEntries(Object.entries(ref).map(([k, v]) => [k, matMulVec(rotY(1.1), v)]));
  assert.deepEqual(ARP.solver.editedBones(turned, ref), []);
  const moved = { ...ref, leftWrist: [0.5, 0.22, 0], leftIndex: [0.6, 0.22, 0] };
  assert.deepEqual(ARP.solver.editedBones(moved, ref), ['leftLowerArm', 'leftHand']);
});

test('upper-body portrait: legs out of frame are kept, torso still oriented from the shoulders', () => {
  // waist-up framing: the hips sit just below the bottom edge, the legs far below it
  const cropped = makeScan(armsDown(), { width: 800, height: 900, pxPerM: 900, originY: 1.08 });
  const current = normalizeScan(makeScan(armsDown())).points;
  const n = normalizeScan(cropped);
  const pose = solvePose(n, { current });
  for (const b of ['leftThigh', 'rightThigh', 'leftCalf', 'rightCalf', 'leftFoot', 'rightFoot']) {
    assert.equal(pose.bones[b].tier, 'outside', b);
    assert.equal(pose.bones[b].source, 'kept', b);
  }
  assert.equal(pose.bones.leftUpperArm.tier, 'sure');
  assert.equal(pose.torso.useHips, false, 'hips are out of the picture: orient from the shoulders');
  assert.ok(pose.torsoBasis[2][2] > 0.99, 'still facing the viewer');
});
