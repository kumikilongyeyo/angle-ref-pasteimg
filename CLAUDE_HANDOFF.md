# AngleRef Paste Image -> 3D Pose Scanner
## Claude Implementation Handoff

**Canonical implementation repository:** https://github.com/kumikilongyeyo/angle-ref-pasteimg  
**Target site:** https://angleref.com/bodies  
**Reference implementation owned by the user:** https://github.com/kumikilongyeyo/Magic-Poser-extension  
**Primary open-source reference:** https://github.com/x6ud/pose-search  
**Secondary kinematics reference:** https://github.com/yeemachine/kalidokit

## 1. Mission

Build a Chrome extension for AngleRef Bodies that lets the user paste/drop/upload a pose reference image into a compact dock, detects the person's pose, converts the detected pose into 3D joint transforms, applies those transforms to AngleRef's existing 3D skeleton, and optionally fits the AngleRef camera to the reference image.

The intended workflow is deliberately low-friction:

**Paste image -> Scan -> Apply Pose -> optionally Match Camera -> use AngleRef search/results.**

Do not build a separate posing application. The feature should augment AngleRef's existing skeleton and search experience.

## 2. Feasibility conclusion

**GO.** The project is technically feasible.

The pose-detection half already exists in the user's Magic Poser extension. The open-source `x6ud/pose-search` project contains the complementary image-landmarks-to-3D-skeleton transform logic and is highly relevant to AngleRef's pose/search behavior.

The single most important unknown is runtime integration with the production AngleRef site: determine whether the extension can directly access or bridge into AngleRef's skeleton/model state. Prove this before investing in a polished UI.

Estimated difficulty:
- Basic paste + MediaPipe scan: low
- Landmarks -> 3D skeleton transform: medium, largely solved by references
- Direct AngleRef runtime bridge: medium/high, site-dependent
- Camera fitting: medium/high
- Robustness across occlusions/crops/site updates: medium

## 3. What is already solved in Magic-Poser-extension

The current Magic Poser helper already includes a browser-side pose scanner.

Important files:
- `scanner/pose-scanner.mjs`
- `scanner/autotrace-content.js`
- `scanner/autotrace.css`
- `manifest.json`

The scanner uses MediaPipe Pose Landmarker and returns both:
- normalized image landmarks
- `worldLandmarks`

It attempts Heavy/GPU first, then Heavy/CPU, then Full/CPU as a fallback.

Reuse the scanner concept and model-loading strategy, but **do not copy the Magic Poser 13-joint reduction as the core AngleRef pipeline.** AngleRef should preserve all 33 MediaPipe pose landmarks because the 3D world data is exactly what the skeleton transform solver needs.

Magic Poser currently follows a black-box workflow:

`Reference -> Auto Trace -> editable 2D stickman -> mapped visible controls -> simulated canvas dragging -> Magic Poser model`

AngleRef should use a cleaner route if possible:

`Reference -> MediaPipe 33 landmarks/world landmarks -> rig transform solver -> AngleRef skeleton state -> render/search`

## 4. Key open-source discovery: x6ud/pose-search

The strongest technical reference is:
https://github.com/x6ud/pose-search

It is MIT licensed. Preserve the required MIT notice for reused/substantially adapted code.

Useful areas:
- `src/utils/detect-pose.ts`
- `src/components/SkeletonModelCanvas/landmarks-to-transforms.ts`
- `src/components/SkeletonModelCanvas/SkeletonModelCanvas.ts`
- `src/components/SkeletonModelCanvas/model/SkeletonModel.ts`
- `src/components/SkeletonModelCanvas/model/SkeletonModelNode.ts`
- `src/Search/impl/*`

The project already demonstrates the core chain we need:

1. Detect a person with MediaPipe.
2. Produce 33 normalized landmarks and 33 world-space landmarks.
3. Convert world landmarks into per-body-part local orientation data.
4. Apply orientations to a hierarchical 3D skeleton.
5. Project and compare that skeleton for pose-reference searching.

The transform solver covers:
- trunk
- head
- left/right upper arm
- left/right lower arm
- left/right hand
- left/right thigh
- left/right calf
- left/right foot

The solver derives local `forward` and `up` vectors from landmark relationships, accounting for parent transforms. This is far preferable to guessing rotations from 2D screen coordinates.

## 5. Product UX

### V1 dock

Add a compact collapsible dock to `https://angleref.com/bodies`.

Primary states:

**Empty**
- Paste image
- Drag/drop image
- Upload image

**Scanned**
- reference preview
- pose detected status
- confidence/uncertain-joint indication
- primary CTA: `Apply Pose`
- secondary CTA: `Pose + Camera`
- `Mirror`
- `Reset`
- `Clear`

Keep this intentionally small. Do not add advanced sliders/configuration unless required for debugging.

