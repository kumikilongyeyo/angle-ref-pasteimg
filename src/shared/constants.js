// Shared tables. Loaded as a classic content script (namespace on globalThis.ARP) and imported by
// the node tests the same way. Every AngleRef-specific name lives here or in src/angleref/.
(function (ARP) {
  'use strict';

  // MediaPipe Pose Landmarker: all 33 landmarks, by index.
  const LM = {
    nose: 0,
    leftEyeInner: 1, leftEye: 2, leftEyeOuter: 3,
    rightEyeInner: 4, rightEye: 5, rightEyeOuter: 6,
    leftEar: 7, rightEar: 8,
    mouthLeft: 9, mouthRight: 10,
    leftShoulder: 11, rightShoulder: 12,
    leftElbow: 13, rightElbow: 14,
    leftWrist: 15, rightWrist: 16,
    leftPinky: 17, rightPinky: 18,
    leftIndex: 19, rightIndex: 20,
    leftThumb: 21, rightThumb: 22,
    leftHip: 23, rightHip: 24,
    leftKnee: 25, rightKnee: 26,
    leftAnkle: 27, rightAnkle: 28,
    leftHeel: 29, rightHeel: 30,
    leftFootIndex: 31, rightFootIndex: 32,
  };
  const LM_NAMES = Object.keys(LM);

  // left<->right partner of every landmark index (used by mirror / facing flip)
  const LM_SWAP = LM_NAMES.map((n) => {
    const other = n.startsWith('left') ? 'right' + n.slice(4) : n.startsWith('right') ? 'left' + n.slice(5) : n;
    return LM[other];
  });

  // AngleRef's bone-direction table, in AngleRef's order (camDirs[i]). Each entry is the direction
  // from `from` to `to` in camera space. Index 0 (the shoulder line) is not a bone; AngleRef's
  // applyPose() never reads it, but its mirror() does, so it is kept. `joint` is the id AngleRef's
  // Pose Lab uses for the matching search dot ("Selected dots are included in search").
  const BONES = [
    { i: 0, bone: null, from: 'rightShoulder', to: 'leftShoulder', joint: null, parent: null },
    { i: 1, bone: 'head', from: 'neckMid', to: 'nose', joint: 'head', parent: 'trunk' },
    { i: 2, bone: 'leftUpperArm', from: 'leftShoulder', to: 'leftElbow', joint: 'shoulder-l', parent: 'trunk' },
    { i: 3, bone: 'leftLowerArm', from: 'leftElbow', to: 'leftWrist', joint: 'elbow-l', parent: 'leftUpperArm' },
    { i: 4, bone: 'leftHand', from: 'leftWrist', to: 'leftIndex', joint: 'wrist-l', parent: 'leftLowerArm' },
    { i: 5, bone: 'rightUpperArm', from: 'rightShoulder', to: 'rightElbow', joint: 'shoulder-r', parent: 'trunk' },
    { i: 6, bone: 'rightLowerArm', from: 'rightElbow', to: 'rightWrist', joint: 'elbow-r', parent: 'rightUpperArm' },
    { i: 7, bone: 'rightHand', from: 'rightWrist', to: 'rightIndex', joint: 'wrist-r', parent: 'rightLowerArm' },
    { i: 8, bone: 'leftThigh', from: 'leftHip', to: 'leftKnee', joint: 'hip-l', parent: 'trunk' },
    { i: 9, bone: 'leftCalf', from: 'leftKnee', to: 'leftAnkle', joint: 'knee-l', parent: 'leftThigh' },
    { i: 10, bone: 'leftFoot', from: 'leftHeel', to: 'leftFootIndex', joint: 'ankle-l', parent: 'leftCalf' },
    { i: 11, bone: 'rightThigh', from: 'rightHip', to: 'rightKnee', joint: 'hip-r', parent: 'trunk' },
    { i: 12, bone: 'rightCalf', from: 'rightKnee', to: 'rightAnkle', joint: 'knee-r', parent: 'rightThigh' },
    { i: 13, bone: 'rightFoot', from: 'rightHeel', to: 'rightFootIndex', joint: 'ankle-r', parent: 'rightCalf' },
  ];
  const TORSO_JOINT = 'torso';

  // The landmarks each bone's confidence is taken from (the minimum of them). Wider than from/to
  // where one landmark alone is fragile: a foot needs its ankle too, the head its face.
  const BONE_EVIDENCE = {
    head: ['nose', 'leftShoulder', 'rightShoulder'],
    leftUpperArm: ['leftShoulder', 'leftElbow'],
    leftLowerArm: ['leftElbow', 'leftWrist'],
    leftHand: ['leftWrist', 'leftIndex'],
    rightUpperArm: ['rightShoulder', 'rightElbow'],
    rightLowerArm: ['rightElbow', 'rightWrist'],
    rightHand: ['rightWrist', 'rightIndex'],
    leftThigh: ['leftHip', 'leftKnee'],
    leftCalf: ['leftKnee', 'leftAnkle'],
    leftFoot: ['leftAnkle', 'leftHeel', 'leftFootIndex'],
    rightThigh: ['rightHip', 'rightKnee'],
    rightCalf: ['rightKnee', 'rightAnkle'],
    rightFoot: ['rightAnkle', 'rightHeel', 'rightFootIndex'],
  };

  // Confidence tiers (handoff §9). Tuned numbers, not sacred ones — see README "Tuning".
  const CONF = { HIGH: 0.65, LOW: 0.4 };

  ARP.constants = { LM, LM_NAMES, LM_SWAP, BONES, TORSO_JOINT, BONE_EVIDENCE, CONF };
})((globalThis.ARP = globalThis.ARP || {}));
