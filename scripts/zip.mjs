// npm run zip -> ../angle-ref-pasteimg-v<version>.zip containing only what the extension needs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = new URL('../', import.meta.url).pathname;
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const out = path.join(ROOT, '..', `angle-ref-pasteimg-v${version}.zip`);
fs.rmSync(out, { force: true });
const files = ['manifest.json', 'background.js', 'offscreen.html', 'icons', 'models', 'vendor', 'src', 'README.md', 'THIRD_PARTY_NOTICES.md'];
execFileSync('zip', ['-qr', '-X', out, ...files, '-x', '*.DS_Store'], { cwd: ROOT });
console.log(out, `${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
