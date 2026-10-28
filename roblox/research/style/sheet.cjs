const sharp = require('sharp');
const fs = require('fs');
(async () => {
  const [pat, out, W, H, cols] = [new RegExp(process.argv[2]), process.argv[3], +process.argv[4], +process.argv[5], +process.argv[6]];
  const files = fs.readdirSync('img').filter((f) => pat.test(f)).sort();
  const comps = [];
  for (let i = 0; i < files.length; i++) {
    comps.push({ input: await sharp(`img/${files[i]}`).resize(W, H).toBuffer(), left: (i % cols) * W, top: Math.floor(i / cols) * (H + 20) + 20 });
    comps.push({ input: Buffer.from(`<svg width="${W}" height="20"><rect width="${W}" height="20"/><text x="4" y="15" font-size="14" fill="white" font-family="Arial">${files[i]}</text></svg>`), left: (i % cols) * W, top: Math.floor(i / cols) * (H + 20) });
  }
  await sharp({ create: { width: cols * W, height: Math.ceil(files.length / cols) * (H + 20), channels: 3, background: '#222' } }).composite(comps).jpeg({ quality: 82 }).toFile(out);
})();
