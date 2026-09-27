// Tiny 3-vector / rotation helpers (plain arrays, no three.js in the extension).
(function (ARP) {
  'use strict';

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.sqrt(dot(a, a));
  const norm = (a) => {
    const l = len(a);
    return l < 1e-9 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
  };
  const angle = (a, b) => {
    const l = len(a) * len(b);
    return l < 1e-9 ? Math.PI : Math.acos(Math.max(-1, Math.min(1, dot(a, b) / l)));
  };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  /** spherical interpolation between two unit directions; t=0 → a, t=1 → b */
  function slerpDir(a, b, t) {
    const A = norm(a), B = norm(b);
    if (len(A) < 0.5) return B;
    if (len(B) < 0.5) return A;
    const w = angle(A, B);
    if (w < 1e-6) return B;
    if (Math.PI - w < 1e-4) {
      // opposite: go round any perpendicular
      const p = norm(Math.abs(A[0]) < 0.9 ? cross(A, [1, 0, 0]) : cross(A, [0, 1, 0]));
      return norm(add(scale(A, Math.cos(w * t)), scale(p, Math.sin(w * t))));
    }
    const s = Math.sin(w);
    return norm(add(scale(A, Math.sin((1 - t) * w) / s), scale(B, Math.sin(t * w) / s)));
  }

  /** express v in the orthonormal basis [e0,e1,e2] */
  const toBasis = (v, B) => [dot(v, B[0]), dot(v, B[1]), dot(v, B[2])];
  /** inverse of toBasis */
  const fromBasis = (l, B) => add(add(scale(B[0], l[0]), scale(B[1], l[1])), scale(B[2], l[2]));

  // ---- rotations as 3x3 row-major matrices ([[r00,r01,r02],[r10..],[r20..]])
  const matMulVec = (M, v) => [dot(M[0], v), dot(M[1], v), dot(M[2], v)];
  const matMul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
  const rotX = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
  const rotY = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
  const rotZ = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
  /** camera-frame rotation: yaw about Y, then pitch about X, then roll about Z (radians) */
  const rotYPR = (y, p, r) => matMul(rotZ(r), matMul(rotX(p), rotY(y)));
  /** rotation angle of a rotation matrix */
  const matAngle = (M) => Math.acos(clamp((M[0][0] + M[1][1] + M[2][2] - 1) / 2, -1, 1));

  ARP.math = { add, sub, scale, mid, dot, cross, len, norm, angle, clamp, slerpDir, toBasis, fromBasis, matMulVec, matMul, rotX, rotY, rotZ, rotYPR, matAngle };
})((globalThis.ARP = globalThis.ARP || {}));
