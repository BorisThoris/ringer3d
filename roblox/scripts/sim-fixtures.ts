// Writes roblox/tests/sim.luau: shots played on the web game's own physics (src/core/physics.ts,
// Rapier), and the Luau that plays the same shots on Ringer.Sim and measures how far apart the
// two land. Rapier and a Luau solver can't agree bit for bit; what must agree is how the game
// plays: how far a roll goes, where a hit sends a marble, what a break captures, what breaks.
//   npx esbuild roblox/scripts/sim-fixtures.ts --bundle --platform=node --outfile=roblox/build/sim-fixtures.cjs && node roblox/build/sim-fixtures.cjs
//   node roblox/scripts/run-luau.mjs roblox/tests/sim.luau <version>
import { readFileSync, writeFileSync } from 'node:fs';
import { initPhysics, isOutsideRing, ShotSim, startingLayout, type Layout } from '../../src/core/physics';
import { WORLD } from '../../src/core/constants';
import type { Piece, Shot } from '../../src/core/types';
import { ARENAS, type ArenaId } from '../../src/game/arenas';
import { generateMap } from '../../src/game/maps';

const FIELDS: ArenaId[] = ['desk', 'culdesac', 'grass', 'sand', 'ice', 'gravel', 'minigolf'];

const lua = (v: unknown): string => {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toPrecision(17);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `{ ${v.map(lua).join(', ')} }`;
  return `{ ${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => `${k} = ${lua(x)}`).join(', ')} }`;
};

interface Case {
  group: string;
  arena: ArenaId;
  layout: Layout;
  shot: Shot;
  first: boolean;
  pieces: Piece[];
  want?: { layout: Layout; steps: number; captured: number; shooterOut: boolean; broken: number };
}

const cases: Case[] = [];
const add = (group: string, arena: ArenaId, layout: Layout, shot: Shot, first = true, pieces: Piece[] = []) =>
  cases.push({ group, arena, layout, shot, first, pieces });

const PLACE = Math.PI / 2; // knuckle down at (0, 5.73): aim -pi/2 runs through the centre
const AIM = -Math.PI / 2;

// A) A lone taw rolling free: rolling resistance, slide-to-roll, damping, slopes.
for (const arena of FIELDS)
  for (const power of [0.25, 0.5, 0.75, 1])
    for (const spin of [-1, 0, 1]) add('roll', arena, { targets: [], shooter: null }, { placeAngle: PLACE, aimAngle: AIM + 0.3, power, spin });

// B) One mib, hit full and thin: what a hit gives and keeps.
const one: Layout = { targets: [{ id: 0, x: 0, y: WORLD.targetRadius, z: 0 }], shooter: null };
for (const arena of ['desk', 'grass', 'ice'] as ArenaId[])
  for (const off of [0, 0.02, 0.045])
    for (const power of [0.4, 0.7, 1])
      for (const spin of [-1, 0, 1]) add('hit', arena, one, { placeAngle: PLACE, aimAngle: AIM + off, power, spin });

// C) The opening break on an open field.
for (const arena of FIELDS)
  for (const [off, power] of [[0, 0.6], [0.01, 1], [0.03, 0.8], [-0.02, 0.5]])
    add('break', arena, startingLayout(), { placeAngle: PLACE, aimAngle: AIM + off, power, spin: 0 });

// D) Shots on generated maps (props, pieces, zones, cups).
for (const arena of FIELDS)
  for (const [difficulty, seed] of [['medium', 1], ['hard', 42]] as const) {
    const map = generateMap({ arena, difficulty, seed });
    for (const [place, off, power] of [[PLACE, 0, 0.7], [0, 0.04, 1], [Math.PI, -0.03, 0.9], [-Math.PI / 2, 0.2, 1]])
      add(`map`, arena, startingLayout(), { placeAngle: place, aimAngle: place + Math.PI + off, power, spin: 0 }, true, map.pieces);
  }

