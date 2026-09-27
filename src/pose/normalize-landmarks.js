// MediaPipe scan result -> named points in AngleRef's camera space, plus per-landmark confidence.
//
// Camera space (verified against AngleRef's own getJointPoints(), see docs/P0-FINDINGS.md):
//   +x = viewer's right, +y = up, +z = towards the viewer (three.js camera frame).
// MediaPipe world landmarks: +x = image right, +y = DOWN, +z = AWAY from the camera, metres,
// origin at the hips, axes aligned with the camera. So camera = [x, -y, -z] — the same
// conversion x6ud/pose-search uses — checked by tests/transforms.test.js on T-pose and profile
// fixtures so left/right and front/back cannot silently flip.
(function (ARP) {
  'use strict';
  const { LM, LM_NAMES, LM_SWAP } = ARP.constants;
  const { mid } = ARP.math;

  const isInside = (p, margin = 0.02) => !!p && p.x > -margin && p.x < 1 + margin && p.y > -margin && p.y < 1 + margin;

  /** landmark confidence: MediaPipe visibility, zeroed when the point is outside the picture */
  function landmarkConfidence(p, margin = 0.02) {
    if (!isInside(p, margin)) return 0;
    const v = p.visibility ?? 1;
    const pr = p.presence ?? 1;
    return Math.max(0, Math.min(1, Math.min(v, pr)));
  }

  /**
   * @param {{landmarks: any[], worldLandmarks: any[], width: number, height: number}} scan
   * @returns {{points: Record<string, number[]>, img: Record<string, number[]>, conf: Record<string, number>, inside: Record<string, boolean>, aspect: number}}
   */
  function normalizeScan(scan) {
    const aspect = scan.width && scan.height ? scan.width / scan.height : 1;
    const points = {}, img = {}, conf = {}, inside = {};
    for (const name of LM_NAMES) {
      const w = scan.worldLandmarks[LM[name]];
      const l = scan.landmarks[LM[name]];
      points[name] = [w.x, -w.y, -w.z];
      // picture plane in the same handedness, aspect-corrected: +x right, +y up, height = 1
      img[name] = [(l.x - 0.5) * aspect, 0.5 - l.y];
      conf[name] = landmarkConfidence(l);
      inside[name] = isInside(l);
    }
    for (const [key, a, b] of [['neckMid', 'leftShoulder', 'rightShoulder'], ['pelvisMid', 'leftHip', 'rightHip']]) {
      points[key] = mid(points[a], points[b]);
      img[key] = [(img[a][0] + img[b][0]) / 2, (img[a][1] + img[b][1]) / 2];
      conf[key] = Math.min(conf[a], conf[b]);
      inside[key] = inside[a] && inside[b];
    }
    return { points, img, conf, inside, aspect };
  }

  const swapLR = (arr) => arr.map((_, i) => arr[LM_SWAP[i]]);

  /** Mirror the picture (selfie / flipped reference): reflect left-right and swap sides. */
  function mirrorScan(scan) {
    return {
      ...scan,
      landmarks: swapLR(scan.landmarks).map((p) => ({ ...p, x: 1 - p.x })),
      worldLandmarks: swapLR(scan.worldLandmarks).map((p) => ({ ...p, x: -p.x })),
    };
  }

  /**
   * Turn the body round without changing the picture: same 2D silhouette, sides swapped and depth
   * reversed. This is the classic single-image front/back ambiguity — a person seen from behind
   * read as if facing the camera.
   */
  // The detected points stay where they are; only their names swap (the image-right shoulder was
  // the person's right after all) and depth is reflected. A depth reflection is what turns a
  // back-facing body into a front-facing one, and it reverses handedness, hence the swap.
  function flipFacingScan(scan) {
    return {
      ...scan,
      landmarks: swapLR(scan.landmarks).map((p) => ({ ...p, z: -(p.z ?? 0) })),
      worldLandmarks: swapLR(scan.worldLandmarks).map((p) => ({ ...p, z: -p.z })),
    };
  }

  ARP.normalize = { normalizeScan, landmarkConfidence, mirrorScan, flipFacingScan };
})((globalThis.ARP = globalThis.ARP || {}));
