// node bench/catalog-run.mjs  -> per-photo agreement with AngleRef's stored pose, per variant
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './server.mjs';
const ROOT = new URL('../', import.meta.url).pathname;
const CAT = path.join(ROOT, 'bench/catalog');
const refs = JSON.parse(fs.readFileSync(path.join(CAT, 'refs.json'), 'utf8')).filter((r) => fs.existsSync(path.join(CAT, r.file)));
const VARIANTS = (process.env.VARIANTS ?? 'world,fit').split(',');
const srv = await serve(8792);
const b = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
await p.goto('http://localhost:8792/bench/harness.html');
await p.waitForFunction(() => window.benchReady);
console.log('engine', await p.evaluate(() => bench.warm()));
const rows = [];
for (const ref of refs) {
  const r = await p.evaluate(async ([u, ref, variants]) => {
    const s = await bench.run(u);
    if (!s.found) return { found: false };
    const out = { found: true, reliable: s.reliable };
    for (const v of variants) out[v] = bench.compare(s.raw, ref, v);
    return out;
  }, [`/bench/catalog/${ref.file}`, ref, VARIANTS]);
  rows.push({ bodyId: ref.bodyId, archetype: ref.archetype, yaw: ref.yaw, ...r });
  const f = (v) => (r[v] ? `${v} ${String(r[v].mean).padStart(5)}° torso ${String(r[v].torsoFwd).padStart(5)}°` : '');
  console.log(ref.archetype.padEnd(26), `yaw ${String(Math.round(ref.yaw)).padStart(4)}`, r.found ? `${VARIANTS.map(f).join(' | ')}  sw ${r.world?.swapped}  2d ${r.world?.same2d}` : 'NOT FOUND');
}
fs.mkdirSync(path.join(ROOT, 'bench/out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'bench/out/catalog.json'), JSON.stringify(rows, null, 1));
// summary (same person only: 2D shoulders/hips within 5% of the frame)
const ok = rows.filter((r) => r.found && r.world.same2d < 0.05);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
console.log(`\nfound ${rows.filter((r) => r.found).length}/${rows.length}, same person ${ok.length}`);
for (const v of VARIANTS) console.log(`${v.padEnd(8)} bone angle mean ${(ok.reduce((s, r) => s + r[v].mean, 0) / ok.length).toFixed(1)}° median ${med(ok.map((r) => r[v].mean)).toFixed(1)}°  torso fwd median ${med(ok.map((r) => r[v].torsoFwd)).toFixed(1)}°  >25°: ${ok.filter((r) => r[v].mean > 25).length}`);
console.log('left/right swapped better than straight:', ok.filter((r) => r.world.swapped < r.world.mean).length);
await b.close(); srv.close();
