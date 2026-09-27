// node bench/run.mjs [filter]  -> bench/out/results.json + bench/out/sheet-*.png contact sheets
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './server.mjs';
const ROOT = new URL('../', import.meta.url).pathname;
const IMGS = path.join(ROOT, 'tests/fixtures/images');
const OUT = path.join(ROOT, 'bench/out');
fs.mkdirSync(OUT, { recursive: true });
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const files = fs.readdirSync(IMGS).filter((f) => /\.(jpe?g|png)$/i.test(f) && (!filter || filter.test(f))).sort();
const srv = await serve();
const b = await chromium.launch({ args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
p.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text()));
await p.goto('http://localhost:8790/bench/harness.html');
await p.waitForFunction(() => window.benchReady);
console.log('engine', await p.evaluate(() => bench.warm()));
const results = [], tiles = [];
for (const f of files) {
  const url = `/tests/fixtures/images/${f}`;
  const r = await p.evaluate((u) => bench.run(u).catch((e) => ({ url: u, error: String(e) })), url);
  const { raw, ...rest } = r;
  results.push({ file: f, ...rest, raw });
  const label = r.found ? `${f.slice(0, 30)}\nrel ${r.reliable} torso ${r.torso} ang ${r.angBefore}->${r.angAfter}° p${r.people}` : `${f.slice(0, 30)}\nNOT FOUND ${r.error ?? ''}`;
  tiles.push(await p.evaluate(([u, raw, l]) => bench.overlay(u, raw, l), [url, raw ?? null, label]));
  console.log(f.padEnd(34), r.found ? `rel=${r.reliable} torso=${r.torso} fwd=${r.fwd} face=${r.faceVis} proj ${r.projBefore}->${r.projAfter} ang ${r.angBefore}->${r.angAfter} ypr=${r.ypr} ${r.ms}ms` : 'NOT FOUND ' + (r.error ?? ''));
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
// contact sheets, 24 per page
for (let s = 0; s * 24 < tiles.length; s++) {
  const chunk = tiles.slice(s * 24, s * 24 + 24);
  await p.setContent(`<body style="margin:0;display:flex;flex-wrap:wrap;gap:4px;background:#ddd;width:1600px">${chunk.map((t) => `<img src="${t}">`).join('')}</body>`);
  await p.screenshot({ path: path.join(OUT, `sheet-${s + 1}.png`), fullPage: true });
}
await b.close();
srv.close();