Recommended layout:

```text
POSE SCANNER
[ paste / drop reference ]
[ reference preview ]
Person detected - 29/33 reliable landmarks

[ APPLY POSE ]
[ POSE + CAMERA ]

Mirror   Reset   Clear
```

The UI can live on the right side or bottom of AngleRef and should collapse to a small tab/handle.

### UX principles

- One obvious primary action.
- Automatic defaults over configuration.
- Keep low-confidence detection visible but non-blocking.
- Do not require perfect full-body images.
- The user must always be able to continue editing the AngleRef skeleton after auto-application.
- Never silently overwrite manually corrected low-confidence joints on a rescan unless the user explicitly reapplies.

## 6. Proposed architecture

```text
Chrome Extension (MV3)
|
+-- Content UI / Dock
|   +-- paste / drop / upload
|   +-- preview
|   +-- status / confidence
|   +-- Apply Pose / Pose + Camera / Mirror / Reset
|
+-- Pose Scanner
|   +-- MediaPipe Pose Landmarker Heavy
|   +-- fallback Full model
|   +-- normalizedLandmarks[33]
|   +-- worldLandmarks[33]
|
+-- Pose Normalizer
|   +-- coordinate-system conversion
|   +-- confidence filtering
|   +-- mirrored candidate generation
|
+-- Rig Transform Solver
|   +-- trunk/head
|   +-- arms/hands
|   +-- thighs/calves/feet
|   +-- local forward/up or quaternions
|
+-- AngleRef Driver (isolate ALL site-specific logic here)
|   +-- probeRuntime()
|   +-- readCurrentPose()
|   +-- applyPose(transforms)
|   +-- applyCamera(cameraState)
|   +-- reset()
|   +-- requestRender()
|   +-- requestSearchRefresh()
|
+-- Camera Fitter (Phase 2)
    +-- compare projected 3D joints to normalized 2D landmarks
    +-- optimize yaw/pitch/roll/zoom/target
```

## 7. CRITICAL P0: AngleRef compatibility spike

Do this before building the final UI.

Create the smallest possible extension/content script that runs only on:
`https://angleref.com/bodies*`

### Probe goals

1. Locate AngleRef's skeleton canvas and surrounding app root.
2. Identify framework/runtime shape (Vue instance/component proxy, exposed model, globals, event handlers, canvas state, etc.).
3. Determine whether the skeleton's model object or body nodes can be reached from an injected page-world script.
4. Programmatically alter one obvious joint, such as the right upper arm.
5. Force/update render.
6. Verify whether AngleRef's pose search state responds to the changed skeleton.
7. Restore the original state.

### P0 pass condition

A test script changes one body joint **without simulated mouse dragging** and the visible AngleRef skeleton updates correctly.

### P0 preferred integration order

1. Direct exposed model/state access.
2. Framework/component bridge.
3. Existing internal app events/actions.
4. Controlled pointer simulation against skeleton control points only as a fallback.

Do not start with visual computer-vision control mapping like Magic Poser unless direct/runtime approaches fail.

### Why this matters

Magic Poser requires control mapping because it behaves like a black box. AngleRef/x6ud-style skeletons are structured scene objects with hierarchical body nodes. Direct state access would be much more reliable and substantially simpler.

## 8. Pose pipeline

### Input
Accept:
- clipboard pasted image
- drag/drop image
- file upload

Normalize into an `ImageBitmap`, `HTMLImageElement`, or canvas-compatible source.

### Detection
Use MediaPipe Pose Landmarker.

Return:
```ts
type Landmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
};

type PoseScanResult = {
  landmarks: Landmark[];       // 33 normalized/image landmarks
  worldLandmarks: Landmark[];  // 33 world-space landmarks
};
```

### Coordinate normalization
Verify coordinate handedness against AngleRef before hardcoding assumptions.

The x6ud reference converts MediaPipe-style world coordinates along the lines of:
`[x, -y, -z]`

Treat this as a starting reference, not a blind constant. Write a small fixture test for front-facing T/A poses and profile poses so left/right and forward/back are not accidentally flipped.

### Transform solver
Port/adapt the mathematical approach in `landmarks-to-transforms.ts`.

Expected transform representation:
```ts
type BodyTransform = {
  forward: [number, number, number];
  up: [number, number, number];
  visibility: number;
};
```

Or convert those vectors into normalized quaternions inside the driver if AngleRef exposes joint rotations directly.

Important: child transforms must be local to the parent, not naive global Euler angles.

## 9. Confidence behavior

Do not reject an image just because a few landmarks are weak.

Suggested joint policy:
- `>= 0.65`: confident; apply normally
- `0.40-0.65`: uncertain; apply conservatively and mark yellow
- `< 0.40`: avoid aggressive overwrite; preserve current/default orientation when practical

