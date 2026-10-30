// Builds the Marble Forge asset pack and its itch.io store media, by driving the Forge page in a
// headless browser. Build the Forge first (npx vite build --config packages/marble-forge/vite.config.ts).
//
//   node packages/marble-forge/scripts/pack.mjs
//     OUT_DIR     where to build (default e2e-out/pack)
//     LIMIT       marbles per tier, for a quick trial run (default: the full pack)
//     CHROME_PATH Chrome to drive
//
// Output: <OUT>/MarbleForge-Vol1/ (the pack), MarbleForge-Vol1.zip, MarbleForge-Generator.zip (the
// source), MarbleForge-Web.zip (the Forge as an itch.io HTML5 upload) and store/ (page media).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.OUT_DIR ?? 'e2e-out/pack';
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : null;
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VOL = 'MarbleForge-Vol1';
const PACK = join(OUT, VOL);
const STORE = join(OUT, 'store');
const SIZES = [1024, 512, 256, 128, 64];
/** Marbles per tier (without a phenomenon), then per phenomenon. */
const PLAN = { Common: 100, Rare: 70, Epic: 55, Legendary: 40, Mythic: 25 };
const PER_EFFECT = 5;
const TURN_FRAMES = 32;
// Windows' own bsdtar writes zips; a Git-for-Windows tar on the PATH reads 'D:' as a remote host.
const TAR = process.platform === 'win32' ? 'C:/Windows/System32/tar.exe' : 'tar';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const save = (path, b64) => writeFileSync(path, Buffer.from(b64, 'base64'));

rmSync(OUT, { recursive: true, force: true });
for (const d of [...SIZES.map((s) => `png/${s}`), 'glb', 'sheets', 'phenomena']) mkdirSync(join(PACK, d), { recursive: true });
mkdirSync(STORE, { recursive: true });

