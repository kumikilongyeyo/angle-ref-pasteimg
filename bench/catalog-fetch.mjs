// Dev-only benchmark set from AngleRef's own public body catalog: photos WITH the pose AngleRef
// stored for them (camera-space jointDirs + torsoQuat, from its own MediaPipe pipeline). Matching
// that pose is exactly what makes AngleRef's search find the photo, so it is the most meaningful
// accuracy target we have. Stratified by archetype and view. Not committed, not shipped.
//   node bench/catalog-fetch.mjs [perArchetype=5]
import fs from 'node:fs';
import path from 'node:path';
const OUT = new URL('./catalog/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'https://angleref.com/catalog/bodies-v1/';
const per = +(process.argv[2] ?? 5);
const idx = await (await fetch(BASE + 'index.json')).json();
const arch = (await (await fetch(BASE + 'archetypes.json')).json()).archetypes; // [id, slug]
const slug = new Map(arch.map(([id, s]) => [id, s]));
// entry: [bodyId, bucket, ?, yaw, pitch, roll, qx,qy,qz,qw, ..., 15 hidden?, 16 archetype, 17 poseVec, 18 jointDirs, 19 tags]
const byArch = new Map();
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const e of idx.entries) {
  if (e[15] === 1 || !Array.isArray(e[18])) continue;
  const a = e[16];
  if (!byArch.has(a)) byArch.set(a, []);
  byArch.get(a).push(e);
}
const picks = [];
for (const [a, list] of byArch) {
  // spread over yaw: sort by |yaw| and take evenly
  const s = list.map((e) => [rnd(), e]).sort((x, y) => x[0] - y[0]).map((x) => x[1]).slice(0, 400).sort((x, y) => Math.abs(x[3]) - Math.abs(y[3]));
  for (let i = 0; i < per && i < s.length; i++) picks.push(s[Math.floor(((i + 0.5) * s.length) / per)]);
}
const buckets = new Map();
const refs = [];
for (const e of picks) {
  if (!buckets.has(e[1])) buckets.set(e[1], new Map((await (await fetch(`${BASE}buckets/${e[1]}.json`)).json()).bodies.map((b) => [b.bodyId, b])));
  const b = buckets.get(e[1]).get(e[0]);
  if (!b?.imageUrl) continue;
  const file = `${e[0]}.jpg`;
  if (!fs.existsSync(OUT + file)) {
    const url = b.imageUrl.replace(/([?&])w=\d+/, '$1w=900');
    const res = await fetch(url);
    if (!res.ok) continue;
    fs.writeFileSync(OUT + file, Buffer.from(await res.arrayBuffer()));
  }
  refs.push({ bodyId: e[0], file, archetype: slug.get(e[16]) ?? e[16], yaw: e[3], pitch: e[4], roll: e[5], torsoQuat: e.slice(6, 10), jointDirs: e[18], imageLandmarks: b.imageLandmarks, imageWidth: b.imageWidth, imageHeight: b.imageHeight, landingUrl: b.landingUrl, creator: b.attribution?.creator });
}
fs.writeFileSync(OUT + 'refs.json', JSON.stringify(refs));
console.log(`${refs.length} catalog bodies across ${byArch.size} archetypes`);
