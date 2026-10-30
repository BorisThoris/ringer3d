import {
  collectibleFromId,
  collectibleId,
  EFFECT_IDS,
  EFFECTS,
  generateMarble,
  marbleLook,
  mintCollectible,
  phenomenonOdds,
  RARITY,
  type Collectible,
  type Effect,
  type GeneratedMarble,
  type MarbleLook,
  type Tier,
} from '../src';
import { exportGlb, MarblePreview, snapshot } from '../src/three';
import './tools';

/**
 * The Forge: roll marbles, look at them up close, download them. Also the engine of the asset
 * pack (scripts/pack.mjs drives `window.forge` in a headless browser).
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const TIER_COLOUR: Record<Tier, string> = { Common: '#b9c2d0', Rare: '#4da3ff', Epic: '#b26bff', Legendary: '#ffb020', Mythic: '#ff4fa3' };

export interface Rolled {
  /** The id that alone rebuilds the marble: "cL-F1a2b…" (a collectible) or "4242:Mythic" (a raw seed). */
  uid: string;
  marble: GeneratedMarble;
  collectible: Collectible | null;
  look: MarbleLook;
}

/**
 * A marble from an id. "cR-…" is a collectible (tier in the id, wear and Shiny from the rest);
 * "1234" or "1234:Epic" is a raw generator seed; anything else is a fresh instance id, minted
 * as a collectible (or, with wear off, hashed to a raw seed).
 */
export function resolve(id: string, opts: { tier?: Tier; wear?: boolean } = {}): Rolled {
  const raw = /^(\d+)(?::(Common|Rare|Epic|Legendary|Mythic))?$/.exec(id);
  const known = raw ? null : collectibleFromId(id);
  if (known) return fromCollectible(known);
  if (raw || opts.wear === false) {
    const seed = raw ? Number(raw[1]) : hash32(id);
    const tier = (raw?.[2] as Tier | undefined) ?? opts.tier;
    const marble = generateMarble(seed, tier);
    return { uid: tier ? `${seed}:${tier}` : String(seed), marble, collectible: null, look: marbleLook(marble) };
  }
  const c = mintCollectible(id, opts.tier);
  return fromCollectible(collectibleFromId(collectibleId(c.tier, id)) ?? c);
}

function fromCollectible(c: Collectible): Rolled {
  return { uid: c.id, marble: c.marble, collectible: c, look: { ...marbleLook(c.marble), wear: c.float, shiny: c.shiny } };
}

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const randomUid = () => `F${Array.from(crypto.getRandomValues(new Uint32Array(2)), (v) => v.toString(16).padStart(8, '0')).join('')}`;

/** Roll until the marble has the phenomenon asked for (or give up and take the last roll). */
export function roll(opts: { tier?: Tier; effect?: Effect | ''; wear?: boolean } = {}): Rolled {
  let r = resolve(randomUid(), opts);
  for (let i = 0; i < 200000 && opts.effect && r.marble.effect !== opts.effect; i++) r = resolve(randomUid(), opts);
  return r;
}

// ---- The page --------------------------------------------------------------------------------
const canvas = $<HTMLCanvasElement>('view');
let current: Rolled | null = null;
let preview: MarblePreview | null = null;

