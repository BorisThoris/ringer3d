// Roblox thumbnails, 1920x1080: background art + a big outlined headline and a subtitle at the
// top (the bottom is left clear: Roblox lays player counts over it). Plus the icon.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('D:/agent-work/ringer3d/main-review/package.json');
const sharp = require('sharp');

const A = 'D:/agent-work/ringer3d/roblox-art';
const OUT = `${A}/final2`;
mkdirSync(OUT, { recursive: true });
const W = 1920, H = 1080;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');
function overlay(title, sub, accent) {
  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="0.38" stop-color="#000" stop-opacity="0"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6c8"/><stop offset="1" stop-color="${accent}"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
  <text x="${W / 2}" y="190" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="150"
        fill="url(#gold)" stroke="#1b1028" stroke-width="22" paint-order="stroke" stroke-linejoin="round">${esc(title)}</text>
  <text x="${W / 2}" y="292" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-weight="900" font-size="64"
        fill="#ffffff" stroke="#1b1028" stroke-width="14" paint-order="stroke" stroke-linejoin="round">${esc(sub)}</text>
</svg>`);
}

async function bg(file) {
  return sharp(file).resize(W, H, { fit: 'cover', kernel: 'lanczos3' }).toBuffer();
}

// The Halloween background: the icon art on the right of a deep purple field.
async function halloweenBg() {
  const src = `${A}/out2/icon-102.png`;
  // The field is the same art, blown up and blurred, so the colours meet without a seam.
  const field = await sharp(src).resize(W, H, { fit: 'cover' }).blur(45).modulate({ brightness: 0.55 }).toBuffer();
  // The sharp art fades in from the left through an alpha mask.
  const mask = Buffer.from(`<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="e" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.35" stop-color="#fff" stop-opacity="1"/></linearGradient></defs><rect width="1080" height="1080" fill="url(#e)"/></svg>`);
  const icon = await sharp(src).resize(1080, 1080).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return sharp(field).composite([{ input: icon, left: W - 1080, top: 0 }]).png().toBuffer();
}

const THUMBS = [
  // [file, background, headline, subtitle, accent, alt text]
  ['1-halloween', 'halloween', 'HALLOWEEN LIMITED', "JACK-O'-MARBLE · ONLY 1,000 EVER", '#ff8a1e', "A glowing jack-o'-lantern glass marble crashing into a cluster of marbles: the Halloween Limited marble."],
  ['2-duels', `${A}/out2/thumb-duel.png`, 'MARBLE DUELS', 'FLICK · KNOCK OUT · KEEP THEM', '#ffb43c', 'Two glass marbles colliding head on in a chalk ring on a wooden table, other marbles scattering.'],
  ['3-limited', `${A}/out/thumb-collection.png`, 'COLLECT LIMITEDS', 'SERIAL NUMBERED MARBLES', '#5effb4', 'Rare glowing marbles on pedestals: aurora, galaxy, gold, neon and ruby.'],
  ['4-tower', `${A}/out/thumb-boss.png`, 'BEAT THE TOWER', '8 FLOORS · FACE THE BLACK TAW', '#ff5a28', 'A huge black obsidian marble with glowing cracks above a frozen lake ring: the Tower boss.'],
  ['5-pvp', `${A}/out/thumb-desk.png`, '1v1 OR VS BOTS', 'KNOCK MARBLES OUT OF THE RING', '#7fd0ff', 'Marbles exploding out of a chalk ring on a desk as a fiery shooter marble hits them.'],
];

const alt = {};
for (const [name, src, title, sub, accent, altText] of THUMBS) {
  const base = src === 'halloween' ? await halloweenBg() : await bg(src);
  await sharp(base).composite([{ input: overlay(title, sub, accent) }]).jpeg({ quality: 90 }).toFile(`${OUT}/thumb-${name}.jpg`);
  alt[`thumb-${name}.jpg`] = altText;
  console.log('thumb', name);
}
await sharp(`${A}/out2/icon-102.png`).resize(512, 512, { kernel: 'lanczos3' }).png().toFile(`${OUT}/icon-512.png`);
await import('node:fs').then((fs) => fs.writeFileSync(`${OUT}/alt.json`, JSON.stringify(alt, null, 2)));
console.log('icon + alt done');
