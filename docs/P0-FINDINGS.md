# P0 — AngleRef runtime compatibility spike

**Result: direct bridge. No pointer simulation, no framework hacks beyond reading Vue's own
component tree.** Probed on production https://angleref.com/bodies on 2026-09-27
(bundle `assets/index-u-SCOsb7.js`, `BodiesView-Bq84JtU8.js`, `JointGizmo-DWTwsbVr.js`).

| Handoff probe goal | Finding |
|---|---|
| 1. Skeleton canvas + app root | `#app` (Vue 3 app, `__vue_app__`), skeleton canvas inside `.joint-gizmo`. three.js (`window.__THREE__`). |
| 2. Framework / runtime shape | Vue 3 production build, `<script setup>` SFCs. `setupState` is empty in prod, but `expose()`d APIs survive on `instance.exposed`. |
| 3. Model reachable from page world | Yes: walk `#app.__vue_app__._container._vnode` → component with `type.__name === 'JointGizmo'` → `instance.exposed`. |
| 4. Change one joint without dragging | `exposed.applyPose({camDirs, torsoBasis})` — right upper arm straight up, verified. |
| 5. Force / update render | Every exposed call renders; `setView(getView())` is the cheapest explicit render. |
| 6. Search responds | Yes. Locking dots + submitting `#body-search-form` returns matching photos (arms-overhead test → arms-overhead results). |
| 7. Restore | Re-applying the snapshot's own directions + `setView(snapshot.view)`: max joint error **5.6e-16**. |

Run it yourself on the live site (extension loaded): DevTools console → `await __angleRefPoseScanner.selfTest()`.

## The exposed gizmo API

```
resetPose()  resetView()  getView() -> {yaw, pitch, roll}  setView({yaw, pitch, roll})
getJointPoints() -> {nose, leftShoulder, …, rightFootIndex}   // camera space
applyPose({camDirs, torsoBasis}) -> boolean
isReady()  focusJoint(id)  nudgeFocused(…)
```

Events it emits to BodiesView (and which we can emit through `instance.emit`, which is how the
driver sets search locks): `select(jointId)` toggles a search dot, `lock(jointId)` adds one,
`posed`, `view`, `ready`, `focus`.

## AngleRef's pose format (what the solver must produce)

AngleRef's skeleton is x6ud/pose-search's hierarchical `SkeletonModel` (it credits x6ud), but the
public entry point is direction-based:

- **Camera space**: +x viewer's right, +y up, +z towards the viewer. `getJointPoints()` returns
  points in exactly this space.
- **`camDirs[14]`**: unit vector per bone, from→to, in camera space. Table (AngleRef's order):
  `0 rShoulder→lShoulder (not a bone)`, `1 neckMid→nose (head)`, `2–4 left upper arm / forearm /
  hand (wrist→index)`, `5–7 right`, `8–10 left thigh / shin / foot (heel→footIndex)`, `11–13 right`.
  A zero vector (length < 0.5) means "leave this bone alone".
- **`torsoBasis[3]`**: `[side, up, forward]`, up = pelvis→neck, side from the hip line,
  forward = side × up.
- `gizmo.applyPose` first sets the **view** so the torso sits in the camera as the basis says,
  then aims every part (children local to their parents, done by the model). That is the same
  call AngleRef makes when you pick a photo's pose — so "Pose + Camera" is AngleRef's own camera
  behaviour, and "Apply Pose" is that followed by restoring the user's previous view.
- Catalog poses (`/catalog/bodies-v1/index.json`) store the same thing: int8 `jointDirs` (÷127)
  and a `torsoQuat`; photos carry MediaPipe 33-point `imageLandmarks`. So AngleRef's own pipeline
  is MediaPipe too, and a pose that matches its format matches its search.

The solver ports these two builders (AngleRef's minified `QL()` and `rA()`); a round trip
through the live skeleton reproduces every joint to 4.6e-16.

## Search-dot ids

`torso, head, shoulder-l/r, elbow-l/r, wrist-l/r, hip-l/r, knee-l/r, ankle-l/r` — the part that
is posed by a dot is its bone (`shoulder-l` = left upper arm, etc.).

## UI lifecycle facts the driver handles

- After a search the Pose Lab collapses into a `.nb-search-strip` bar ("Pose Skelly · Edit
  search"); the gizmo stays **mounted** (same instance) but hidden. The driver clicks the strip to
  reopen it before applying, so the user sees the result.
- The lab has three tabs (`.lab-tab`: Joints, Camera, Text). A form submit searches in the active
  tab's mode, so the driver selects Joints first.
- Submitting `#body-search-form` goes through AngleRef's own handler, including its free-search
  limit. The extension never bypasses that.

## Everything site-specific is in one place

`src/angleref/angleref-driver.js` — the `SEL` table (selectors + component name) and the joint-id
list. If AngleRef renames the component, the probe reports `gizmo: false` and the dock says it
could not find the skeleton, instead of doing something wrong.
