import { useSyncExternalStore } from 'react';

/** Minimal external store usable from both the game loop and React. */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      subs.forEach((f) => f());
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => subs.delete(f);
    },
    use<S>(sel: (s: T) => S): S {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useSyncExternalStore(this.subscribe, () => sel(state));
    },
  };
}

export interface HudPlayer {
  name: string;
  marble: string;
  score: number;
  kind: 'human' | 'bot' | 'remote';
  local: boolean;
  connected: boolean;
}

export interface Banner {
  id: number;
  title: string;
  sub?: string;
  tone: 'neutral' | 'good' | 'bad' | 'gold';
}

export interface HudState {
  active: boolean;
  players: HudPlayer[];
  current: number;
  remaining: number;
  /** Local human may act right now. */
  myTurn: boolean;
  firstShot: boolean;
  rolling: boolean;
  power: number;
  spin: number;
  camTop: boolean;
  banner: Banner | null;
  winners: number[] | null;
  thinking: boolean;
  fast: boolean;
  netStatus: string | null;
  arenaName: string;
}

export const hud = createStore<HudState>({
  active: false,
  players: [],
  current: 0,
  remaining: 13,
  myTurn: false,
  firstShot: true,
  rolling: false,
  power: 0,
  spin: 0,
  camTop: false,
  banner: null,
  winners: null,
  thinking: false,
  fast: false,
  netStatus: null,
  arenaName: '',
});

let bannerId = 0;
export function showBanner(title: string, sub?: string, tone: Banner['tone'] = 'neutral') {
  hud.set({ banner: { id: ++bannerId, title, sub, tone } });
}
