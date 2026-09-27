// How well a camera-space skeleton projects onto the picture's 2D landmarks.
//
// Orthographic, with the best scale + offset solved in closed form, so the number is about the
// SHAPE of the projection only (0 = identical shape, 1 = no better than a single dot). The
// picture's own camera is unknown, so perspective is not modelled.
(function (ARP) {
  'use strict';

  const ANCHORS = ['nose', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftHip', 'rightHip', 'leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'];

  /**
   * @param {Record<string, number[]>} pts3 camera-space points (only x,y are used)
   * @param {Record<string, number[]>} img picture points (aspect-corrected, +y up)
   * @param {Record<string, number>} w weight per anchor (confidence); anchors <= 0 are skipped
   */
  function projectionError(pts3, img, w, anchors = ANCHORS) {
    let W = 0, mx = 0, my = 0, qx = 0, qy = 0;
    for (const k of anchors) {
      const c = w[k] ?? 0;
      if (c <= 0 || !pts3[k] || !img[k]) continue;
      W += c;
      mx += c * pts3[k][0], my += c * pts3[k][1];
      qx += c * img[k][0], qy += c * img[k][1];
    }
    if (W <= 0) return { error: 1, scale: 0 };
    mx /= W, my /= W, qx /= W, qy /= W;
    let xx = 0, xq = 0, qq = 0;
    for (const k of anchors) {
      const c = w[k] ?? 0;
      if (c <= 0 || !pts3[k] || !img[k]) continue;
      const ax = pts3[k][0] - mx, ay = pts3[k][1] - my;
      const bx = img[k][0] - qx, by = img[k][1] - qy;
      xx += c * (ax * ax + ay * ay);
      xq += c * (ax * bx + ay * by);
      qq += c * (bx * bx + by * by);
    }
    if (qq < 1e-12 || xx < 1e-12) return { error: 1, scale: 0 };
    const s = xq / xx;
    // residual of the best fit, relative to the picture's own spread
    const error = Math.max(0, (qq - s * xq) / qq);
    return { error, scale: s };
  }

  /** mean 2D angle (radians) between projected bones and picture bones, confidence-weighted */
  function boneAngleError(pts3, img, conf) {
    const { BONES } = ARP.constants;
    const at = ARP.solver.at;
    const imgAt = (k) => (k === 'neckMid' ? mid2(img.leftShoulder, img.rightShoulder) : k === 'pelvisMid' ? mid2(img.leftHip, img.rightHip) : img[k]);
    let W = 0, E = 0;
    const per = {};
    for (const b of BONES) {
      if (!b.bone) continue;
      const c = Math.min(conf[b.from] ?? 0, conf[b.to] ?? 0);
      const p = ARP.math.sub(at(pts3, b.to), at(pts3, b.from));
      const q = [imgAt(b.to)[0] - imgAt(b.from)[0], imgAt(b.to)[1] - imgAt(b.from)[1]];
      const lp = Math.hypot(p[0], p[1]), lq = Math.hypot(q[0], q[1]);
      if (lp < 1e-6 || lq < 1e-6) continue;
      const a = Math.acos(Math.max(-1, Math.min(1, (p[0] * q[0] + p[1] * q[1]) / (lp * lq))));
      per[b.bone] = a;
      if (c <= 0) continue;
      W += c, E += c * a;
    }
    return { mean: W > 0 ? E / W : Math.PI, per };
  }
  const mid2 = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  ARP.projection = { projectionError, boneAngleError, ANCHORS };
})((globalThis.ARP = globalThis.ARP || {}));