Tune thresholds through testing; do not treat these exact numbers as sacred.

Composite body confidence should use the minimum/average of the landmarks needed to derive that bone.

Examples:
- upper arm: shoulder + elbow
- lower arm: elbow + wrist
- thigh: hip + knee
- calf: knee + ankle
- torso: both shoulders + both hips

## 10. Important gaps / failure modes

### A. Camera and pose are separate
Applying bone transforms is not enough to match the reference image's view.

Phase 1 can ship `Apply Pose` without camera matching.
Phase 2 should add `Pose + Camera`.

### B. Single-image depth ambiguity
A single RGB image cannot uniquely reveal all 3D depth. MediaPipe world landmarks provide a useful estimate, not ground truth.

Therefore:
- keep the AngleRef skeleton editable
- use conservative joint constraints
- expose confidence
- never claim pixel-perfect 3D reconstruction

### C. Occlusion
If an arm is hidden behind the torso, its predicted orientation may be weak.

Low-confidence limbs should retain prior/default state when needed instead of snapping into implausible configurations.

### D. Partial-body references
V1 should support useful partial poses.

Examples:
- portrait/upper-body -> apply torso/head/arms and leave legs unchanged
- cropped feet -> keep feet/ankles unchanged
- hidden hand -> apply arm but do not trust hand twist

### E. Mirroring
Generate normal and mirrored candidates internally. Prefer automatic selection when there is a meaningful confidence/projection advantage. Keep a manual `Mirror` button as an escape hatch.

### F. Twist ambiguity
Bone direction is easier to infer than roll/twist around the bone axis. Forearm, upper-arm, thigh, and calf twist should be conservative unless multiple landmarks strongly constrain the orientation.

### G. Multiple people
V1: choose the strongest/most central detected person.
Future: add person selection only if real usage demands it.

### H. Stylized/anime references
Pose Landmarker may work but confidence can degrade. Do not special-case anime in V1. Let confidence behavior degrade gracefully.

### I. Site updates
AngleRef internal runtime names may change. Put **every AngleRef-specific selector/runtime hook inside `AngleRefDriver`** so a future site update requires one adapter repair instead of a rewrite.

## 11. Camera fitting - Phase 2

Goal: make the 3D skeleton project into the screen similarly to the reference image.

### Variables to solve
Depending on AngleRef camera capabilities:
- yaw
- pitch
- roll if supported
- zoom/distance
- target/vertical offset
- optional perspective/FOV only if AngleRef exposes it

### Objective function
Project selected 3D skeleton joints into AngleRef screen space and minimize weighted 2D error against MediaPipe normalized landmarks.

Use reliable anchors first:
- shoulders
- hips
- knees
- elbows
- wrists
- ankles
- head center

Weight by landmark confidence.

Possible score:
```text
error = sum_i(confidence_i * squaredDistance(projectedJoint_i, referenceJoint_i))
```

Add regularization so the camera does not jump to extreme angles simply to fit noisy landmarks.

### Camera fitting strategy
1. Coarse candidate grid for yaw/pitch and optional mirror.
2. Fit zoom/target.
3. Local refinement.
4. Choose the lowest robust weighted error.

Keep the pose fixed while solving the camera.

## 12. Recommended repository structure

```text
angle-ref-pasteimg/
  manifest.json
  background.js
  src/
    content/
      content.js
      content.css
      dock-ui.js
    scanner/
      pose-scanner.mjs
      scanner-bridge.js
    pose/
      landmarks-to-transforms.js
      normalize-landmarks.js
      confidence.js
      mirror.js
    angleref/
      angleref-driver.js
      runtime-probe.js
      search-refresh.js
    camera/
      camera-fitter.js
      projection-error.js
    shared/
      math.js
      constants.js
  tests/
    fixtures/
    transforms.test.js
    mirror.test.js
    confidence.test.js
  THIRD_PARTY_NOTICES.md
  README.md
  CLAUDE_HANDOFF.md
```

Vanilla JS/ES modules are acceptable for V1. Avoid introducing a framework merely for the small dock unless there is a concrete gain.

## 13. Manifest / security expectations

Use Manifest V3.

Minimize permissions.

Likely needs:
- `storage` only if preferences/settings persist
- host permission for `https://angleref.com/*`
- MediaPipe CDN/model hosts only if assets are not bundled

Prefer bundling/pinning critical scanner dependencies before distribution so upstream CDN changes do not unexpectedly break the extension.

Do not upload the user's reference images to a remote server for V1. Run scanning locally in the browser.

## 14. Implementation milestones

### P0 - Runtime probe
**Goal:** prove direct control of AngleRef skeleton.

Deliver:
- minimal MV3 extension shell
- page-world bridge if required
- `runtime-probe.js`
- one button/dev command that changes one arm and restores it
- written result: direct bridge / framework bridge / event bridge / pointer fallback

