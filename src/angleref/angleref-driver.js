// AngleRef driver — runs in the PAGE's JavaScript world (manifest "world": "MAIN") because the
// skeleton lives in AngleRef's Vue app. EVERY AngleRef-specific hook is in this file (plus the
// selector list below), so a site update means one adapter repair, not a rewrite.
//
// How it reaches the skeleton (P0 result, docs/P0-FINDINGS.md): the Pose Lab's <JointGizmo>
// component `expose()`s { applyPose, getJointPoints, getView, setView, resetPose, isReady, ... }.
// Production Vue 3 keeps the app on #app.__vue_app__, and the component tree is walkable from
// app._container._vnode. The gizmo's applyPose({camDirs, torsoBasis}) is the same call AngleRef
// makes when you pick a photo's pose, so no pointer simulation is involved anywhere.
//
// Protocol: window.postMessage({__arps: 'req', id, cmd, args}) -> {__arps: 'res', id, ok, result|error}
(function () {
  'use strict';
  if (window.__angleRefPoseScanner) return;

  const SEL = {
    appRoot: '#app',
    gizmoName: 'JointGizmo',
    gizmoEl: '.joint-gizmo',
    reopenLab: '.nb-search-strip', // the collapsed "Pose Skelly · Edit search" bar
    labTab: '.lab-tab', // Joints | Camera | Text, in that order
    searchForm: '#body-search-form',
    searchLimit: '.search-limit-body', // AngleRef's "free searches used up" modal
  };
  // AngleRef's search-dot ids (joint ids of the "Selected dots are included in search" UI)
  const ALL_JOINTS = ['head', 'torso', 'shoulder-l', 'shoulder-r', 'elbow-l', 'elbow-r', 'wrist-l', 'wrist-r', 'hip-l', 'hip-r', 'knee-l', 'knee-r', 'ankle-l', 'ankle-r'];

  // ---- AngleRef pose format (ports of its QL()/rA(); duplicated from src/pose so this file
  // stays self-contained in the page world)
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const cross = (n, e) => [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]];
  const norm = (n) => {
    const l = Math.hypot(n[0], n[1], n[2]);
    return l < 1e-9 ? [0, 0, 0] : [n[0] / l, n[1] / l, n[2] / l];
  };
  const at = (p, k) => (k === 'pelvisMid' ? mid(p.leftHip, p.rightHip) : k === 'neckMid' ? mid(p.leftShoulder, p.rightShoulder) : p[k]);
  const PAIRS = [['rightShoulder', 'leftShoulder'], ['neckMid', 'nose'], ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'], ['leftWrist', 'leftIndex'], ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'], ['rightWrist', 'rightIndex'], ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'], ['leftHeel', 'leftFootIndex'], ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'], ['rightHeel', 'rightFootIndex']];
  const dirsOf = (p) => PAIRS.map(([a, b]) => norm(sub(at(p, b), at(p, a))));
  const basisOf = (p) => {
    const up = norm(sub(at(p, 'neckMid'), at(p, 'pelvisMid')));
    const fwd = norm(cross(norm(sub(p.leftHip, p.rightHip)), up));
    return [cross(up, fwd), up, fwd];
  };
  const maxPointError = (a, b) => Math.max(...Object.keys(a).map((k) => Math.hypot(...sub(a[k], b[k]))));

  // ---- finding the component
  function findComponent(vnode, name, seen = new Set()) {
    if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) return null;
    seen.add(vnode);
    const c = vnode.component;
    if (c) {
      if (c.type?.__name === name || c.type?.name === name) return c;
      const r = findComponent(c.subTree, name, seen);
      if (r) return r;
    }
    if (vnode.suspense) {
      const r = findComponent(vnode.suspense.activeBranch, name, seen);
      if (r) return r;
    }
    if (Array.isArray(vnode.children)) for (const ch of vnode.children) {
      const r = findComponent(ch, name, seen);
      if (r) return r;
    }
    return null;
  }

  let cached = null;
  function gizmo() {
    if (cached && !cached.isUnmounted && cached.exposed) return cached;
    cached = null;
    const app = document.querySelector(SEL.appRoot)?.__vue_app__;
    const root = app?._container?._vnode;
    if (!root) return null;
    const c = findComponent(root, SEL.gizmoName);
    if (c?.exposed?.applyPose) cached = c;
    return cached;
  }
  function api() {
    const g = gizmo();
    if (!g) throw new Error('AngleRef skeleton not found on this page');
    if (!g.exposed.isReady?.()) throw new Error('AngleRef skeleton is still loading');
    return g;
  }

  const plain = (x) => JSON.parse(JSON.stringify(x));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lockedJoints = (g) => [...(g.props?.lockedJoints ?? [])];

  // ---- the driver API (handoff §6)
  function probeRuntime() {
    const app = document.querySelector(SEL.appRoot)?.__vue_app__;
    const g = gizmo();
    return {
      vue: app ? app.version : null,
      gizmo: !!g,
      ready: !!g?.exposed?.isReady?.(),
      api: g ? Object.keys(g.exposed) : [],
      emit: typeof g?.emit === 'function',
      labVisible: labVisible(),
      searchForm: !!document.querySelector(SEL.searchForm),
      via: g ? 'vue-exposed' : 'none',
    };
  }

  function readCurrentPose() {
    const g = api();
    return plain({ points: g.exposed.getJointPoints(), view: g.exposed.getView(), locked: lockedJoints(g) });
  }

  function labVisible() {
    const el = document.querySelector(SEL.gizmoEl);
    return !!el && el.offsetParent !== null && el.getBoundingClientRect().height > 20;
  }

  /** make the Pose Lab visible and on its Joints tab, so the user sees what was applied */
  async function showLab() {
    if (!labVisible()) {
      document.querySelector(SEL.reopenLab)?.click();
      for (let i = 0; i < 20 && !labVisible(); i++) await sleep(50);
    }
    const tabs = document.querySelectorAll(SEL.labTab);
    if (tabs[0] && tabs[0].getAttribute('aria-pressed') !== 'true') {
      tabs[0].click();
      await sleep(30);
    }
    return labVisible();
  }

  function setLocks(ids) {
    const g = api();
    if (typeof g.emit !== 'function') return false;
    const want = new Set(ids.filter((id) => ALL_JOINTS.includes(id)));
    // 'select' toggles a dot, 'lock' only adds one (BodiesView's onSelect / onLock handlers)
    for (const id of lockedJoints(g)) if (!want.has(id)) g.emit('select', id);
    for (const id of want) if (!lockedJoints(g).includes(id)) g.emit('lock', id);
    return true;
  }

  function requestRender() {
    // every exposed call renders; setView(getView()) is the cheapest explicit one
    const g = api();
    g.exposed.setView(g.exposed.getView());
  }

  function requestSearchRefresh() {
    const form = document.querySelector(SEL.searchForm);
    if (!form) return false;
    // goes through AngleRef's own submit handler (its usage limits, its query building)
    if (form.requestSubmit) form.requestSubmit();
    else form.querySelector('[type=submit]')?.click();
    return true;
  }

  /**
   * @param {{camDirs: number[][], torsoBasis: number[][], camera?: boolean, locks?: string[], search?: boolean}} a
   *   camera=false keeps the user's current view (Apply Pose); true adopts the picture's (Pose + Camera)
   */
  async function applyPose(a) {
    await showLab();
    const g = api();
    const before = readCurrentPose();
    if (!g.exposed.applyPose({ camDirs: a.camDirs, torsoBasis: a.torsoBasis })) throw new Error('AngleRef refused the pose');
    if (!a.camera) g.exposed.setView(before.view);
    if (a.locks) setLocks(a.locks);
    const after = readCurrentPose();
    let searched = false, limited = false;
    if (a.search) {
      await sleep(30);
      searched = requestSearchRefresh();
      await sleep(400);
      limited = !!document.querySelector(SEL.searchLimit);
    }
    return { before, after, searched, limited };
  }

  function applyCamera(view) {
    api().exposed.setView(view);
    return readCurrentPose().view;
  }

  /** restore a snapshot taken by readCurrentPose() (Reset / undo) */
  async function restore(snap) {
    await showLab();
    const g = api();
    g.exposed.applyPose({ camDirs: dirsOf(snap.points), torsoBasis: basisOf(snap.points) });
    g.exposed.setView(snap.view);
    if (snap.locked) setLocks(snap.locked);
    return { error: maxPointError(snap.points, g.exposed.getJointPoints()) };
  }

  function reset() {
    api().exposed.resetPose();
    return readCurrentPose();
  }

  /** P0 dev command: move the right upper arm without any pointer input, then restore it. */
  async function selfTest() {
    const report = { probe: probeRuntime() };
    const g = api();
    const snap = readCurrentPose();
    const d = dirsOf(snap.points);
    d[5] = [0, 1, 0]; // rightUpperArm straight up in camera space
    d[6] = [0, 1, 0];
    g.exposed.applyPose({ camDirs: d, torsoBasis: basisOf(snap.points) });
    g.exposed.setView(snap.view);
    const moved = g.exposed.getJointPoints();
    report.rightWristMovedBy = Math.hypot(...sub(moved.rightWrist, snap.points.rightWrist));
    report.leftWristMovedBy = Math.hypot(...sub(moved.leftWrist, snap.points.leftWrist));
    await sleep(600); // long enough to see it
    report.restoreError = (await restore(snap)).error;
    report.pass = report.rightWristMovedBy > 0.3 && report.leftWristMovedBy < 1e-6 && report.restoreError < 1e-6;
    return report;
  }

  const COMMANDS = { probeRuntime, readCurrentPose, applyPose, applyCamera, restore, reset, setLocks, requestRender, requestSearchRefresh, showLab, selfTest };

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || ev.data?.__arps !== 'req') return;
    const { id, cmd, args } = ev.data;
    const reply = (m) => window.postMessage({ __arps: 'res', id, ...m }, location.origin);
    try {
      if (!COMMANDS[cmd]) throw new Error(`unknown command ${cmd}`);
      reply({ ok: true, result: plain((await COMMANDS[cmd](args)) ?? null) });
    } catch (e) {
      reply({ ok: false, error: String(e?.message ?? e) });
    }
  });

  // console dev hook: `await __angleRefPoseScanner.selfTest()`
  Object.defineProperty(window, '__angleRefPoseScanner', { value: Object.freeze({ ...COMMANDS }), configurable: false });
})();