const server = await preview({ configFile: join(PKG, 'vite.config.ts'), preview: { port: 4192, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--user-data-dir=${join(OUT, 'profile')}`],
});
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:4192/', { waitUntil: 'networkidle2', timeout: 90000 });

  // ---- Choose the marbles: fixed seeds, so every build of the pack is the same pack. ----------
  const chosen = await page.evaluate(
    (plan, perEffect, limit) => {
      const out = [];
      const names = new Set();
      for (const [tier, n0] of Object.entries(plan)) {
        const n = limit ?? n0;
        const byPattern = {};
        for (let seed = 1, got = 0; got < n && seed < 200000; seed++) {
          const m = window.forge.resolve(`${seed}:${tier}`).marble;
          if (m.effect !== 'none' || names.has(m.name)) continue;
          // Spread the patterns: no pattern more than its share (+1) of the tier.
          const cap = Math.ceil(n / 4);
          if ((byPattern[m.pattern] ?? 0) >= cap) continue;
          byPattern[m.pattern] = (byPattern[m.pattern] ?? 0) + 1;
          names.add(m.name);
          out.push({ id: `${seed}:${tier}`, group: tier });
          got++;
        }
      }
      for (const effect of ['aurora', 'inferno', 'void', 'storm', 'geode', 'starfall']) {
        for (let seed = 1, got = 0; got < (limit ? 1 : perEffect) && seed < 400000; seed++) {
          const tier = seed % 3 === 0 ? 'Mythic' : 'Legendary';
          const m = window.forge.resolve(`${seed}:${tier}`).marble;
          if (m.effect !== effect || names.has(m.name)) continue;
          names.add(m.name);
          out.push({ id: `${seed}:${tier}`, group: 'Phenomena' });
          got++;
        }
      }
      return out;
    },
    PLAN,
    PER_EFFECT,
    LIMIT,
  );
  log(`chose ${chosen.length} marbles`);

  // ---- Render ---------------------------------------------------------------------------------
  const manifest = [];
  const icons = [];
  for (const [i, c] of chosen.entries()) {
    const m = (await page.evaluate((id) => window.forge.resolve(id), c.id)).marble;
    const file = `${String(i + 1).padStart(3, '0')}-${slug(m.name)}`;
    const pngs = await page.evaluate((id, sizes) => window.forge.pngSet(id, { sizes }), c.id, SIZES);
    SIZES.forEach((s, k) => save(join(PACK, `png/${s}/${file}.png`), pngs[k]));
    icons.push(pngs[SIZES.indexOf(128)]);
    save(join(PACK, `glb/${file}.glb`), await page.evaluate((id) => window.forge.glb(id), c.id));
    const entry = {
      file,
      id: c.id,
      seed: m.seed,
      name: m.name,
      tier: m.tier,
      pattern: m.pattern,
      finish: m.finish,
      scheme: m.scheme,
      phenomenon: m.effect,
      colors: { base: m.base, accent: m.accent, accent2: m.accent2, ...(m.effect !== 'none' ? { phenomenon: m.effectColor } : {}) },
      clarity: m.clarity,
      glow: m.glow,
      sparkle: m.sparkle,
    };
    if (m.effect !== 'none') {
      // A turntable while the phenomenon plays: a sprite sheet (8 across) and a GIF/MP4 preview.
      const frames = await page.evaluate((id, n) => window.forge.frames(id, { size: 256, count: n, seconds: 5 }), c.id, TURN_FRAMES);
      const dir = join(PACK, 'phenomena', file);
      mkdirSync(join(dir, 'frames'), { recursive: true });
      frames.forEach((f, k) => save(join(dir, 'frames', `${String(k).padStart(2, '0')}.png`), f));
      const sheet = await page.evaluate((fs, cols) => window.forgeTools.atlas(fs, cols, 256), frames, 8);
      save(join(dir, `${file}-turntable-256.png`), sheet);
      const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
      const inFrames = ['-framerate', '12', '-i', join(dir, 'frames', '%02d.png')];
      ff(...inFrames, '-f', 'lavfi', '-i', 'color=c=0x0b0f1c:s=256x256', '-filter_complex', '[1][0]overlay=shortest=1,format=yuv420p', '-c:v', 'libx264', '-crf', '18', join(dir, `${file}.mp4`));
      ff(...inFrames, '-filter_complex', '[0]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse', '-loop', '0', join(dir, `${file}.gif`));
      rmSync(join(dir, 'frames'), { recursive: true });
      entry.turntable = { sheet: `phenomena/${file}/${file}-turntable-256.png`, frames: TURN_FRAMES, columns: 8, size: 256, fps: 12 };
    }
    manifest.push(entry);
    if ((i + 1) % 10 === 0 || i === chosen.length - 1) log(`rendered ${i + 1}/${chosen.length}`);
  }

  // ---- Sheets: every marble as a 128px icon atlas, with its frame list ----------------------------
  const COLS = 16;
  save(join(PACK, 'sheets/icons-128.png'), await page.evaluate((fs, cols) => window.forgeTools.atlas(fs, cols, 128), icons, COLS));
  writeFileSync(
    join(PACK, 'sheets/icons-128.json'),
    JSON.stringify({ size: 128, columns: COLS, frames: Object.fromEntries(manifest.map((m, k) => [m.file, { x: (k % COLS) * 128, y: Math.floor(k / COLS) * 128, w: 128, h: 128 }])) }, null, 2),
  );
  writeFileSync(join(PACK, 'manifest.json'), JSON.stringify({ pack: VOL, count: manifest.length, sizes: SIZES, marbles: manifest }, null, 2));
  const csv = ['file,name,tier,pattern,finish,scheme,phenomenon,base,accent,accent2'];
  for (const m of manifest) csv.push([m.file, `"${m.name}"`, m.tier, m.pattern, m.finish, m.scheme, m.phenomenon, m.colors.base, m.colors.accent, m.colors.accent2].join(','));
  writeFileSync(join(PACK, 'marbles.csv'), csv.join('\n') + '\n');

  // ---- Store media (itch.io page): cover, a sheet per tier, the phenomena -------------------------
  const by = (g) => manifest.filter((m) => (g === 'Phenomena' ? m.phenomenon !== 'none' : m.tier === g && m.phenomenon === 'none'));
  const card = (m) => readFileSync(join(PACK, `png/256/${m.file}.png`)).toString('base64');
  for (const g of ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Phenomena']) {
    const list = by(g).slice(0, 24);
    if (!list.length) continue;
    save(join(STORE, `sheet-${slug(g)}.png`), await page.evaluate((g, items) => window.forgeTools.storeSheet(g, items), g, list.map((m) => ({ png: card(m), name: m.name, tier: m.tier, fx: m.phenomenon }))));
  }
  // The cover: phenomena in a fan, the Void in the middle (the fan draws the middle biggest).
  const pick = (e) => manifest.find((m) => m.phenomenon === e);
  const fan = ['starfall', 'geode', 'inferno', 'void', 'aurora', 'storm'].map(pick).filter(Boolean);
  fan.splice(Math.min(6, fan.length), 0, ...by('Mythic').slice(0, Math.max(0, 7 - fan.length)));
  const hero = fan.map((m) => readFileSync(join(PACK, `png/512/${m.file}.png`)).toString('base64'));
  save(join(STORE, 'cover-630x500.png'), await page.evaluate((h) => window.forgeTools.cover(h, 630, 500), hero));
  save(join(STORE, 'banner-1920x480.png'), await page.evaluate((h) => window.forgeTools.cover(h, 1920, 480), hero));
  // All the phenomena turning side by side.
  const fx = manifest.filter((m) => m.phenomenon !== 'none');
  const firstOfEach = ['aurora', 'inferno', 'void', 'storm', 'geode', 'starfall'].map((e) => fx.find((m) => m.phenomenon === e)).filter(Boolean);
  if (firstOfEach.length) {
    const ins = firstOfEach.flatMap((m) => ['-i', join(PACK, `phenomena/${m.file}/${m.file}.mp4`)]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...ins, '-filter_complex', `${firstOfEach.map((_, k) => `[${k}]`).join('')}hstack=${firstOfEach.length}`, '-c:v', 'libx264', '-crf', '18', join(STORE, 'phenomena.mp4')]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(STORE, 'phenomena.mp4'), '-vf', 'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse', '-loop', '0', join(STORE, 'phenomena.gif')]);
  }

  // ---- Docs, then the zips ----------------------------------------------------------------------
  const tiers = Object.fromEntries(['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'].map((t) => [t, manifest.filter((m) => m.tier === t).length]));
  const readme = readFileSync(join(PKG, 'pack/README-pack.txt'), 'utf8')
    .replace('{{COUNT}}', String(manifest.length))
    .replace('{{TIERS}}', Object.entries(tiers).map(([t, n]) => `${t} ${n}`).join(', '))
    .replace('{{FX}}', String(fx.length));
  writeFileSync(join(PACK, 'README.txt'), readme);
  cpSync(join(PKG, 'pack/LICENSE-pack.txt'), join(PACK, 'LICENSE.txt'));
  const zip = (dir, name, items) => execFileSync(TAR, ['-a', '-c', '-f', resolve(OUT, name), ...items], { cwd: dir });
  zip(OUT, `${VOL}.zip`, [VOL]);
  // The generator: the package source (no build output), with its own docs and licence.
  const src = join(OUT, 'MarbleForge-Generator');
  cpSync(PKG, src, { recursive: true, filter: (p) => !/dist-forge|node_modules|[\\/]pack[\\/]README-pack|e2e-out/.test(p) });
  cpSync(join(PKG, 'pack/LICENSE-source.txt'), join(src, 'LICENSE.txt'));
  zip(OUT, 'MarbleForge-Generator.zip', ['MarbleForge-Generator']);
  // The Forge as a web page (itch.io HTML5 upload: index.html at the zip's root).
  const web = join(PKG, 'dist-forge');
  if (existsSync(web)) zip(web, 'MarbleForge-Web.zip', ['.']);
  log('done', JSON.stringify({ marbles: manifest.length, phenomena: fx.length, errors }));
} catch (e) {
  log('FAILED', e?.stack ?? e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.httpServer.close();
  rmSync(join(OUT, 'profile'), { recursive: true, force: true });
}
