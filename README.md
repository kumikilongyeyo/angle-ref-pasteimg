# AngleRef Pose Scanner

Chrome extension for [AngleRef Bodies](https://angleref.com/bodies): paste a pose reference into
a small dock, press one button, and AngleRef's own 3D skeleton takes the pose — optionally the
picture's camera angle too — then AngleRef's search looks for matching photos.

**Paste → Scan → Apply pose (or Pose + camera) → AngleRef results.** Everything runs locally; the
picture never leaves your machine.

## Install

1. Clone this repo (or unzip a release).
2. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick the repo folder.
3. Open https://angleref.com/bodies. The **POSE SCANNER** dock sits bottom-right; drag it by its
   title, collapse it with **–**, or toggle it from the toolbar button.

## Using it

| | |
|---|---|
| **Paste / drop / upload** | ⌘/Ctrl+V anywhere on the page (an image with no text on the clipboard is always for the dock, even while a text box has focus), drop a file on the dock, or click it. An image dragged from another site works when that site allows it; otherwise copy-paste it. |
| **Overlay** | Green: sure. Yellow: unsure; yellow dashed: hidden in the picture, so MediaPipe's guess. Grey dashed: outside the picture, left as it is. |
| **Apply pose** | Poses the skeleton, keeps *your* camera. Search dots are locked for every bone that came from the picture (weak bones are left out of the search too). |
| **Pose + camera** | Also turns the view to the picture's — AngleRef's own rule, the same thing it does when you pick a photo's pose. Use this with "Match my view" to find the photo's angle. |
| **Mirror** | Uses the pose as if the picture were flipped (selfies, flipped references). |
| **Turn around** | For a person seen from behind who was read as facing you (or the other way round). |
| **Reset** | Puts the skeleton, view and search dots back exactly as they were before the first apply of this picture. |
| **Clear** | Empties the dock; leaves the skeleton alone. |
| **Search AngleRef after applying** | On by default. Only Apply pose / Pose + camera clicks search — Mirror and Turn around re-pose without spending a search, because **every search counts against AngleRef's daily free allowance**. When the allowance is used up the dock says so. |

The skeleton stays fully editable afterwards. What happens to a joint the picture does not show
clearly (tuned on data — see "Measured"):

- **outside the picture** (a waist-up portrait's legs): left exactly as it is, relative to the body;
- **hidden but inside the picture**: MediaPipe's guess is used and marked, because it measured
  far closer to AngleRef's own poses than keeping a default standing limb (a handstand with
  standing legs is worse than a guessed leg);
- **a hidden joint you posed by hand since the last apply**: your edit is kept. A rescan never
  overwrites a hand correction of a joint the picture cannot see.

This deliberately differs from the handoff's first-guess thresholds (§9 said to keep anything under
0.40): measured on 145 catalog photos, bones under 0.40 visibility still agree with AngleRef's pose
to ~8–10° median, and keeping them made the handstand and kneeling photos unfindable.

## How it works

```
dock (content script, closed shadow root)
  ├─ scanner  → offscreen document: MediaPipe Pose Landmarker Heavy/GPU → Heavy/CPU → Full/CPU
  │             33 landmarks + 33 world landmarks, all kept; biggest/clearest/most central person
  ├─ solver   → src/pose: MediaPipe world → AngleRef camera space [x,−y,−z],
  │             confidence per bone, 14 bone directions + torso basis in AngleRef's format
  └─ driver   → src/angleref/angleref-driver.js in the PAGE world: AngleRef's JointGizmo component
                exposes applyPose / getJointPoints / setView — no simulated dragging anywhere
```

The P0 spike and everything learned about AngleRef's runtime: [docs/P0-FINDINGS.md](docs/P0-FINDINGS.md).
Every AngleRef-specific selector and name is in `src/angleref/angleref-driver.js` (the `SEL` table).

Dev command on the live site (extension loaded), DevTools console:
`await __angleRefPoseScanner.selfTest()` — moves the right arm with no pointer input, restores it,
reports the error.

## Measured

**Agreement with AngleRef's own poses** — `bench/catalog-run.mjs` scans 150 photos from AngleRef's
public catalog (30 archetypes × 5, spread over view angles) and compares our pose with the pose
AngleRef stored for the same photo (its pipeline is MediaPipe too, and matching it is what makes
its search find the photo):

