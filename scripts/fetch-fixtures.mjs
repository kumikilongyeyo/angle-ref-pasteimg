// Dev-only acceptance pictures (handoff §15): a few Creative-Commons images per case from
// Openverse -> tests/fixtures/images/<case>__<n>.jpg + credits.json. Not shipped, not committed.
//   node scripts/fetch-fixtures.mjs [case ...]
import fs from 'node:fs';
const OUT = new URL('../tests/fixtures/images/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
export const CASES = {
  '01-front-standing': 'man standing front view full body',
  '02-t-pose': 'arms outstretched',
  '03-three-quarter': 'fashion model posing',
  '04-profile': 'man walking side view',
  '05-sitting-chair': 'person sitting on a chair full body',
  '06-deep-crouch': 'crouching',
  '07-arm-overhead': 'person raising one arm up',
  '08-arms-crossed': 'man arms crossed standing',
  '09-foreshortening': 'person pointing at camera',
  '10-arm-hidden': 'woman hand behind back',
  '11-legs-cropped': 'woman standing outdoors',
  '12-upper-body': 'man waist up portrait',
  '13-back-facing': 'person walking away from camera back view',
  '14-selfie': 'mirror selfie full body',
  '15-low-res': 'dancer pose',
  '16-costume': 'cosplay costume full body',
  '17-anime': 'anime girl drawing',
  '18-two-people': 'two people dancing',
};
const only = process.argv.slice(2);
const credPath = OUT + 'credits.json';
const credits = fs.existsSync(credPath) ? JSON.parse(fs.readFileSync(credPath, 'utf8')) : [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [key, q] of Object.entries(CASES)) {
  if (only.length && !only.includes(key)) continue;
  const u = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=12&license_type=all-cc&mature=false`;
  const j = await (await fetch(u)).json().catch(() => ({ results: [] }));
  let got = 0;
  for (const r of j.results ?? []) {
    if (got >= 6) break;
    const name = `${key}__${got}.jpg`;
    try {
      const res = await fetch(key === '15-low-res' ? r.thumbnail : r.url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 4000 || buf.length > 8e6) continue;
      fs.writeFileSync(OUT + name, buf);
      const i = credits.findIndex((c) => c.file === name);
      const c = { file: name, title: r.title, creator: r.creator, license: `${r.license} ${r.license_version}`, url: r.foreign_landing_url };
      i >= 0 ? (credits[i] = c) : credits.push(c);
      got++;
    } catch {}
    await sleep(120);
  }
  console.log(key, got);
  await sleep(300);
}
fs.writeFileSync(credPath, JSON.stringify(credits, null, 1));
