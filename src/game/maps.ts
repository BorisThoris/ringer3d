import { WORLD } from '../core/constants';
import { hashString, Rng } from '../core/rng';
import type { Piece } from '../core/types';
import type { ArenaId } from './arenas';

/**
 * Generated maps. A map is a field, a difficulty and a seed; from those the generator lays
 * out what you would really find there: books, pencils and coins on a desk; cracks,
 * puddles and loose stones on a street; molehills, mud and twigs on a lawn; driftwood,
 * shells and wet sand on a beach; cracks, black ice and drifts on a frozen lake; pebble
 * beds and rocks in a gravel pit. The arcade hardware (bumpers, speed pads, cups) lives
 * only on the Mini-Golf course.
 *
 * Fairness: every piece is repeated with rotational symmetry around the cross (2-fold for
 * duels, 4-fold on harder maps), so no seat on the ring gets an easier line than another.
 * Online, the host sends the generated pieces; peers never regenerate them.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export interface MapSpec {
  arena: ArenaId;
  difficulty: Difficulty;
  seed: number;
}

export interface MapDef extends MapSpec {
  name: string;
  pieces: Piece[];
}

const R = WORLD.ringRadius;
const B = WORLD.boundaryRadius;
/** Nothing solid near the starting cross (arms reach 1.5) or on the ring line: the cross
 *  must stay open to a straight shot from most of the ring. */
const CROSS_CLEAR = 2.7;
const LINE_CLEAR = 0.6;
/** Gap left between solid pieces so a marble (and a shooter) can always pass. */
const PASSAGE = 0.5;

/** Whole-map totals per difficulty; each is split across the symmetric copies. */
interface Budget {
  fold: number[];
  /** Standing objects (books, rocks, cones...). */
  objects: [number, number];
  /** How much of the field's own ground hazards (0..1). */
  hazard: number;
  /** Mini-golf hardware, only on the course. */
  bumpers: [number, number];
  cups: [number, number];
  pads: [number, number];
  /** Backstops outside the ring that can bounce marbles back in. */
  backstops: [number, number];
}

const BUDGET: Record<Difficulty, Budget> = {
  easy: { fold: [2], objects: [0, 2], hazard: 0.45, bumpers: [0, 2], cups: [2, 2], pads: [0, 0], backstops: [2, 2] },
  medium: { fold: [2, 4], objects: [2, 4], hazard: 0.75, bumpers: [4, 6], cups: [2, 4], pads: [0, 2], backstops: [2, 4] },
  hard: { fold: [4], objects: [4, 8], hazard: 1, bumpers: [4, 8], cups: [4, 4], pads: [4, 4], backstops: [4, 4] },
};

/** Each field's backstop: what lies outside its ring (skin, length range, thickness, height). */
const BACKSTOP: Record<ArenaId, [string, [number, number], number, number]> = {
  desk: ['book', [1.1, 1.5], 0.38, 0.5],
  culdesac: ['kerbstone', [1.1, 1.5], 0.3, 0.32],
  grass: ['log', [1.3, 1.8], 0.3, 0.3],
  sand: ['driftwood', [1.4, 2], 0.24, 0.24],
  ice: ['iceblock', [1, 1.4], 0.32, 0.38],
  gravel: ['slab', [1, 1.4], 0.28, 0.25],
  minigolf: ['rail', [1.2, 1.8], 0.16, 0.36],
};

/** Footprint (radius, units) a solid piece keeps clear around itself. */
function footprint(p: Piece): number {
  switch (p.kind) {
    case 'wall':
      return p.len / 2;
    case 'post':
    case 'bumper':
    case 'hole':
      return p.r;
    case 'bump':
      return p.r * 0.8;
    default:
      return 0;
  }
}

const solid = (p: Piece) => p.kind === 'wall' || p.kind === 'post' || p.kind === 'bumper' || p.kind === 'hole';
const centre = (p: Piece) => (p.kind === 'ridge' ? { x: (p.x1 + p.x2) / 2, z: (p.z1 + p.z2) / 2 } : { x: p.x, z: p.z });
const q = (v: number) => Math.round(v * 1000) / 1000;

/** Rotate a piece about the centre of the ring. */
function rotate(p: Piece, a: number): Piece {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rx = (x: number, z: number) => q(x * c - z * s);
  const rz = (x: number, z: number) => q(x * s + z * c);
  switch (p.kind) {
    case 'ridge':
      return { ...p, x1: rx(p.x1, p.z1), z1: rz(p.x1, p.z1), x2: rx(p.x2, p.z2), z2: rz(p.x2, p.z2) };
    case 'wall':
    case 'zone':
      return { ...p, x: rx(p.x, p.z), z: rz(p.x, p.z), a: q(p.a + a) };
    default:
      return { ...p, x: rx(p.x, p.z), z: rz(p.x, p.z) };
  }
}

