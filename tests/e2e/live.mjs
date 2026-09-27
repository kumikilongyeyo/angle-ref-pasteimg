// Live end-to-end run: the real extension in Chromium on https://angleref.com/bodies.
//   node tests/e2e/live.mjs            (HEADED=1 to watch; KEEP_GOING=1 to not stop on a failure)
// Uses photos from AngleRef's own catalog (bench/catalog, fetched by bench/catalog-fetch.mjs) so
// "did the search find the photo we pasted" is a real, checkable outcome.
// Screenshots -> tests/e2e/out/. Exits non-zero if any check failed.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = path.join(ROOT, 'tests/e2e/out');
fs.mkdirSync(OUT, { recursive: true });

// ---- test copy of the extension: open shadow root so Playwright can reach into the dock
const EXT = fs.mkdtempSync(path.join(os.tmpdir(), 'arps-ext-'));
for (const f of ['manifest.json', 'background.js', 'offscreen.html', 'icons', 'src', 'vendor', 'models']) fs.cpSync(path.join(ROOT, f), path.join(EXT, f), { recursive: true });
fs.writeFileSync(path.join(EXT, 'src/content/flags.js'), `(function (ARP) { ARP.flags = { shadowMode: 'open' }; })((globalThis.ARP = globalThis.ARP || {}));\n`);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok && !process.env.KEEP_GOING) throw new Error(`failed: ${name}`);
};

// ---- catalog photos to paste
const CAT = path.join(ROOT, 'bench/catalog');
const refs = JSON.parse(fs.readFileSync(path.join(CAT, 'refs.json'), 'utf8'));
const pick = (archetype) => refs.find((r) => r.archetype === archetype && fs.existsSync(path.join(CAT, r.file)));
const CASES = (process.env.CASES ?? 'standing-arms-raised,sitting-chair,squat').split(',').map(pick).filter(Boolean);

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arps-e2e-'));
const ctx = await chromium.launchPersistentContext(userDir, {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: +(process.env.DPR ?? 2),
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
const host = '#angleref-pose-scanner-host';
const status = () => page.locator(`${host} .status .txt`).textContent();
const waitStatus = async (re, timeout = 60000) => {
  const t0 = Date.now();
  let s = '';
  while (Date.now() - t0 < timeout) {
    s = await status();
    if (re.test(s)) return s;
    await page.waitForTimeout(150);
  }
  throw new Error(`status never matched ${re}: "${s}" / ${await page.locator(`${host} .detail`).textContent()}`);
};
const driver = (cmd, args) => page.evaluate(([c, a]) => window.__angleRefPoseScanner[c](a), [cmd, args]);
const maxErr = (a, b) => Math.max(...Object.keys(a).map((k) => Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1], a[k][2] - b[k][2])));
const setAutosearch = async (on) => {
  const box = page.locator(`${host} .autosearch`);
  if ((await box.isChecked()) !== on) await box.click();
};
// the same photo at any size: Unsplash 'photo-<id>', Flickr '<id>_<secret>' (size suffix dropped)
const photoKey = (url) => {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/photo-[\w-]+/);
    if (m) return m[0];
    const base = u.pathname.split('/').pop().replace(/\.\w+$/, '');
    return /^\d+_\w+/.test(base) ? base.replace(/_[a-z]$/, '') : null;
  } catch {
    return null;
  }
};

async function bucketImageUrl(ref) {
  const bucketId = (await (await fetch('https://angleref.com/catalog/bodies-v1/index.json')).json()).entries.find((e) => e[0] === ref.bodyId)?.[1];
  const b = await (await fetch(`https://angleref.com/catalog/bodies-v1/buckets/${bucketId}.json`)).json();
  return b.bodies.find((x) => x.bodyId === ref.bodyId)?.imageUrl;
}

