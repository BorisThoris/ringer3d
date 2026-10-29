import { ACHIEVEMENTS, type AchievementId, type BoardId, type StatId } from './catalog';
import type { PlatformServices } from './types';

/** Where local services keep their state: localStorage in a browser, a Map in Node. */
export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function memoryKV(): KeyValue {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}

/**
 * No store platform (the web build, itch.io, development): achievements, stats and personal
 * bests kept on this device, so the game behaves the same and nothing is lost when a platform
 * appears. No cloud, no friends, no platform items.
 */
export function createLocalServices(kv: KeyValue, name: () => string = () => 'You'): PlatformServices {
  const KEY = 'ringer3d.local-services.v1';
  type State = { achievements: AchievementId[]; stats: Partial<Record<StatId, number>>; best: Partial<Record<BoardId, number>> };
  const load = (): State => {
    try {
      return { achievements: [], stats: {}, best: {}, ...JSON.parse(kv.get(KEY) ?? '{}') };
    } catch {
      return { achievements: [], stats: {}, best: {} };
    }
  };
  const save = (s: State) => kv.set(KEY, JSON.stringify(s));

  return {
    platform: 'local',
    async identity() {
      return { id: 'local', name: name(), handheld: false, language: 'english' };
    },
    async unlock(id) {
      const s = load();
      if (!ACHIEVEMENTS[id] || s.achievements.includes(id)) return;
      save({ ...s, achievements: [...s.achievements, id] });
    },
    async unlocked() {
      return load().achievements;
    },
    setStat(id, value) {
      const s = load();
      save({ ...s, stats: { ...s.stats, [id]: Math.floor(value) } });
    },
    async flush() {},
    async submitScore(board, score) {
      const s = load();
      if (score > (s.best[board] ?? -Infinity)) save({ ...s, best: { ...s.best, [board]: Math.floor(score) } });
      return { rank: null };
    },
    async scores(board) {
      const best = load().best[board];
      return best === undefined ? [] : [{ playerId: 'local', name: name(), rank: 1, score: best }];
    },
    cloud: null,
    presence() {},
    async friends() {
      return [];
    },
    moment() {},
    mode() {},
    items: null,
  };
}
