const sharp = require('sharp');
const fs = require('fs');
(async () => {
  const dir = process.argv[2], out = process.argv[3], from = +process.argv[4] || 0, n = +process.argv[5] || 24;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort().slice(from, from + n);
  const W = 400, H = 361, cols = 6, rows = Math.ceil(files.length / cols);
  const comps = [];
  for (let i = 0; i < files.length; i++) {
    const img = await sharp(`${dir}/${files[i]}`).resize(W, H).toBuffer();
    const label = Buffer.from(`<svg width="${W}" height="22"><rect width="${W}" height="22" fill="black"/><text x="4" y="16" font-size="15" fill="white" font-family="Arial">${files[i]}</text></svg>`);
    comps.push({ input: img, left: (i % cols) * W, top: Math.floor(i / cols) * (H + 22) + 22 }, { input: label, left: (i % cols) * W, top: Math.floor(i / cols) * (H + 22) });
  }
  await sharp({ create: { width: cols * W, height: rows * (H + 22), channels: 3, background: '#222' } }).composite(comps).jpeg({ quality: 80 }).toFile(out);
})();
