// Content script (isolated world): the dock's state machine.
//   picture -> scan (offscreen MediaPipe) -> solve (src/pose) -> AngleRef driver
(function (ARP) {
  'use strict';
  if (window.__arpsContentLoaded) return;
  window.__arpsContentLoaded = true;

  const { normalizeScan, mirrorScan, flipFacingScan } = ARP.normalize;
  const { solvePose } = ARP.solver;
  const { reliableCount, tier } = ARP.confidence;
  const { BONES, TORSO_JOINT } = ARP.constants;
  const bridge = ARP.angleref;

  const PREF = 'arps:prefs';
  const loadPrefs = () => {
    try {
      return { autosearch: true, collapsed: false, ...JSON.parse(localStorage.getItem(PREF) || '{}') };
    } catch {
      return { autosearch: true, collapsed: false };
    }
  };
  const prefs = loadPrefs();
  const savePrefs = () => {
    try {
      localStorage.setItem(PREF, JSON.stringify(prefs));
    } catch {}
  };

  const S = {
    img: null, // HTMLImageElement of the picture
    raw: null, // scanner result (33 + 33 landmarks)
    mirror: false,
    turn: false,
    busy: false,
    snapshot: null, // skeleton before the first apply of this picture (Reset, and weak-bone source)
    reference: null, // what the skeleton looked like when we last left it (page load, or our last apply): anything that differs was posed by hand
    applied: null, // {camera} of the last apply, so Mirror / Turn around re-apply it
    token: 0, // bumps on every new picture; stale scans are dropped
  };

  const BONE_LABEL = {
    head: 'head', leftUpperArm: 'left upper arm', leftLowerArm: 'left forearm', leftHand: 'left hand',
    rightUpperArm: 'right upper arm', rightLowerArm: 'right forearm', rightHand: 'right hand',
    leftThigh: 'left thigh', leftCalf: 'left shin', leftFoot: 'left foot',
    rightThigh: 'right thigh', rightCalf: 'right shin', rightFoot: 'right foot',
  };

  const ui = new ARP.DockUI({
    shadowMode: ARP.flags?.shadowMode ?? 'closed',
    on: {
      collapse: (c) => ((prefs.collapsed = c), savePrefs(), ui.setCollapsed(c), !c && warm()),
      image: (file) => takeBlob(file),
      drop: (dt) => takeDrop(dt),
      apply: (camera) => apply(camera, { search: prefs.autosearch }),
      toggle: (k) => toggle(k),
      reset: () => reset(),
      clear: () => clear(),
      autosearch: (v) => ((prefs.autosearch = v), savePrefs()),
      moved: (o) => ((prefs.offset = o), savePrefs()),
    },
  });
  ui.setCollapsed(prefs.collapsed);
  // a saved position from a bigger window must not leave the dock off-screen
  if (prefs.offset && prefs.offset.right < innerWidth - 120 && prefs.offset.bottom < innerHeight - 120) ui.setOffset(prefs.offset);
  ui.host.addEventListener('pointerenter', () => warm(), { once: true });

  // ------------------------------------------------------------------ helpers
  function candidate() {
    let s = S.raw;
    if (!s) return null;
    if (S.turn) s = flipFacingScan(s);
    if (S.mirror) s = mirrorScan(s);
    return s;
  }

  function controls() {
    ui.setControls({ canApply: !!S.raw, busy: S.busy, mirror: S.mirror, turn: S.turn, canReset: !!S.snapshot, hasImage: !!S.img, autosearch: prefs.autosearch });
  }

  function listBones(bones, pred) {
    return BONES.filter((b) => b.bone && pred(bones[b.bone])).map((b) => BONE_LABEL[b.bone]);
  }

  function describe(pose) {
    const guessed = listBones(pose.bones, (b) => b.source === 'guess');
    const outside = listBones(pose.bones, (b) => !b.inFrame);
    const edits = listBones(pose.bones, (b) => b.inFrame && (b.source === 'kept' || b.source === 'blend'));
    const parts = [];
    if (guessed.length) parts.push(`Hidden, guessed: ${guessed.join(', ')}`);
    if (outside.length) parts.push(`Outside the picture, left as they are: ${outside.join(', ')}`);
    if (edits.length) parts.push(`Kept your edits: ${edits.join(', ')}`);
    return parts.join(' · ');
  }
  const fromPicture = (b) => b.source === 'picture' || b.source === 'guess' || b.source === 'blend';

  let warming = null;
  function warm() {
    warming ??= chrome.runtime.sendMessage({ type: 'arps-warm' }).catch(() => (warming = null));
    return warming;
  }

  function redraw(pose) {
    const c = candidate();
    const norm = c ? normalizeScan(c) : null;
    // the overlay always shows the picture as it is; Mirror changes the pose, not the picture
    const shown = S.raw ? normalizeScan(S.turn ? flipFacingScan(S.raw) : S.raw) : null;
    const p = pose ?? (norm ? solvePose(norm) : null);
    let bones = p?.bones ?? null;
    if (bones && S.mirror) {
      // show each bone's confidence on the side of the picture it came from
      const swapped = {};
      for (const k in bones) swapped[k.startsWith('left') ? 'right' + k.slice(4) : k.startsWith('right') ? 'left' + k.slice(5) : k] = bones[k];
      bones = swapped;
    }
    ui.drawPreview(S.img, shown, bones, p ? tier(p.torso.conf) : 'weak');
  }

  // ------------------------------------------------------------------ picture intake
  async function takeBlob(blob) {
    if (!blob || !/^image\//.test(blob.type)) {
      ui.setStatus({ kind: 'err', text: 'That is not an image' });
      return;
    }
    const token = ++S.token;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    try {
      img.src = url;
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      ui.setStatus({ kind: 'err', text: 'Could not read that image' });
      return;
    }
    if (S.img?.src?.startsWith('blob:')) URL.revokeObjectURL(S.img.src);
    Object.assign(S, { img, raw: null, mirror: false, turn: false, snapshot: null, applied: null, busy: true });
    prefs.collapsed = false;
    savePrefs();
    ui.setCollapsed(false);
    redraw();
    controls();
    ui.setStatus({ kind: 'busy', text: 'Scanning the pose…' });

    try {
      // hand the scanner a JPEG no bigger than it needs
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.naturalWidth * k));
      cv.height = Math.max(1, Math.round(img.naturalHeight * k));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const image = cv.toDataURL('image/jpeg', 0.92);
      const r = await chrome.runtime.sendMessage({ type: 'arps-scan', image });
      if (token !== S.token) return; // a newer picture arrived
      S.busy = false;
      if (!r?.ok) {
        if (r?.error === 'superseded') return;
        throw new Error(r?.error || 'scanner unavailable');
      }
      if (!r.result) {
        ui.setStatus({ kind: 'err', text: 'No person found in this picture', detail: 'Try one where the body is larger or less hidden.' });
        controls();
        return;
      }
      S.raw = r.result;
      const norm = normalizeScan(S.raw);
      const pose = solvePose(norm);
      const n = reliableCount(norm.conf);
      const people = S.raw.people > 1 ? ` · ${S.raw.people} people, using the clearest` : '';
      if (S.raw.retry && S.raw.retry !== 'as is') {
        ui.setStatus({ kind: 'warn', text: `Found a body on a second look · ${n}/33 reliable landmarks${people}`, detail: 'Check the outline matches the person before applying. ' + describe(pose) });
      } else if (pose.torso.shoulders < 0.3) {
        ui.setStatus({ kind: 'warn', text: `Person found, but the shoulders are unclear${people}`, detail: 'The pose may be rough. ' + describe(pose) });
      } else {
        ui.setStatus({ kind: n >= 20 ? 'ok' : 'warn', text: `Person detected · ${n}/33 reliable landmarks${people}`, detail: describe(pose) });
      }
      redraw(pose);
      controls();
    } catch (e) {
      if (token !== S.token) return;
      S.busy = false;
      ui.setStatus({ kind: 'err', text: 'Scan failed', detail: String(e?.message ?? e) });
      controls();
    }
  }

  async function takeDrop(dt) {
    const f = [...(dt?.files ?? [])].find((x) => /^image\//.test(x.type));
    if (f) return takeBlob(f);
    // an image dragged from a web page: try its address
    const html = dt?.getData('text/html') || '';
    const src = html.match(/<img[^>]+src="([^"]+)"/i)?.[1] || dt?.getData('text/uri-list')?.split('\n')[0];
    if (!src) return ui.setStatus({ kind: 'err', text: 'Drop an image file, or paste the picture' });
    try {
      const res = await fetch(src.replace(/&amp;/g, '&'));
      if (!res.ok) throw new Error(String(res.status));
      return takeBlob(await res.blob());
    } catch {
      ui.setStatus({ kind: 'err', text: 'That site will not share the image', detail: 'Copy the image and paste it here instead (right-click → Copy image).' });
    }
  }

  document.addEventListener(
    'paste',
    (ev) => {
      if (ui.host.style.display === 'none') return;
      const item = [...(ev.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && /^image\//.test(i.type));
      if (!item) return;
      const t = ev.target;
      const editable = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName));
      // an image with no text: it is for us, even if a text box has focus
      if (editable && ev.clipboardData.types.includes('text/plain')) return;
      ev.preventDefault();
      takeBlob(item.getAsFile());
    },
    true,
  );

  // ------------------------------------------------------------------ applying
  async function apply(camera, { search = false } = {}) {
    const c = candidate();
    if (!c || S.busy) return;
    S.busy = true;
    controls();
    ui.setStatus({ kind: 'busy', text: camera ? 'Posing the skeleton and matching the view…' : 'Posing the skeleton…' });
    try {
      const probe = await bridge.waitReady(8000);
      if (!probe?.ready) throw new Error(probe?.gizmo === false ? 'Could not find AngleRef’s skeleton on this page' : 'AngleRef’s skeleton is still loading');
      S.snapshot ??= await bridge.read();
      const now = await bridge.read();
      const edited = ARP.solver.editedBones(now.points, S.reference?.points);
      const norm = normalizeScan(c);
      // Pose + camera uses AngleRef's own camera rule (the view that puts the torso where the
      // picture has it). A projection-fitted camera and a 2D silhouette lift were both measured
      // against AngleRef's catalog and made agreement worse (README "Measured"), so neither is used.
      const pose = solvePose(norm, { current: now.points, edited });
      const locks = [TORSO_JOINT, ...BONES.filter((b) => b.bone && fromPicture(pose.bones[b.bone])).map((b) => b.joint)];
      const res = await bridge.apply({ camDirs: pose.camDirs, torsoBasis: pose.torsoBasis, camera, locks, search });
      S.applied = { camera };
      S.reference = res.after;
      const fromPic = BONES.filter((b) => b.bone && fromPicture(pose.bones[b.bone])).length;
      const what = camera ? 'Pose + camera applied' : 'Pose applied';
      const extra = [`${fromPic}/13 bones from the picture`];
      if (res.limited) extra.push('AngleRef’s free searches are used up for today');
      else if (res.searched) extra.push('searching AngleRef');
      ui.setStatus({ kind: fromPic >= 11 ? 'ok' : 'warn', text: `${what} · ${extra.join(' · ')}`, detail: describe(pose) });
      redraw(pose);
          } catch (e) {
      ui.setStatus({ kind: 'err', text: 'Could not apply the pose', detail: String(e?.message ?? e) });
    } finally {
      S.busy = false;
      controls();
    }
  }

  function toggle(k) {
    S[k] = !S[k];
    controls();
    // re-pose only: every search counts against AngleRef's daily free allowance, so a Mirror or
    // Turn-around click does not spend one (Search bodies is right there)
    if (S.applied) apply(S.applied.camera, { search: false });
    else redraw();
  }

  async function reset() {
    if (!S.snapshot || S.busy) return;
    S.busy = true;
    controls();
    try {
      await bridge.restore(S.snapshot);
      S.reference = S.snapshot;
      S.snapshot = null;
      S.applied = null;
      ui.setStatus({ kind: 'idle', text: 'Skeleton put back as it was' });
    } catch (e) {
      ui.setStatus({ kind: 'err', text: 'Could not reset', detail: String(e?.message ?? e) });
    } finally {
      S.busy = false;
      controls();
    }
  }

  function clear() {
    if (S.img?.src?.startsWith('blob:')) URL.revokeObjectURL(S.img.src);
    S.token++;
    Object.assign(S, { img: null, raw: null, mirror: false, turn: false, applied: null, busy: false });
    redraw();
    controls();
    ui.setStatus({ kind: 'idle', text: 'Waiting for a picture' });
  }

  // ------------------------------------------------------------------ lifecycle
  // AngleRef is a single-page app: show the dock only on the Bodies page, however it was reached.
  const onBodies = () => /^\/bodies(\/|$)/.test(location.pathname);
  let shown = null;
  function syncRoute() {
    const v = onBodies();
    if (v !== shown) {
      shown = v;
      ui.setVisible(v);
    }
  }
  syncRoute();
  setInterval(syncRoute, 700);
  window.addEventListener('popstate', syncRoute);

  chrome.runtime.onMessage.addListener((m) => {
    if (m?.type !== 'arps-toggle') return;
    if (!onBodies()) return;
    prefs.collapsed = !prefs.collapsed;
    savePrefs();
    ui.setCollapsed(prefs.collapsed);
  });

  // the skeleton as the page first shows it: the reference for "posed by hand" until we apply
  bridge.waitReady(30000).then((p) => p?.ready && !S.reference && bridge.read().then((r) => (S.reference ??= r))).catch(() => {});

  controls();
})((globalThis.ARP = globalThis.ARP || {}));