// E) One piece in the taw's way, straight down the middle at (0, 2).
const at = (p: Piece) => [p];
const lone = { targets: [], shooter: null } as Layout;
const pieceCases: [string, Piece][] = [
  ['wall', { kind: 'wall', x: 0, z: 2, len: 1.2, thick: 0.3, h: 0.3, a: 0, skin: 'kerbstone' }],
  ['wall-angled', { kind: 'wall', x: 0, z: 2, len: 1.2, thick: 0.3, h: 0.3, a: 0.6, skin: 'kerbstone' }],
  ['post', { kind: 'post', x: 0.05, z: 2, r: 0.18, h: 0.5, skin: 'stone' }],
  ['bumper', { kind: 'bumper', x: 0.05, z: 2, r: 0.3, skin: 'bumper' }],
  ['bump', { kind: 'bump', x: 0.1, z: 2, r: 0.6, sink: 0.9, skin: 'coin' }],
  ['ridge', { kind: 'ridge', x1: -1, z1: 2, x2: 1, z2: 2.3, r: 0.05, skin: 'crack' }],
  ['sticky', { kind: 'zone', x: 0, z: 2, r: 1, effect: 'sticky', a: 0, skin: 'mud' }],
  ['slick', { kind: 'zone', x: 0, z: 2, r: 1, effect: 'slick', a: 0, skin: 'puddle' }],
  ['boost', { kind: 'zone', x: 0, z: 2, r: 0.8, effect: 'boost', a: 0.4, skin: 'pad' }],
  ['cup', { kind: 'hole', x: 0, z: 2, r: 0.35, skin: 'cup' }],
  ['book', { kind: 'wall', x: 0, z: 2, len: 0.9, thick: 0.6, h: 0.18, a: 0.2, skin: 'book' }],
  ['brick', { kind: 'wall', x: 0, z: 2, len: 0.5, thick: 0.25, h: 0.2, a: 0, skin: 'brick' }],
  ['cone', { kind: 'post', x: 0.05, z: 2, r: 0.15, h: 0.4, skin: 'cone' }],
  ['mug', { kind: 'post', x: 0, z: 2, r: 0.16, h: 0.3, skin: 'mug' }],
  ['pot', { kind: 'post', x: 0, z: 2, r: 0.2, h: 0.3, skin: 'pot' }],
  ['flowerpot', { kind: 'post', x: 0, z: 2, r: 0.2, h: 0.35, skin: 'flowerpot' }],
  ['sandcastle', { kind: 'post', x: 0, z: 2, r: 0.3, h: 0.4, skin: 'sandcastle' }],
  ['iceblock', { kind: 'wall', x: 0, z: 2, len: 0.6, thick: 0.4, h: 0.3, a: 0, skin: 'iceblock' }],
];
for (const [name, p] of pieceCases)
  for (const power of [0.2, 0.4, 0.6, 0.8, 1])
    add(`piece:${name}`, name === 'iceblock' ? 'ice' : 'desk', lone, { placeAngle: PLACE, aimAngle: AIM, power, spin: 0 }, true, at(p));

// F) The kerb: hard at it from inside, on a bouncy kerb and a soft one.
for (const arena of ['culdesac', 'grass', 'minigolf'] as ArenaId[])
  for (const power of [0.6, 1]) add('kerb', arena, lone, { placeAngle: -Math.PI / 2, aimAngle: -Math.PI / 2 + 0.25, power, spin: 1 });

const LUAU_CHECK = readFileSync('roblox/tests/sim-check.luau', 'utf8');

await initPhysics();
for (const c of cases) {
  const sim = new ShotSim(c.layout, ARENAS[c.arena].surface, c.shot, c.first, c.pieces);
  let broken = 0;
  while (!sim.done) {
    sim.step();
    broken += sim.broke.length;
  }
  const layout = sim.resultLayout();
  const steps = sim.steps;
  sim.free();
  const captured = layout.targets.filter((t) => isOutsideRing(t.x, t.z)).length;
  const s = layout.shooter;
  c.want = { layout, steps, captured, shooterOut: !s || isOutsideRing(s.x, s.z), broken };
}

// Each map's pieces once; cases point at them.
const pieceSets: Piece[][] = [];
const setOf = (ps: Piece[]) => {
  if (!ps.length) return 0;
  let i = pieceSets.indexOf(ps);
  if (i < 0) i = pieceSets.push(ps) - 1;
  return i + 1;
};
const rows = cases.map((c) => ({
  group: c.group,
  arena: c.arena,
  targets: c.layout.targets,
  shot: c.shot,
  first: c.first,
  set: setOf(c.pieces),
  want: { targets: c.want!.layout.targets, shooter: c.want!.layout.shooter ?? undefined, props: c.want!.layout.props?.map((p) => ({ ...p, i: p.i + 1 })), steps: c.want!.steps, captured: c.want!.captured, shooterOut: c.want!.shooterOut, broken: c.want!.broken },
}));

const body = `-- Generated by roblox/scripts/sim-fixtures.ts from src/core/physics.ts. Do not edit.
-- Ringer.Sim must play the web game's shots the way Rapier does: ${cases.length} shots.
-- Prints, per group, how far each marble ends from where Rapier left it and how often the
-- outcome (captures, taw out, props broken) is the same.
local Sim = require(game.ReplicatedStorage.Ringer.Sim)
local Surfaces = require(game.ReplicatedStorage.Ringer.Surfaces)
local SETS = ${lua(pieceSets)}
local CASES = ${lua(rows)}
${LUAU_CHECK}
`;
writeFileSync('roblox/tests/sim.luau', body);
console.log(`${cases.length} shots, ${pieceSets.length} piece sets written`);