| | per-bone angle, median | mean | photos > 25° | torso facing, median |
|---|---|---|---|---|
| **shipped solver** (world landmarks, AngleRef's format, hidden bones guessed) | **7.4°** over 12.9 bones/photo | 9.9° | 8 / 145 | 5.1° |
| same, but bones under 0.40 left out (the handoff's first threshold) | 6.4° over fewer bones | 8.5° | 5 | 5.1° |
| + projection-fitted camera (`src/camera/camera-fitter.js`) | 8.0° | 10.0° | 6 | 5.7° |
| + 2D silhouette lift (`liftPose`) | 19.8° | 20.0° | 24 | 5.1° |

So the camera fitter and the lift are **not used** — both move the pose away from AngleRef's.
They stay in `src/camera/` for the bench. Detected 149/150; left/right swapped in 0/145.

Per-bone error by confidence (in frame): visibility ≥ 0.65 → 5.0° median; 0.4–0.65 → 6.1°; 0.25–0.4 → 9.4°; under 0.1 → 10.3°.

**Live end-to-end** (`npm run e2e`, the real extension in Chromium on angleref.com, 8 catalog
photos: arms raised, sitting on a chair, squat, lying on the back, kneeling, running, fighting
stance, handstand) — 108 checks, all passing on the final run:

- P0 self-test, dock placement / drag / reload, collapse, hidden away from /bodies;
- every case: detected, 13/13 bones applied, camera kept on Apply pose, search dots locked;
- **Pose + camera**: the view lands within a few degrees of the one AngleRef itself picks for that
  photo (e.g. handstand ours yaw 155 / pitch 42 / roll −126 vs AngleRef's 162 / 41 / −126), and
  AngleRef's search returns **the pasted photo itself** in its top results — rank 0 for lying,
  kneeling, fighting stance and handstand, 1–9 for the others;
- Mirror re-poses without spending a search; Reset restores joints to 5e-16 and the view exactly;
  hand-nudging a joint afterwards still works; Clear leaves the skeleton alone.

Pose-only keeps your camera, so "Match my view" finds the same pose from *your* angle — by design.

**Detection** — the person detector misses some people it would track fine once found (seen
from behind, waist-up, tightly framed). On a miss the scanner looks again with the picture padded
to a square, then with room below: this recovered the back-view soldier, waist-up portraits,
an anime drawing and a seated person in the fixture set (`bench/retry-probe.mjs`). A body found
only on a second look is flagged yellow, because a second look also finds "people" in cats and
street lamps.

## Acceptance checklist (handoff §15)

`node scripts/fetch-fixtures.mjs` downloads Creative-Commons pictures per case into
`tests/fixtures/images/` (not committed); `node bench/run.mjs` scans them all and writes contact
sheets with the overlay to `bench/out/` (cyan = the person's left, magenta = right).

| # | case | result |
|---|---|---|
| 1 | front, arms down | ✅ |
| 2 | A/T-pose | ✅ 6/6, 33/33 landmarks typical |
| 3 | 3/4 standing | ✅ |
| 4 | full profile | ✅ (catalog profile photos agree with AngleRef's pose) |
| 5 | sitting on a chair | ✅ (live e2e) |
| 6 | deep crouch | ✅ (live e2e: squat) |
| 7 | one arm overhead | ✅ (live e2e: arms raised) |
| 8 | arms crossed | ⚠️ applies; forearms often "unsure" — crossed forearms are ambiguous in depth |
| 9 | elbow foreshortening | ⚠️ direction right, depth is MediaPipe's estimate — check the side view |
| 10 | arm hidden behind torso | ✅ hidden arm uses MediaPipe's guess, marked yellow; a hand correction of it is kept |
| 11 | lower legs cropped | ✅ legs out of the picture are kept as they were (unit-tested) |
| 12 | upper-body portrait | ✅ torso oriented from the shoulders when hips are out of frame; tight portraits need the retry |
| 13 | back-facing | ✅ MediaPipe gets sides right from behind in the fixtures; **Turn around** if not |
| 14 | mirrored / selfie | ✅ **Mirror** (matches AngleRef's own mirror maths exactly, unit-tested) |
| 15 | low-res | ✅ 6/6 thumbnails |
| 16 | loose clothing / costume | ✅ 5/6 |
| 17 | stylised / anime | ⚠️ often not detected (1–2 of 6); line art fails more than painted |
| 18 | two people | ✅ uses the biggest, clearest, most central person and says how many it saw |

## Known failures

- **Stylised art / anime**: MediaPipe often finds nobody. No special-casing in V1 (handoff §10H).
- **False bodies on a second look**: flagged yellow; don't apply them.
- **Depth**: a single photo cannot fix depth; forearms pointing at the camera and crossed arms are
  the usual errors. The skeleton stays editable.
- **Twist** is not transferred — AngleRef's bones are aimed by direction only.
- **Multiple people**: always the clearest one; no picker (handoff: only if real use demands it).
- **Search allowance**: automatic searching spends AngleRef's free daily searches; untick the box
  to pose without searching.

## Manual test checklist

1. Load unpacked, open /bodies: dock bottom-right, not covering the filter bar.
2. Paste a full-body photo: overlay appears, "Person detected · N/33".
3. Apply pose: skeleton matches, camera unchanged, results update, dots locked.
4. Pose + camera: view turns to the photo's; results include similar-angle photos.
5. Mirror: pose flips, no new search. Reset: skeleton and view exactly as before.
6. Drag a joint by hand — still works. Clear: dock empties, skeleton untouched.
7. Paste a waist-up portrait: legs stay where they were.
8. Navigate to /hands and back: dock hides and returns.
9. Reload: dock remembers position, collapsed state and the search tick box.

## Development

```
npm install            # Playwright, for the e2e / bench / icons only
npm test               # unit tests (node:test): coordinate conversion, T-pose/profile fixtures, mirror, confidence, camera maths
npm run e2e            # live run on angleref.com (needs bench/catalog: node bench/catalog-fetch.mjs)
node bench/run.mjs     # fixture scan + contact sheets
node bench/catalog-run.mjs   # agreement with AngleRef's stored poses
npm run zip            # ../angle-ref-pasteimg-v<version>.zip for distribution
```

Plain JavaScript, no build step: content scripts share a `globalThis.ARP` namespace and are
listed in order in `manifest.json`; the node tests load the same files.

## Licences

MIT-licensed ideas and conventions from x6ud/pose-search; MediaPipe runtime and models under
Apache-2.0 — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