function show(r: Rolled) {
  current = r;
  const m = r.marble;
  if (!preview) preview = new MarblePreview(canvas, r.look, m.ui, 'high');
  else preview.setLook(r.look);
  document.documentElement.style.setProperty('--accent', m.ui);
  document.documentElement.style.setProperty('--tier', TIER_COLOUR[m.tier]);
  $('tier').textContent = m.tier;
  $('name').textContent = m.name;
  $<HTMLInputElement>('uid').value = r.uid;
  const chips: string[] = [];
  if (m.effect !== 'none') chips.push(`<span class="chip fx">✦ ${EFFECTS[m.effect].title}</span>`);
  if (r.collectible?.shiny) chips.push('<span class="chip shiny">Shiny</span>');
  for (const t of r.collectible?.traits ?? []) if (t !== 'Shiny' && (m.effect === 'none' || t !== EFFECTS[m.effect].title)) chips.push(`<span class="chip">${t}</span>`);
  chips.push(`<span class="chip">${m.pattern}</span>`, `<span class="chip">${m.finish}</span>`, `<span class="chip">${m.scheme}</span>`);
  $('chips').innerHTML = chips.join('');
  $('swatches').innerHTML = [m.base, m.accent, m.accent2, ...(m.effect !== 'none' ? [m.effectColor] : [])].map((c) => `<span style="background:${c}" title="${c}"></span>`).join('');
  const facts: [string, string][] = [];
  if (r.collectible) facts.push(['Wear', r.collectible.wear], ['Float', r.collectible.float.toFixed(6)], ['Pattern', `#${r.collectible.pattern}`]);
  facts.push(['Clarity', m.clarity.toFixed(2)], ['Glow', m.glow.toFixed(2)], ['Sparkle', m.sparkle.toFixed(2)]);
  if (m.effect !== 'none') facts.push(['Phenomenon', EFFECTS[m.effect].desc]);
  $('facts').innerHTML = facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

const wants = () => ({
  tier: ($<HTMLSelectElement>('want-tier').value || undefined) as Tier | undefined,
  effect: $<HTMLSelectElement>('want-fx').value as Effect | '',
  wear: $<HTMLInputElement>('wear').checked,
});

function addThumb(r: Rolled) {
  const b = document.createElement('button');
  b.className = 'thumb';
  b.title = `${r.marble.name} (${r.marble.tier})`;
  b.style.setProperty('--tier', TIER_COLOUR[r.marble.tier]);
  const img = new Image();
  img.src = snapshot(r.look, { size: 160, quality: 'medium' }).toDataURL();
  img.alt = r.marble.name;
  b.append(img);
  if (r.marble.effect !== 'none') b.insertAdjacentHTML('beforeend', '<i>✦</i>');
  b.onclick = () => show(r);
  const strip = $('strip');
  strip.prepend(b);
  while (strip.children.length > 24) strip.lastElementChild!.remove();
}

function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileName = (r: Rolled) => `${r.marble.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${r.uid}`;

function wire() {
  const fx = $<HTMLSelectElement>('want-fx');
  for (const e of EFFECT_IDS) fx.insertAdjacentHTML('beforeend', `<option value="${e}">${EFFECTS[e].title}</option>`);
  $('odds').textContent =
    'Bag odds: ' + RARITY.map((r) => `${r.tier} ${r.odds}%`).join(' · ') + ` · a phenomenon ${phenomenonOdds().toFixed(2)}% · Shiny 1 in 50 (collectibles)`;
  $('roll').onclick = () => {
    const r = roll(wants());
    show(r);
    addThumb(r);
  };
  $('roll12').onclick = () => {
    for (let i = 0; i < 12; i++) addThumb(roll(wants()));
  };
  $<HTMLInputElement>('uid').onchange = (e) => show(resolve((e.target as HTMLInputElement).value.trim(), wants()));
  $('png').onclick = () => current && snapshot(current.look, { size: 1024 }).toBlob((b) => b && download(`${fileName(current!)}.png`, b));
  $('glb').onclick = async () => current && download(`${fileName(current)}.glb`, new Blob([await exportGlb(current.look)], { type: 'model/gltf-binary' }));
  $('json').onclick = () => current && download(`${fileName(current)}.json`, new Blob([JSON.stringify(current.collectible ?? current.marble, null, 2)], { type: 'application/json' }));
}

// ---- Automation (the asset pack builder) ------------------------------------------------------
/** A smooth downscale in halving steps (one big drawImage step aliases). */
function scaled(src: HTMLCanvasElement, size: number): HTMLCanvasElement {
  let cur = src;
  while (cur.width / 2 >= size) {
    const n = document.createElement('canvas');
    n.width = n.height = cur.width / 2;
    n.getContext('2d')!.drawImage(cur, 0, 0, n.width, n.height);
    cur = n;
  }
  if (cur.width === size) return cur;
  const n = document.createElement('canvas');
  n.width = n.height = size;
  const g = n.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, size, size);
  return n;
}

async function toBase64(buf: ArrayBuffer | Blob): Promise<string> {
  const blob = buf instanceof Blob ? buf : new Blob([buf]);
  return new Promise((ok) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(',')[1]);
    fr.readAsDataURL(blob);
  });
}

declare global {
  interface Window {
    forge: typeof api;
  }
}
const api = {
  /** Roll a marble (optionally of a tier and phenomenon); returns its id. */
  roll: (o: { tier?: Tier; effect?: Effect | ''; wear?: boolean } = {}) => roll(o).uid,
  resolve: (uid: string, opts?: { tier?: Tier; wear?: boolean }) => {
    const r = resolve(uid, opts);
    return { uid: r.uid, marble: r.marble, collectible: r.collectible };
  },
  /** PNG of a marble, base64. */
  png: async (uid: string, o: { tier?: Tier; wear?: boolean; size?: number; time?: number; turn?: number; background?: string } = {}) => {
    const r = resolve(uid, o);
    const c = snapshot(r.look, { size: o.size ?? 512, time: o.time, turn: o.turn, background: o.background ?? 'transparent' });
    return toBase64(await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/png')));
  },
  /** One render, downscaled to every size asked for (largest first): base64 PNGs, same order. */
  pngSet: async (uid: string, o: { wear?: boolean; sizes: number[]; time?: number; turn?: number }) => {
    const r = resolve(uid, o);
    const big = snapshot(r.look, { size: o.sizes[0], time: o.time, turn: o.turn });
    const out: string[] = [];
    for (const s of o.sizes) {
      const c = s === o.sizes[0] ? big : scaled(big, s);
      out.push(await toBase64(await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/png'))));
    }
    return out;
  },
  /** A turntable: `count` transparent frames, one full turn while the phenomenon plays. */
  frames: async (uid: string, o: { wear?: boolean; size: number; count: number; seconds?: number }) => {
    const r = resolve(uid, o);
    const out: string[] = [];
    for (let i = 0; i < o.count; i++) {
      const c = snapshot(r.look, { size: o.size, turn: (i / o.count) * Math.PI * 2, time: 1 + (i / o.count) * (o.seconds ?? 4) });
      out.push(await toBase64(await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/png'))));
    }
    return out;
  },
  glb: async (uid: string, o: { tier?: Tier; wear?: boolean } = {}) => toBase64(await exportGlb(resolve(uid, o).look)),
  show: (uid: string, o: { tier?: Tier; wear?: boolean } = {}) => show(resolve(uid, o)),
};
window.forge = api;

wire();
const first = new URLSearchParams(location.search).get('id');
const start = first ? resolve(first) : roll({ tier: 'Legendary', effect: 'aurora' });
show(start);
addThumb(start);
