// Renders icons/icon{16,32,48,128}.png from the SVG below (dev-only; needs Playwright's Chromium).
import { chromium } from 'playwright';
import fs from 'node:fs';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<rect x="6" y="6" width="116" height="116" rx="14" fill="#F2604A" stroke="#141414" stroke-width="8"/>
<g fill="none" stroke="#141414" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
<circle cx="64" cy="31" r="10" fill="#FBF8F1"/>
<path d="M64 44 L64 76 M64 50 L40 36 M64 50 L90 62 M64 76 L46 104 M64 76 L84 102"/>
</g></svg>`;
const b = await chromium.launch();
const p = await b.newPage();
fs.mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const s of [16, 32, 48, 128]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<style>html,body{margin:0;background:transparent}</style>${SVG.replace('<svg ', `<svg width="${s}" height="${s}" `)}`);
  await p.screenshot({ path: new URL(`../icons/icon${s}.png`, import.meta.url).pathname, omitBackground: true });
}
await b.close();
