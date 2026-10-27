import type { Piece } from './types';

/**
 * How a standing obstacle behaves when a marble hits it, by skin.
 *  density  set: it is loose and slides (and turns) when hit; unset: it is set in place
 *  breakAt  set: a hit harder than this contact force breaks it, and it is gone for the
 *           rest of the match (a marble at 60% power lands about 200, at full about 420)
 * A marble is about 0.1 mass units, so a prop's weight decides how far a hit sends it: an
 * eraser skids off like a marble, a book barely shifts, a kerb stone never moves.
 */
export interface PropTraits {
  density?: number;
  breakAt?: number;
}

export const PROP_TRAITS: Record<string, PropTraits> = {
  // Desk
  book: { density: 4 },
  eraser: { density: 5 },
  ruler: { density: 6 },
  mug: { density: 2, breakAt: 360 },
  pot: { density: 2, breakAt: 260 },
  // Street
  brick: { density: 8 },
  cone: { density: 1.5 },
  // Lawn
  log: { density: 5 },
  flowerpot: { density: 2.5, breakAt: 270 },
  // Beach: sandcastles stand until something hits them, then they slump.
  driftwood: { density: 4 },
  sandcastle: { breakAt: 120 },
  // Ice
  iceblock: { density: 7, breakAt: 420 },
};

export type PropPiece = Extract<Piece, { kind: 'wall' } | { kind: 'post' }>;

/** The traits of a map piece, if it is a prop that can move or break. */
export function propTraits(p: Piece): PropTraits | null {
  if (p.kind !== 'wall' && p.kind !== 'post') return null;
  const t = p.skin ? PROP_TRAITS[p.skin] : undefined;
  return t && (t.density !== undefined || t.breakAt !== undefined) ? t : null;
}

/** A prop's place between shots, by its index in the map's pieces. `a` is its yaw. */
export interface PropState {
  i: number;
  x: number;
  z: number;
  a: number;
  broken?: boolean;
}

/** Every prop where the map put it. */
export function initialProps(pieces: readonly Piece[]): PropState[] {
  const out: PropState[] = [];
  pieces.forEach((p, i) => {
    if (!propTraits(p)) return;
    const q = p as PropPiece;
    out.push({ i, x: q.x, z: q.z, a: q.kind === 'wall' ? q.a : 0 });
  });
  return out;
}
