// Size the generated art for Roblox: icon 512, thumbnails 1920x1080 JPEG, passes/products/badges 512.
import { mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('D:/agent-work/ringer3d/main-review/package.json');
const sharp = require('sharp');

const src = 'D:/agent-work/ringer3d/roblox-art/out';
const dst = 'D:/agent-work/ringer3d/roblox-art/icons';
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src).filter((n) => n.endsWith('.png'))) {
  const name = f.replace(/\.png$/, '');
  const img = sharp(`${src}/${f}`);
  if (name.startsWith('thumb-')) await img.resize(1920, 1080, { kernel: 'lanczos3' }).jpeg({ quality: 90 }).toFile(`${dst}/${name}.jpg`);
  else if (name === 'icon') await img.resize(512, 512).png().toFile(`${dst}/icon-512.png`);
  else await img.resize(512, 512).png().toFile(`${dst}/${name}.png`);
  console.log('sized', name);
}