**STOP HERE and document findings if direct control is impossible.** Decide the fallback architecture before proceeding.

### P1 - Paste + scan
Deliver:
- compact dock
- paste/drop/upload
- reference preview
- MediaPipe scan
- 33 normalized + world landmarks
- debug landmark overlay/status

Pass:
- common full-body photos detect reliably
- no network upload of user image

### P2 - Apply 3D pose
Deliver:
- landmark normalization
- x6ud-derived/adapted transform solver
- AngleRef driver integration
- `Apply Pose`
- confidence filtering
- reset/undo snapshot

Pass:
- front, 3/4, profile and seated poses transfer recognizably
- manual AngleRef posing remains functional afterward

### P3 - Robustness
Deliver:
- partial-body handling
- mirror candidate handling
- uncertainty display
- preservation of low-confidence joints
- extension/site lifecycle handling

Pass:
- cropped or occluded images fail gracefully instead of corrupting the pose

### P4 - Camera fit
Deliver:
- `Pose + Camera`
- projection-error function
- weighted optimization
- camera reset/snapshot

Pass:
- major reference view angles are recognizably closer than pose-only mode

### P5 - Polish
Deliver:
- compact collapsible UI
- fast scan feedback
- useful errors
- robust reload/navigation behavior
- README/install instructions
- licensing notices

## 15. Acceptance tests

Test at minimum:

1. Front-facing standing person, arms down.
2. A-pose/T-pose.
3. 3/4 standing pose.
4. Full profile.
5. Sitting on chair.
6. Deep crouch.
7. One arm raised overhead.
8. Arms crossed.
9. Strong elbow foreshortening toward camera.
10. One arm partially hidden behind torso.
11. Lower legs cropped out.
12. Upper-body-only portrait.
13. Back-facing pose.
14. Mirrored/selfie-style image.
15. Low-resolution Pinterest/reference image.
16. Loose clothing/costume silhouette.
17. Stylized illustration/anime character.
18. Two people in frame.

For every test record:
- detection success
- bad joints
- pose transfer readability
- left/right correctness
- whether mirror was correct
- camera improvement if applicable
- whether AngleRef search remains functional

## 16. Non-goals for V1

Do **not** spend early time on:
- hand/finger posing beyond AngleRef's available rig
- facial expressions
- multi-person UI
- video/live mocap
- cloud inference
- accounts/sync
- pose libraries
- export formats
- perfect anatomical IK
- a large settings screen

The core value is **paste a picture and get the AngleRef skeleton close enough to use immediately**.

## 17. Third-party / licensing notes

`x6ud/pose-search` is MIT licensed. If code is copied or substantially adapted, include its copyright/license notice in `THIRD_PARTY_NOTICES.md` and/or the relevant source headers as required by MIT.

Kalidokit is useful as a conceptual/kinematics comparison but is deprecated and should not become a required V1 dependency unless there is a strong reason.

MediaPipe licensing/redistribution requirements should also be documented according to the version actually used.

## 18. Claude working instructions

Claude: use **https://github.com/kumikilongyeyo/angle-ref-pasteimg** as the canonical repo for all implementation work.

Before writing production UI, complete P0 and write the integration findings into the repo. Do not assume AngleRef exposes the same object names as the x6ud source. Inspect the production runtime and isolate discoveries in `src/angleref/`.

Prefer direct model/state manipulation over synthetic mouse dragging. Only use pointer simulation if no maintainable state/event bridge exists.

Reuse the user's Magic Poser scanner for MediaPipe boot/fallback ideas, but preserve all 33 landmarks/world landmarks for this project. Use x6ud's transform math as the primary implementation reference and comply with its MIT license.

At the end of each milestone:
1. update README progress/status
2. document known failures
3. keep a simple reproducible manual test checklist
4. avoid moving to the next milestone if the current one cannot be demonstrated reliably

## 19. Definition of done

A user can open AngleRef Bodies, paste a single pose image into the extension dock, press one button, and see the existing AngleRef 3D skeleton move into a recognizably similar pose without manual mapping. Weak/hidden joints do not destroy the rest of the pose. The resulting skeleton remains editable and AngleRef's reference search continues to work.

Phase 2 done means the user can additionally choose `Pose + Camera` and receive a meaningfully closer viewing angle to the original reference.

---

### Source references

- AngleRef Bodies: https://angleref.com/bodies
- Target implementation repo: https://github.com/kumikilongyeyo/angle-ref-pasteimg
- User scanner reference: https://github.com/kumikilongyeyo/Magic-Poser-extension
- x6ud pose-search: https://github.com/x6ud/pose-search
- Kalidokit: https://github.com/yeemachine/kalidokit
