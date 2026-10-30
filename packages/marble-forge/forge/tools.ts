/**
 * Image composition for the pack builder (scripts/pack.mjs): sprite atlases and the itch.io
 * store art, drawn on canvases in the page. Everything goes in and out as base64 PNG.
 */

const TIER_COLOUR: Record<string, string> = { Common: '#b9c2d0', Rare: '#4da3ff', Epic: '#b26bff', Legendary: '#ffb020', Mythic: '#ff4fa3' };

function load(b64: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = fail;
    img.src = `data:image/png;base64,${b64}`;
  });
}

function out(c: HTMLCanvasElement): string {
  return c.toDataURL('image/png').split(',')[1];
}

function backdrop(g: CanvasRenderingContext2D, w: number, h: number, glow = '#5a3fff') {
  const bg = g.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
  bg.addColorStop(0, `${glow}55`);
  bg.addColorStop(0.5, '#121633');
  bg.addColorStop(1, '#070912');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
}

/** Frames in a grid, `cols` across, each `size` square. */
async function atlas(frames: string[], cols: number, size: number): Promise<string> {
  const c = document.createElement('canvas');
  c.width = cols * size;
  c.height = Math.ceil(frames.length / cols) * size;
  const g = c.getContext('2d')!;
  for (const [i, f] of frames.entries()) g.drawImage(await load(f), (i % cols) * size, Math.floor(i / cols) * size, size, size);
  return out(c);
}

/** A 1920x1080 sheet: a title, then up to 24 marbles with their names. */
async function storeSheet(title: string, items: { png: string; name: string; tier: string; fx: string }[]): Promise<string> {
  const W = 1920;
  const H = 1080;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  backdrop(g, W, H, TIER_COLOUR[title] ?? '#ff4fa3');
  g.fillStyle = '#f4f1ea';
  g.font = '800 64px system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillText(title === 'Phenomena' ? 'Phenomena' : `${title} marbles`, 80, 120);
  g.font = '500 28px system-ui, sans-serif';
  g.fillStyle = 'rgba(244,241,234,0.6)';
  g.fillText(title === 'Phenomena' ? 'Aurora · Inferno · Void · Storm · Geode · Starfall, animated' : 'Transparent PNG at 1024 / 512 / 256 / 128 / 64, plus GLB', 80, 168);
  const cols = 8;
  const cell = 220;
  const x0 = (W - cols * cell) / 2;
  for (const [i, it] of items.entries()) {
    const x = x0 + (i % cols) * cell;
    const y = 230 + Math.floor(i / cols) * 270;
    g.drawImage(await load(it.png), x + 20, y, 180, 180);
    g.textAlign = 'center';
    // A soft dark halo keeps the labels readable over the backdrop's glow.
    g.shadowColor = 'rgba(8,6,20,0.95)';
    g.shadowBlur = 6;
    g.font = '700 17px system-ui, sans-serif';
    g.fillStyle = '#f4f1ea';
    const name = it.name.length > 24 ? `${it.name.slice(0, 23)}…` : it.name;
    g.fillText(name, x + cell / 2, y + 205);
    g.shadowBlur = 0;
    // The tier tag sits on a dark pill: a Mythic's pink would vanish into the pink backdrop.
    g.font = '700 13px system-ui, sans-serif';
    const tag = it.fx !== 'none' ? `✦ ${it.fx.toUpperCase()} · ${it.tier.toUpperCase()}` : it.tier.toUpperCase();
    const tw = g.measureText(tag).width + 18;
    g.fillStyle = 'rgba(8,6,20,0.72)';
    g.beginPath();
    g.roundRect(x + cell / 2 - tw / 2, y + 212, tw, 20, 10);
    g.fill();
    g.fillStyle = TIER_COLOUR[it.tier] ?? '#fff';
    g.fillText(tag, x + cell / 2, y + 226);
  }
  return out(c);
}

/** Cover / banner art: a fan of marbles and the title. */
async function cover(pngs: string[], W: number, H: number): Promise<string> {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  backdrop(g, W, H, '#ff4fa3');
  const imgs = await Promise.all(pngs.map(load));
  const wide = W / H > 2;
  const n = imgs.length;
  // Big in the middle, smaller toward the edges, overlapping like a handful on a table.
  const order = imgs.map((_, i) => i).sort((a, b) => Math.abs(b - (n - 1) / 2) - Math.abs(a - (n - 1) / 2));
  for (const i of order) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    const s = (wide ? H * 0.95 : H * 0.62) * (1 - Math.abs(t) * 0.7);
    const x = W / 2 + t * (wide ? W * 0.8 : W * 0.95) - s / 2;
    const y = (wide ? H * 0.5 : H * 0.6) - s / 2 + Math.abs(t) * s * 0.25;
    g.drawImage(imgs[i], x, y, s, s);
  }
  g.textAlign = 'center';
  g.shadowColor = 'rgba(0,0,0,0.7)';
  g.shadowBlur = 24;
  g.fillStyle = '#ffffff';
  g.font = `900 ${wide ? 110 : 64}px system-ui, sans-serif`;
  const ty = wide ? H * 0.58 : 96;
  g.fillText('MARBLE FORGE', W / 2, ty);
  g.font = `700 ${wide ? 34 : 22}px system-ui, sans-serif`;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText('Collectible glass marbles · Phenomena · Rarity tiers', W / 2, ty + (wide ? 56 : 36));
  return out(c);
}

declare global {
  interface Window {
    forgeTools: { atlas: typeof atlas; storeSheet: typeof storeSheet; cover: typeof cover };
  }
}
window.forgeTools = { atlas, storeSheet, cover };
export {};