try {
  await page.goto('https://angleref.com/bodies', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(host, { state: 'attached', timeout: 20000 });
  await page.waitForFunction(() => window.__angleRefPoseScanner?.probeRuntime().ready, null, { timeout: 30000 });
  check('one dock', (await page.locator(host).count()) === 1);
  const probe = await driver('probeRuntime');
  check('P0: skeleton reachable through the Vue component', probe.gizmo && probe.ready && probe.api.includes('applyPose'), JSON.stringify(probe));
  const st = await driver('selfTest');
  check('P0: self-test moves one arm with no pointer input and restores it', st.pass, JSON.stringify(st));
  await shot('01-dock');
  const dockBox = () => page.locator(`${host} .dock`).boundingBox();
  const b0 = await dockBox();
  check('dock does not cover AngleRef\'s filter bar', b0.y > 300, JSON.stringify(b0));
  const t = await page.locator(`${host} .title`).boundingBox();
  await page.mouse.move(t.x + 20, t.y + 5);
  await page.mouse.down();
  await page.mouse.move(t.x - 200, t.y - 120, { steps: 8 });
  await page.mouse.up();
  const b1 = await dockBox();
  check('dock can be dragged by its title', Math.abs(b1.x - (b0.x - 220)) < 3 && Math.abs(b1.y - (b0.y - 125)) < 3, `${JSON.stringify(b0)} -> ${JSON.stringify(b1)}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__angleRefPoseScanner?.probeRuntime().ready, null, { timeout: 30000 });
  const b2 = await dockBox();
  check('dragged position survives a reload', Math.abs(b2.x - b1.x) < 3 && Math.abs(b2.y - b1.y) < 3, JSON.stringify(b2));

  for (const [n, ref] of CASES.entries()) {
    const tag = `${n + 2}-${ref.archetype}`;
    const imageUrl = await bucketImageUrl(ref);
    await page.locator(`${host} input[type=file]`).setInputFiles(path.join(CAT, ref.file));
    const s1 = await waitStatus(/Person detected|No person|Scan failed|unclear/);
    check(`${ref.archetype}: detected`, /Person detected|unclear/.test(s1), s1);

    const before = await driver('readCurrentPose');
    // AngleRef counts every search against a daily free allowance: search once per case (after
    // Pose + camera), not on every click
    await setAutosearch(false);
    await page.locator(`${host} .apply`).click();
    const s2 = await waitStatus(/applied|Could not/);
    check(`${ref.archetype}: Apply pose`, /Pose applied/.test(s2), s2);
    const after = await driver('readCurrentPose');
    check(`${ref.archetype}: the skeleton moved`, maxErr(before.points, after.points) > 0.05);
    check(`${ref.archetype}: Apply pose keeps the camera`, JSON.stringify(before.view) === JSON.stringify(after.view), `${JSON.stringify(before.view)} vs ${JSON.stringify(after.view)}`);
    check(`${ref.archetype}: search dots locked`, after.locked.length >= 8, after.locked.join(','));
    const want = photoKey(imageUrl);
    const rankOf = async () => (await page.$$eval('img', (is) => is.map((i) => i.src))).map(photoKey).filter(Boolean).indexOf(want);
    await shot(`${tag}-a-pose`);

    await page.locator('.nb-search-strip').click().catch(() => {});
    await setAutosearch(true);
    await page.locator(`${host} .camera`).click();
    const s3 = await waitStatus(/applied|Could not/);
    const cam = await driver('readCurrentPose');
    check(`${ref.archetype}: Pose + camera changes the view`, /camera applied/.test(s3) && JSON.stringify(cam.view) !== JSON.stringify(before.view), JSON.stringify(cam.view));
    // wait for AngleRef's own search to finish (its submit button reads "Searching…" meanwhile)
    await page.waitForTimeout(500);
    await page.waitForFunction(() => !/searching/i.test(document.querySelector('#body-search-form [type=submit]')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const rank = await rankOf();
    check(`${ref.archetype}: after Pose + camera, AngleRef's search finds the pasted photo`, rank >= 0 && rank < 12, `rank ${rank}`);
    await shot(`${tag}-b-camera`);

    await page.locator('.nb-search-strip').click().catch(() => {});
    await page.locator(`${host} .mirror`).click();
    await waitStatus(/applied|Could not/);
    const mir = await driver('readCurrentPose');
    check(`${ref.archetype}: Mirror re-applies a different pose`, maxErr(mir.points, cam.points) > 0.05);
    check(`${ref.archetype}: Mirror does not spend a search`, !/searching/.test(await status()), await status());

    // the camera AngleRef itself picks for this photo (its stored pose through the same call)
    const refPose = { camDirs: Array.from({ length: 14 }, (_, i) => { const v = ref.jointDirs.slice(i * 3, i * 3 + 3).map((x) => x / 127); const l = Math.hypot(...v); return l < 0.5 ? [0, 0, 0] : v.map((x) => x / l); }),
      torsoBasis: (([x, y, z, w]) => [[1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)], [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)], [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]])(ref.torsoQuat) };
    const refView = (await driver('applyPose', { ...refPose, camera: true })).after.view;
    const wrap = (a) => Math.abs(((a + 540) % 360) - 180);
    const dYaw = wrap(cam.view.yaw - refView.yaw), dPitch = Math.abs(cam.view.pitch - refView.pitch);
    check(`${ref.archetype}: matched camera is near AngleRef's own for this photo`, dYaw <= 25 && dPitch <= 20, `ours ${JSON.stringify(cam.view)} vs AngleRef ${JSON.stringify(refView)}`);
    await shot(`${tag}-c-angleref-own`);

    await page.locator(`${host} .reset`).click();
    await waitStatus(/put back|Could not/);
    const back = await driver('readCurrentPose');
    check(`${ref.archetype}: Reset restores the skeleton exactly`, maxErr(back.points, before.points) < 1e-6, `err ${maxErr(back.points, before.points)}`);
    check(`${ref.archetype}: Reset restores the view`, JSON.stringify(back.view) === JSON.stringify(before.view));
  }

  // manual posing still works after an automatic apply: focus a dot, nudge it with the keyboard
  await setAutosearch(false);
  await page.locator(`${host} .apply`).click();
  await waitStatus(/applied|Could not/);
  await page.locator('.nb-search-strip').click().catch(() => {});
  await page.waitForTimeout(300);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(300);
  const pre = await driver('readCurrentPose');
  // a dot a person could actually click (in some poses the wrist dot sits on the elbow's)
  const dot = await page.evaluate(() => {
    for (const label of ['Left elbow', 'Right elbow', 'Left knee', 'Right knee', 'Left shoulder', 'Right shoulder']) {
      const el = document.querySelector(`.joint-dot[aria-label="${label}"]`);
      const r = el?.getBoundingClientRect();
      if (r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el) return label;
    }
    return null;
  });
  await page.locator(`.joint-dot[aria-label="${dot}"]`).click();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowUp');
  const post = await driver('readCurrentPose');
  check('manual editing still works after applying', maxErr(pre.points, post.points) > 0.02, `moved ${maxErr(pre.points, post.points).toFixed(3)}`);

  // Clear empties the dock, leaves the skeleton alone
  await page.locator(`${host} .clear`).click();
  const cleared = await driver('readCurrentPose');
  check('Clear leaves the skeleton as it is', maxErr(cleared.points, post.points) < 1e-9);
  check('Clear empties the dock', /Waiting/.test(await status()));

  // collapse / expand
  await page.locator(`${host} .collapse`).click();
  check('collapses to a tab', await page.locator(`${host} .tab`).isVisible());
  await page.locator(`${host} .tab`).click();
  check('expands again', await page.locator(`${host} .dock`).isVisible());

  // not on other pages of the site
  await page.locator('a[href="/hands"], a[href*="hands"]').first().click().catch(() => page.goto('https://angleref.com/hands'));
  await page.waitForTimeout(1500);
  check('dock hidden away from /bodies', !(await page.locator(host).isVisible()));
} catch (e) {
  console.log('ERROR', e.message);
  results.push({ name: 'run', ok: false, detail: e.message });
} finally {
  await shot('zz-final').catch(() => {});
  fs.writeFileSync(path.join(OUT, 'console.log'), logs.join('\n'));
  await ctx.close();
  fs.rmSync(EXT, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
