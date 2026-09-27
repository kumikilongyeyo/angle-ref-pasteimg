// node bench/pick-sheet.mjs out.png file...  — overlay tiles for chosen fixtures from results.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve } from './server.mjs';
const [out, ...files] = process.argv.slice(2);
const res = JSON.parse(fs.readFileSync(new URL('./out/results.json', import.meta.url)));
const srv = await serve(8794);
const b = await chromium.launch(); const p = await b.newPage();
await p.goto('http://localhost:8794/bench/harness.html'); await p.waitForFunction(() => window.benchReady);
const tiles = [];
for (const f of files) { const r = res.find((x) => x.file === f); tiles.push(await p.evaluate(([u, raw, l]) => bench.overlay(u, raw, l), [`/tests/fixtures/images/${f}`, r?.raw ?? null, `${f}\n${r?.raw?.retry ?? 'NOT FOUND'} rel ${r?.reliable ?? '-'}`])); }
await p.setContent(`<body style="margin:0;display:flex;flex-wrap:wrap;gap:4px;background:#ddd;width:1500px">${tiles.map((t) => `<img src="${t}">`).join('')}</body>`);
await p.screenshot({ path: out, fullPage: true }); await b.close(); srv.close();