class Builder {
  pieces: Piece[] = [];
  constructor(
    readonly rng: Rng,
    readonly fold: number,
  ) {}

  /** Polar point (radius, angle) on the field. */
  at(r: number, a: number) {
    return { x: q(Math.cos(a) * r), z: q(Math.sin(a) * r) };
  }
  /** Somewhere inside the ring, clear of the cross and the line. */
  inRing() {
    return this.at(this.rng.range(CROSS_CLEAR + 0.35, R - 0.95), this.rng.range(0, Math.PI * 2));
  }
  /** Anywhere on the field outside the cross. */
  anywhere(rMin = 2.2, rMax = B - 1.4) {
    return this.at(this.rng.range(rMin, rMax), this.rng.range(0, Math.PI * 2));
  }
  /** How many to place per symmetric copy for a whole-map total. */
  per(total: number) {
    return Math.floor(total / this.fold + this.rng.next());
  }

  fits(p: Piece): boolean {
    const { x, z } = centre(p);
    const d = Math.hypot(x, z);
    const f = footprint(p);
    if (d + f > B - 0.9) return false;
    if (solid(p)) {
      if (d - f < CROSS_CLEAR) return false;
      if (Math.abs(d - R) < f + LINE_CLEAR) return false;
      for (const o of this.pieces) {
        if (!solid(o)) continue;
        const c = centre(o);
        if (Math.hypot(c.x - x, c.z - z) < f + footprint(o) + PASSAGE) return false;
      }
    } else if (p.kind === 'zone') {
      // Patches may reach toward the cross but never sit on it, nor under a standing piece.
      if (d - p.r < 1.9) return false;
      for (const o of this.pieces) {
        if (!solid(o) && !(o.kind === 'zone' && o.effect === 'boost')) continue;
        const c = centre(o);
        const r = o.kind === 'zone' ? o.r : footprint(o);
        if (Math.hypot(c.x - x, c.z - z) < p.r + r + 0.1) return false;
      }
    } else if (p.kind === 'bump') {
      if (d - f < CROSS_CLEAR - 0.4) return false;
      // Never under the line a shooter knuckles down on.
      if (Math.abs(d - R) < f + 0.3) return false;
      for (const o of this.pieces) {
        if (!solid(o)) continue;
        const c = centre(o);
        if (Math.hypot(c.x - x, c.z - z) < f + footprint(o) + 0.1) return false;
      }
    } else if (p.kind === 'ridge') {
      // A line lying across the knuckle-down spot would be unfair to whoever sits there.
      for (const [px, pz] of [[p.x1, p.z1], [p.x2, p.z2], [x, z]]) {
        const dd = Math.hypot(px, pz);
        if (Math.abs(dd - R) < 0.35 || dd < CROSS_CLEAR - 0.6) return false;
      }
    }
    return true;
  }

  /** Place `make()` and its rotational copies; retry a few times if it does not fit. */
  place(make: () => Piece, tries = 14): boolean {
    for (let t = 0; t < tries; t++) {
      const p = make();
      const copies = Array.from({ length: this.fold }, (_, k) => rotate(p, (k / this.fold) * Math.PI * 2));
      const staged: Piece[] = [];
      let ok = true;
      for (const c of copies) {
        const before = this.pieces.length;
        this.pieces.push(...staged);
        const fit = this.fits(c);
        this.pieces.length = before;
        if (!fit) {
          ok = false;
          break;
        }
        staged.push(c);
      }
      if (ok) {
        this.pieces.push(...staged);
        return true;
      }
    }
    return false;
  }

