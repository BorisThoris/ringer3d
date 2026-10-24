/** Visual identity of a marble. Purely cosmetic: every marble plays identically (fairness). */
export type MarbleCore = 'catseye' | 'swirl' | 'solid' | 'galaxy' | 'steelie' | 'onyx' | 'opal' | 'neon' | 'onionskin' | 'clearie';

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

/** The 13 targets: a mixed bag, as in any real bag of marbles. */
export const MIB_LOOKS: MarbleLook[] = [
  { id: 'mib-a', name: 'Mib', core: 'catseye', base: '#eaf6ff', accent: '#1f7bff', accent2: '#5ad1ff', clarity: 0.95, glow: 0.1 },
  { id: 'mib-b', name: 'Mib', core: 'catseye', base: '#fff4e6', accent: '#ff5a36', accent2: '#ffd23f', clarity: 0.95, glow: 0.1 },
  { id: 'mib-c', name: 'Mib', core: 'catseye', base: '#e9ffe9', accent: '#17b35a', accent2: '#c2ff7a', clarity: 0.95, glow: 0.1 },
  { id: 'mib-d', name: 'Mib', core: 'swirl', base: '#f2e9ff', accent: '#8a4dff', accent2: '#ff7ad9', clarity: 0.9, glow: 0.1 },
  { id: 'mib-e', name: 'Mib', core: 'clearie', base: '#9fe8ff', accent: '#ffffff', accent2: '#ffffff', clarity: 1, glow: 0 },
  { id: 'mib-f', name: 'Mib', core: 'swirl', base: '#e6fbff', accent: '#00b3c7', accent2: '#004e7c', clarity: 0.9, glow: 0.1 },
  { id: 'mib-g', name: 'Mib', core: 'clearie', base: '#ffd9a8', accent: '#ffffff', accent2: '#ffffff', clarity: 1, glow: 0 },
  { id: 'mib-h', name: 'Mib', core: 'onionskin', base: '#fff6ea', accent: '#c2185b', accent2: '#ffd23f', clarity: 0.9, glow: 0.1 },
];
