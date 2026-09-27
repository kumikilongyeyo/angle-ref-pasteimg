// node bench/sheet.mjs out.png file1 file2 ...  — quick side-by-side of fixture pictures
import { chromium } from 'playwright';
const [out, ...files] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage();
const fs = await import('node:fs');
const imgs = files.map((f) => `<figure style="margin:0"><img style="height:300px" src="data:image/jpeg;base64,${fs.readFileSync(new URL('../tests/fixtures/images/' + f, import.meta.url)).toString('base64')}"><figcaption style="font:11px monospace">${f}</figcaption></figure>`);
await p.setContent(`<body style="margin:0;display:flex;flex-wrap:wrap;gap:4px;width:1500px">${imgs.join('')}</body>`);
await p.screenshot({ path: out, fullPage: true }); await b.close();
