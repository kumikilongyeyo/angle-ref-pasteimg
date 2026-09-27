# Third-party notices

## x6ud/pose-search — MIT

https://github.com/x6ud/pose-search

The rig-transform approach (MediaPipe world landmarks → per-body-part orientations for a
hierarchical skeleton, and the `[x, -y, -z]` world-to-scene conversion) is adapted from
`src/components/SkeletonModelCanvas/landmarks-to-transforms.ts` and `src/utils/detect-pose.ts`.
AngleRef's skeleton is itself derived from this project. Used in
`src/pose/landmarks-to-transforms.js` and `src/pose/normalize-landmarks.js`.

```
MIT License

Copyright (c) 2021 x6ud

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## MediaPipe Tasks Vision 1.0.1 — Apache License 2.0

https://github.com/google-ai-edge/mediapipe — `vendor/mediapipe/vision_bundle.mjs`,
`vendor/mediapipe/wasm/vision_wasm_internal.{js,wasm}`, bundled unmodified from the
`@mediapipe/tasks-vision@1.0.1` npm package. Copyright The MediaPipe Authors. Licensed under
the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0

## MediaPipe Pose Landmarker models — Apache License 2.0

`models/pose_landmarker_heavy.task`, `models/pose_landmarker_full.task` (BlazePose GHUM 3D),
bundled unmodified from Google's MediaPipe model distribution
(https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker). Model card:
https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf

SHA-256:
- `pose_landmarker_heavy.task` 64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b
- `pose_landmarker_full.task` 4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad
- `vision_wasm_internal.wasm` 8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886

## Kalidokit

Consulted as a kinematics comparison only; no code used and not a dependency.

## Test pictures

Not shipped and not committed. `scripts/fetch-fixtures.mjs` downloads Creative-Commons pictures
from Openverse with a `credits.json`; `bench/catalog-fetch.mjs` downloads a sample of AngleRef's
public catalog photos (Unsplash) for local accuracy measurement.
