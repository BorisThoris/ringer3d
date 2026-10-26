// Keep the last few builds' hashed scripts and styles online after a deploy.
//
// A browser can hold a page from the previous deploy (an edge or tab that has not refreshed
// yet). Its script names change with every build, and the host answers a missing file with
// the app page, so that browser would load HTML as its script and show a blank page. Copying
// the previous builds' bundles into this one keeps those pages working until they reload.
//
// Run after `vite build`, before `wrangler deploy`. Bundles are remembered in
// .deploy-history/ (git-ignored); only the newest KEEP builds are kept.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const HISTORY = '.deploy-history';
const KEEP = 5;
const isBundle = (f) => /\.(js|css)$/.test(f);

mkdirSync(HISTORY, { recursive: true });
const builds = existsSync(join(HISTORY, 'builds.json')) ? JSON.parse(readFileSync(join(HISTORY, 'builds.json'), 'utf8')) : [];

// Remember this build's bundles.
const current = readdirSync(join(DIST, 'assets')).filter(isBundle);
for (const f of current) copyFileSync(join(DIST, 'assets', f), join(HISTORY, f));
builds.push({ at: new Date().toISOString(), files: current });
while (builds.length > KEEP) builds.shift();

// Bring older builds' bundles back into dist, and forget files no kept build needs.
const keep = new Set(builds.flatMap((b) => b.files));
let restored = 0;
for (const f of readdirSync(HISTORY)) {
  if (f === 'builds.json' || !statSync(join(HISTORY, f)).isFile()) continue;
  if (!keep.has(f)) {
    rmSync(join(HISTORY, f));
    continue;
  }
  if (!existsSync(join(DIST, 'assets', f))) {
    copyFileSync(join(HISTORY, f), join(DIST, 'assets', f));
    restored++;
  }
}
writeFileSync(join(HISTORY, 'builds.json'), JSON.stringify(builds, null, 2));
console.log(`keep-old-assets: ${current.length} bundles in this build, ${restored} restored from the last ${builds.length - 1} build(s)`);
