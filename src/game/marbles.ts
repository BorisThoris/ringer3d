/** Visual identity of a marble. Purely cosmetic: every marble plays identically (fairness). */
export type MarbleCore = 'catseye' | 'swirl' | 'solid' | 'galaxy' | 'steelie' | 'onyx' | 'opal' | 'neon';

export interface MarbleLook {
  id: string;
  name: string;
  core: MarbleCore;
  /** Glass/body colour. */
  base: string;
  /** Inner feature colours. */
  accent: string;
  accent2: string;
  /** 0 = opaque, 1 = clear glass. */
  clarity: number;
  /** Emissive glow for inner features (0..1). */
  glow: number;
}

export const MARBLES: Record<string, MarbleLook> = {
  ember: { id: 'ember', name: 'Ember', core: 'catseye', base: '#ffe3cf', accent: '#ff4d1f', accent2: '#ffb000', clarity: 0.9, glow: 0.25 },
  tide: { id: 'tide', name: 'Tide', core: 'swirl', base: '#cfefff', accent: '#1a7cff', accent2: '#e9fbff', clarity: 0.85, glow: 0.1 },
  pip: { id: 'pip', name: 'Pip', core: 'solid', base: '#c98a4b', accent: '#7a4a22', accent2: '#e8b27a', clarity: 0, glow: 0 },
  jade: { id: 'jade', name: 'Jade', core: 'swirl', base: '#b8f5d2', accent: '#0f9d58', accent2: '#e0ffe9', clarity: 0.7, glow: 0.05 },
  volt: { id: 'volt', name: 'Volt', core: 'neon', base: '#1b1530', accent: '#00f0ff', accent2: '#ff2bd6', clarity: 0.55, glow: 1 },
  rime: { id: 'rime', name: 'Rime', core: 'opal', base: '#f2f8ff', accent: '#9fd8ff', accent2: '#f7c6ff', clarity: 0.6, glow: 0.15 },
  ironside: { id: 'ironside', name: 'Ironside', core: 'steelie', base: '#c9ced6', accent: '#8a929e', accent2: '#ffffff', clarity: 0, glow: 0 },
  nova: { id: 'nova', name: 'Nova', core: 'galaxy', base: '#120a2e', accent: '#8b5cff', accent2: '#ffd36b', clarity: 0.4, glow: 0.8 },
  obsidian: { id: 'obsidian', name: 'Obsidian', core: 'onyx', base: '#0b0b0f', accent: '#ff3d00', accent2: '#ffae00', clarity: 0.15, glow: 1 },
  /** The 13 targets ("mibs"): classic clear glass with a coloured vein. */
  mib: { id: 'mib', name: 'Mib', core: 'catseye', base: '#f4f7fb', accent: '#4dd2ff', accent2: '#ffffff', clarity: 0.92, glow: 0 },
};

/** Variety for the mibs so the cross looks hand-picked rather than cloned. */
export const MIB_ACCENTS = ['#4dd2ff', '#ff5a5a', '#ffd23f', '#43e97b', '#b06bff', '#ff8a3d', '#3df5d0'];
