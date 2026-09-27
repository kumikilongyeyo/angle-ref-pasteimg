// Phase 2 camera fit: rotate the whole reconstructed body (equivalently, move the camera) so its
// projection matches the picture's 2D landmarks, keeping the pose fixed (handoff §11).
//
// MediaPipe's world landmarks are camera-aligned, but they come from a separate head of the
// network than the 2D landmarks and their overall rotation drifts, most in yaw. The 2D landmarks
// are the better witness of the view, so: coarse yaw/pitch/roll grid -> local refinement ->
// lowest robust, confidence-weighted projection error, with a small penalty per degree so noisy
// landmarks cannot drag the camera to an extreme angle.
(function (ARP) {
  'use strict';
  const { rotYPR, matMulVec, matAngle } = ARP.math;
  const { projectionError, ANCHORS } = ARP.projection;

  const DEG = Math.PI / 180;

  function rotatePoints(points, R) {
    const out = {};
    for (const k in points) out[k] = matMulVec(R, points[k]);
    return out;
  }

  /**
   * @param {ReturnType<ARP.normalize.normalizeScan>} scan
   * @param {{regPerDeg?: number, maxYaw?: number, maxPitch?: number, maxRoll?: number}} [o]
   * @returns {{R: number[][], ypr: number[], before: number, after: number}}
   */
  function fitCamera(scan, o = {}) {
    const reg = o.regPerDeg ?? 0.00008; // error units per degree of correction (a 25° yaw drift is only ~0.01 of error)
    const maxYaw = o.maxYaw ?? 60, maxPitch = o.maxPitch ?? 40, maxRoll = o.maxRoll ?? 25;
    const w = {};
    for (const k of ANCHORS) w[k] = scan.conf[k] >= ARP.constants.CONF.LOW ? scan.conf[k] : 0;

    const cost = (y, p, r) => {
      const R = rotYPR(y * DEG, p * DEG, r * DEG);
      const e = projectionError(rotatePoints(scan.points, R), scan.img, w).error;
      return e + reg * (matAngle(R) / DEG);
    };

    const before = projectionError(scan.points, scan.img, w).error;
    let best = { y: 0, p: 0, r: 0, c: cost(0, 0, 0) };
    for (let y = -maxYaw; y <= maxYaw; y += 10)
      for (let p = -maxPitch; p <= maxPitch; p += 10)
        for (let r = -maxRoll; r <= maxRoll; r += 5) {
          const c = cost(y, p, r);
          if (c < best.c) best = { y, p, r, c };
        }
    // local refinement: coordinate descent with a shrinking step
    for (let step = 5; step >= 0.25; step /= 2) {
      let moved = true;
      while (moved) {
        moved = false;
        for (const [dy, dp, dr] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const y = best.y + dy * step, p = best.p + dp * step, r = best.r + dr * step;
          if (Math.abs(y) > maxYaw || Math.abs(p) > maxPitch || Math.abs(r) > maxRoll) continue;
          const c = cost(y, p, r);
          if (c < best.c - 1e-9) (best = { y, p, r, c }), (moved = true);
        }
      }
    }
    const R = rotYPR(best.y * DEG, best.p * DEG, best.r * DEG);
    const after = projectionError(rotatePoints(scan.points, R), scan.img, w).error;
    return { R, ypr: [best.y, best.p, best.r], before, after };
  }

  /** apply a camera-space rotation to a solved pose (pose unchanged, view changed) */
  function rotatePose(pose, R) {
    return {
      ...pose,
      camDirs: pose.camDirs.map((d) => matMulVec(R, d)),
      torsoBasis: pose.torsoBasis.map((d) => matMulVec(R, d)),
    };
  }

  /**
   * Silhouette lift (experimental, measured in bench/): in the fitted camera frame, take each
   * sure bone's on-screen direction from the picture's 2D landmarks and only its depth from
   * MediaPipe's 3D (keeping the 3D bone length), so the skeleton's outline matches the picture.
   * Returns the pose with those bones replaced.
   */
  function liftPose(scan, pose, R) {
    const { BONES, CONF } = ARP.constants;
    const { at } = ARP.solver;
    const { sub, len, norm } = ARP.math;
    const pts = rotatePoints(scan.points, R);
    const w = {};
    for (const k of ANCHORS) w[k] = scan.conf[k] >= CONF.HIGH ? scan.conf[k] : 0;
    const { scale } = projectionError(pts, scan.img, w);
    if (!(scale > 0)) return pose;
    const imgAt = (k) => (k === 'neckMid' ? mid2(scan.img.leftShoulder, scan.img.rightShoulder) : k === 'pelvisMid' ? mid2(scan.img.leftHip, scan.img.rightHip) : scan.img[k]);
    const camDirs = pose.camDirs.slice();
    for (const b of BONES) {
      if (!b.bone || pose.bones[b.bone]?.source !== 'picture') continue;
      const p = sub(at(pts, b.to), at(pts, b.from));
      const L = len(p);
      if (L < 1e-6) continue;
      const q = sub2(imgAt(b.to), imgAt(b.from));
      const xy = [q[0] / scale, q[1] / scale];
      const l2 = xy[0] * xy[0] + xy[1] * xy[1];
      const z = l2 >= L * L ? 0 : Math.sign(p[2] || 1) * Math.sqrt(L * L - l2);
      camDirs[b.i] = norm([xy[0], xy[1], z]);
    }
    return { ...pose, camDirs };
  }
  const mid2 = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];

  ARP.camera = { fitCamera, rotatePose, rotatePoints, liftPose };
})((globalThis.ARP = globalThis.ARP || {}));
