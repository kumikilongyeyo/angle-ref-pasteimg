// Rig transform solver: named camera-space landmarks -> AngleRef's pose format.
//
// AngleRef's skeleton is x6ud/pose-search's hierarchical SkeletonModel, re-engineered around
// camera-space bone directions: its JointGizmo.applyPose({camDirs, torsoBasis}) takes
//   camDirs[14]    — unit direction per bone (table in constants.BONES), camera space
//   torsoBasis[3]  — orthonormal [side, up, forward] frame of the trunk, camera space
// and aims each part at its child so child transforms stay local to the parent (the model does
// the parent-relative maths itself). The two builders below are ports of AngleRef's own
// (minified QL() and rA(); docs/P0-FINDINGS.md) — a round trip through the live skeleton matches
// to 1e-15 — adapted from the approach in x6ud/pose-search landmarks-to-transforms.ts (MIT,
// THIRD_PARTY_NOTICES.md).
(function (ARP) {
  'use strict';
  const { BONES, BONE_EVIDENCE } = ARP.constants;
  const { sub, norm, cross, mid, len, toBasis, fromBasis, slerpDir } = ARP.math;
  const C = () => ARP.confidence;

  const at = (p, k) => (k === 'neckMid' ? mid(p.leftShoulder, p.rightShoulder) : k === 'pelvisMid' ? mid(p.leftHip, p.rightHip) : p[k]);

  /** AngleRef camDirs from named points (their QL()) */
  const boneDirs = (p) => BONES.map((b) => norm(sub(at(p, b.to), at(p, b.from))));

  /**
   * AngleRef torso basis (their rA()): up = pelvis->neck, side from the hip line, forward = side x up.
   * With useHips=false the shoulder line gives the side (waist-up pictures).
   */
  function torsoBasis(p, useHips = true) {
    const up = norm(sub(at(p, 'neckMid'), at(p, 'pelvisMid')));
    const side = useHips ? norm(sub(p.leftHip, p.rightHip)) : norm(sub(p.leftShoulder, p.rightShoulder));
    const fwd = norm(cross(side, up));
    return [cross(up, fwd), up, fwd];
  }

  /**
   * Bone policy (tuned on AngleRef's catalog, README "Measured"):
   *   sure / unsure          -> the picture's direction
   *   weak, inside the frame -> still the picture's direction ("guess"): MediaPipe's estimate of
   *                             a hidden limb agrees with AngleRef's own pose to ~10° median,
   *                             far better than leaving a standing leg under a handstand
   *   weak, edited by hand   -> kept: never overwrite a correction of a joint the picture
   *                             cannot see (handoff §5)
   *   outside the frame      -> kept (a waist-up portrait leaves the legs alone)
   * "Kept" means the skeleton's current direction relative to the torso, so it turns with the body.
   *
   * @param {ReturnType<ARP.normalize.normalizeScan>} scan
   * @param {{current?: Record<string, number[]> | null, edited?: Set<string> | string[]}} opts
   *   current = AngleRef getJointPoints() now (camera space); edited = bones the user has posed
   *   by hand since the last apply
   */
  function solvePose(scan, opts = {}) {
    const { points, conf } = scan;
    const inside = scan.inside ?? {};
    const edited = new Set(opts.edited ?? []);
    const torso = C().torsoConfidence(conf);
    const basis = torsoBasis(points, torso.useHips);
    const dirs = boneDirs(points);

    let kept = null;
    if (opts.current) {
      const curBasis = torsoBasis(opts.current, true);
      const curDirs = boneDirs(opts.current);
      // current direction, re-expressed in the new torso frame
      kept = curDirs.map((d) => (len(d) < 0.5 ? null : fromBasis(toBasis(d, curBasis), basis)));
    }
    const keep = (i) => (kept?.[i] ? [kept[i], 'kept'] : [[0, 0, 0], 'rest']); // [0,0,0]: AngleRef leaves it at rest

    const bones = {};
    const camDirs = dirs.map((d, i) => {
      const b = BONES[i];
      if (!b.bone) return d; // shoulder line: not a bone, kept for mirror()
      const c = C().boneConfidence(conf, b.bone);
      const inFrame = BONE_EVIDENCE[b.bone].every((k) => inside[k] ?? true);
      const t = C().tier(c);
      let out, source;
      if (!inFrame) [out, source] = keep(i);
      else if (t === 'weak' && edited.has(b.bone)) [out, source] = keep(i);
      else if (t === 'unsure' && edited.has(b.bone) && kept?.[i]) (out = slerpDir(kept[i], d, C().applyWeight(c))), (source = 'blend');
      else (out = d), (source = t === 'weak' ? 'guess' : 'picture');
      bones[b.bone] = { conf: c, tier: inFrame ? t : 'outside', source, joint: b.joint, inFrame };
      return out;
    });

    return { camDirs, torsoBasis: basis, bones, torso };
  }

  /**
   * Bones whose direction (relative to the torso) differs between two skeleton snapshots by more
   * than `deg` — used to tell a hand correction from what the extension itself applied.
   */
  function editedBones(now, ref, deg = 3) {
    if (!now || !ref) return [];
    const bn = torsoBasis(now, true), br = torsoBasis(ref, true);
    const dn = boneDirs(now), dr = boneDirs(ref);
    const lim = Math.cos((deg * Math.PI) / 180);
    return BONES.filter((b) => b.bone && len(dn[b.i]) > 0.5 && len(dr[b.i]) > 0.5)
      .filter((b) => ARP.math.dot(toBasis(dn[b.i], bn), toBasis(dr[b.i], br)) < lim)
      .map((b) => b.bone);
  }

  ARP.solver = { boneDirs, torsoBasis, solvePose, editedBones, at };
})((globalThis.ARP = globalThis.ARP || {}));