  // ---- Piece makers ------------------------------------------------------------------
  /** A lump: a sunk sphere whose cap stands proud (a coin is a huge sphere sunk almost flat). */
  lump(skin: string, r: number, sink: number, at = this.anywhere()): boolean {
    return this.place(() => ({ kind: 'bump', ...at, r: q(r), sink, skin }), 4);
  }
  patchOf(skin: string, effect: 'sticky' | 'slick', k: number, r: [number, number], at?: () => { x: number; z: number }) {
    return this.place(() => ({ kind: 'zone', ...(at ? at() : this.anywhere(2.4, R + 1.5)), r: q(this.rng.range(r[0], r[1])), effect, a: 0, k, skin }));
  }
  /** A straight thing lying on the ground (pencil, twig, ruler edge). */
  lying(skin: string, len: number, r: number, at = this.anywhere(2.6, R - 0.6)) {
    return this.place(() => {
      const a = this.rng.range(0, Math.PI);
      const hx = (Math.cos(a) * len) / 2;
      const hz = (Math.sin(a) * len) / 2;
      return { kind: 'ridge', x1: q(at.x - hx), z1: q(at.z - hz), x2: q(at.x + hx), z2: q(at.z + hz), r, skin };
    });
  }
  /** A wandering crack: a few short ridge segments, each turning a little. */
  crack(skin: string, segs: number, step: number, width: number) {
    let { x, z } = this.anywhere(2.4, B - 2);
    let dir = this.rng.range(0, Math.PI * 2);
    for (let i = 0; i < segs; i++) {
      dir += this.rng.range(-0.55, 0.55);
      const nx = q(x + Math.cos(dir) * step);
      const nz = q(z + Math.sin(dir) * step);
      if (Math.hypot(nx, nz) > B - 1.2) break;
      this.place(() => ({ kind: 'ridge', x1: x, z1: z, x2: nx, z2: nz, r: width, skin }), 1);
      x = nx;
      z = nz;
    }
  }
  /** Standing objects inside the ring. */
  post(skin: string, r: [number, number], h: number) {
    return this.place(() => ({ kind: 'post', ...this.inRing(), r: q(this.rng.range(r[0], r[1])), h, skin }));
  }
  /**
   * A backstop just outside the ring, lying across the way out: a marble knocked out hard
   * enough to reach it can bounce back in (no point), and a shooter that sails out can come
   * back to stay in and shoot again.
   */
  backstop(skin: string, len: [number, number], thick: number, h: number) {
    return this.place(() => {
      const p = this.at(this.rng.range(R + 1.4, R + 3), this.rng.range(0, Math.PI * 2));
      return { kind: 'wall', ...p, len: q(this.rng.range(len[0], len[1])), thick, h, a: q(Math.atan2(p.z, p.x) + Math.PI / 2), skin };
    });
  }
  block(skin: string, len: [number, number], thick: number, h: number) {
    return this.place(() => {
      const p = this.inRing();
      const a = Math.atan2(p.z, p.x);
      // Mostly across the lines into the cross, sometimes pointing at it.
      const along = this.rng.next() < 0.7;
      return { kind: 'wall', ...p, len: q(this.rng.range(len[0], len[1])), thick, h, a: q(along ? a + Math.PI / 2 : a), skin };
    });
  }
}

/** Build the map for a spec. Same spec, same map, on every device. */
export function generateMap(spec: MapSpec): MapDef {
  const rng = new Rng(hashString(`${spec.arena}:${spec.difficulty}:${spec.seed}`));
  const budget = BUDGET[spec.difficulty];
  const fold = budget.fold[rng.int(budget.fold.length)];
  const b = new Builder(rng, fold);
  const count = ([lo, hi]: [number, number]) => lo + rng.int(hi - lo + 1);
  // Ground hazards first (their counts are whole-map totals, split across the copies),
  // then the standing objects, which find room around them.
  FIELD[spec.arena].ground(b, budget.hazard);
  for (let i = b.per(count(budget.objects)); i > 0; i--) FIELD[spec.arena].object(b);
  if (spec.arena === 'minigolf') course(b, budget, count);
  const [skin, len, thick, h] = BACKSTOP[spec.arena];
  for (let i = b.per(count(budget.backstops)); i > 0; i--) b.backstop(skin, len, thick, h);
  return { ...spec, name: mapName(spec, rng), pieces: b.pieces };
}

/** The Mini-Golf course's hardware: cups, bumpers (in and beyond the ring), speed pads. */
function course(b: Builder, budget: Budget, count: (r: [number, number]) => number) {
  for (let i = b.per(count(budget.cups)); i > 0; i--) b.place(() => ({ kind: 'hole', ...b.inRing(), r: 0.3, skin: 'cup' }));
  for (let i = b.per(count(budget.bumpers)); i > 0; i--) {
    const outside = b.rng.next() < 0.5;
    b.place(() => ({ kind: 'bumper', ...(outside ? b.anywhere(R + 1.2, B - 2.2) : b.inRing()), r: q(b.rng.range(0.24, 0.34)), skin: 'bumper' }));
  }
  // Speed pads point round the ring, so they bend shots rather than aim them.
  for (let i = b.per(count(budget.pads)); i > 0; i--) {
    const p = b.inRing();
    const a = Math.atan2(p.z, p.x);
    b.place(() => ({ kind: 'zone', ...p, r: 0.45, effect: 'boost', a: q(a + Math.PI / 2), skin: 'pad' }));
  }
}

interface FieldPlan {
  /** What lies on (or in) the ground, scaled by the hazard level. */
  ground(b: Builder, h: number): void;
  /** One standing object (and its symmetric copies). */
  object(b: Builder): void;
}

const n = (b: Builder, total: number) => b.per(Math.round(total));
const pick = <T,>(b: Builder, xs: T[]) => xs[b.rng.int(xs.length)];

const FIELD: Record<ArenaId, FieldPlan> = {
  // A desk: loose sheets of paper (slicker than varnish), dropped coins and paperclips to
  // ride over, pencils lying across lines, the odd coffee ring.
  desk: {
    ground(b, h) {
      for (let i = n(b, 2 + h * 2); i > 0; i--) b.patchOf('paper', 'slick', 0.6, [0.8, 1.15]);
      for (let i = n(b, 2 + h * 4); i > 0; i--) b.lump(pick(b, ['coin', 'coin', 'coin-silver']), 0.6, 0.96);
      for (let i = n(b, h * 4); i > 0; i--) b.lying('paperclip', 0.42, 0.028);
      for (let i = n(b, 1 + h * 3); i > 0; i--) b.lying('pencil', 1.8, 0.07);
      if (h >= 0.75) for (let i = n(b, 2); i > 0; i--) b.patchOf('coffee', 'sticky', 1.7, [0.45, 0.65]);
    },
    object(b) {
      const r = b.rng.next();
      if (r < 0.4) b.block('book', [0.9, 1.3], 0.38, 0.5);
      else if (r < 0.6) b.block('eraser', [0.45, 0.55], 0.25, 0.18);
      else if (r < 0.75) b.block('ruler', [2.2, 2.6], 0.12, 0.05);
      else if (r < 0.9) b.post('mug', [0.34, 0.38], 0.85);
      else b.post('pot', [0.24, 0.28], 0.6);
    },
  },
  // A street: cracks in the slab, puddles, loose stones and bottle caps.
  culdesac: {
    ground(b, h) {
      for (let i = n(b, 1 + h * 3); i > 0; i--) b.crack('crack', 2 + b.rng.int(3), 1.1, 0.045);
      for (let i = n(b, h * 4); i > 0; i--) b.patchOf('puddle', 'slick', 0.35, [0.6, 1.05]);
      for (let i = n(b, 2 + h * 5); i > 0; i--) b.lump('stone', b.rng.range(0.1, 0.16), 0.55);
      for (let i = n(b, h * 3); i > 0; i--) b.lump('cap', 0.35, 0.93);
    },
    object(b) {
      const r = b.rng.next();
      if (r < 0.45) b.block('brick', [0.5, 0.55], 0.26, 0.2);
      else if (r < 0.75) b.block('kerbstone', [0.9, 1.2], 0.3, 0.32);
      else b.post('cone', [0.22, 0.26], 0.8);
    },
  },
  // A back lawn: molehills, mud, fallen twigs and garden stones.
  grass: {
    ground(b, h) {
      for (let i = n(b, 1 + h * 3); i > 0; i--) b.lump('molehill', b.rng.range(0.32, 0.45), 0.78, b.anywhere(2.6, B - 2));
      for (let i = n(b, 1 + h * 2.5); i > 0; i--) b.patchOf('mud', 'sticky', 2.2, [0.55, 0.9]);
      for (let i = n(b, 1 + h * 4); i > 0; i--) b.lying('twig', b.rng.range(0.6, 1.2), 0.045);
    },
    object(b) {
      const r = b.rng.next();
      if (r < 0.5) b.post('rock', [0.26, 0.42], 0.4);
      else if (r < 0.75) b.block('log', [1, 1.5], 0.3, 0.3);
      else b.post('flowerpot', [0.28, 0.32], 0.5);
    },
  },
  // A beach: wet sand that grips, shells, pebbles; driftwood, rocks and sandcastles stand.
  sand: {
    ground(b, h) {
      for (let i = n(b, 1 + h * 2.5); i > 0; i--) b.patchOf('wetsand', 'sticky', 1.8, [0.7, 1.1]);
      for (let i = n(b, 2 + h * 6); i > 0; i--) b.lump('shell', b.rng.range(0.1, 0.15), 0.55);
      for (let i = n(b, h * 4); i > 0; i--) b.lump('pebble', b.rng.range(0.08, 0.12), 0.6);
    },
    object(b) {
      const r = b.rng.next();
      if (r < 0.4) b.block('driftwood', [1.1, 1.7], 0.24, 0.24);
      else if (r < 0.75) b.post('rock', [0.28, 0.45], 0.42);
      else b.post('sandcastle', [0.4, 0.46], 0.55);
    },
  },
  // A frozen lake: cracks that kick marbles sideways, black ice, snow drifts, stones frozen in.
  ice: {
    ground(b, h) {
      for (let i = n(b, 1 + h * 3); i > 0; i--) b.crack('icecrack', 3 + b.rng.int(3), 0.8, 0.035);
      for (let i = n(b, h * 3); i > 0; i--) b.patchOf('blackice', 'slick', 0.25, [0.7, 1.2]);
      for (let i = n(b, 1 + h * 2); i > 0; i--) b.patchOf('snow', 'sticky', 2.6, [0.7, 1.2], () => b.anywhere(R + 0.8, B - 2));
      for (let i = n(b, h * 4); i > 0; i--) b.lump('pebble', b.rng.range(0.07, 0.11), 0.62);
    },
    object(b) {
      if (b.rng.next() < 0.6) b.block('iceblock', [0.7, 1.2], 0.32, 0.38);
      else b.post('rock', [0.24, 0.36], 0.36);
    },
  },
  // A gravel pit: beds of pebbles that knock marbles off line, stray stones everywhere.
  gravel: {
    ground(b, h) {
      for (let i = Math.max(1, n(b, h * 2.4)); i > 0; i--) {
        const c = b.at(b.rng.range(3, 4.4), b.rng.range(0, Math.PI * 2));
        for (let j = Math.round(6 + h * 4); j > 0; j--) {
          const a = b.rng.range(0, Math.PI * 2);
          const d = Math.sqrt(b.rng.next()) * 0.7;
          b.lump('pebble', b.rng.range(0.07, 0.11), 0.64, { x: q(c.x + Math.cos(a) * d), z: q(c.z + Math.sin(a) * d) });
        }
      }
      for (let i = n(b, 12 + h * 16); i > 0; i--) b.lump('pebble', b.rng.range(0.05, 0.08), 0.62);
    },
    object(b) {
      if (b.rng.next() < 0.6) b.post('rock', [0.28, 0.45], 0.45);
      else b.block('slab', [0.7, 1.1], 0.28, 0.25);
    },
  },
  // The course: flat turf; walls are painted rails and bricks, posts are rail posts.
  minigolf: {
    ground() {},
    object(b) {
      if (b.rng.next() < 0.6) b.block('rail', [0.9, 1.5], 0.16, 0.36);
      else b.post('railpost', [0.14, 0.18], 0.5);
    },
  },
};

const NAMES: Record<ArenaId, [string[], string[]]> = {
  desk: [['Homework', 'Lamp-lit', 'Messy', 'Midnight', 'Inkwell'], ['Desk', 'Blotter', 'Study', 'Drawer', 'Ledger']],
  culdesac: [['Kerbside', 'Cracked', 'Drain', 'Sunday', 'Dead-end'], ['Slab', 'Close', 'Street', 'Corner', 'Drive']],
  grass: [['Molehill', 'Muddy', 'Back', 'Mown', 'Daisy'], ['Lawn', 'Patch', 'Green', 'Garden', 'Yard']],
  sand: [['Driftwood', 'Low-tide', 'Shell', 'Sunbaked', 'Dune'], ['Beach', 'Cove', 'Shore', 'Bay', 'Spit']],
  ice: [['Black', 'Cracked', 'Thin', 'Glass', 'Snowbound'], ['Ice', 'Lake', 'Pond', 'Floe', 'Rink']],
  gravel: [['Pebble', 'Loose', 'Quarry', 'Crunch', 'Shingle'], ['Path', 'Yard', 'Drive', 'Pit', 'Run']],
  minigolf: [['Windmill', 'Pirate', 'Neon', 'Boardwalk', 'Lucky'], ['Links', 'Hole', 'Course', 'Green', 'Putt']],
};

function mapName(spec: MapSpec, rng: Rng): string {
  const [a, nn] = NAMES[spec.arena];
  return `${a[rng.int(a.length)]} ${nn[rng.int(nn.length)]}`;
}

/** A fresh seed for "shuffle". */
export function randomSeed(): number {
  return (Math.random() * 2 ** 31) | 0;
}
