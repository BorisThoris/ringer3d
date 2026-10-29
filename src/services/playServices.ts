import { ACHIEVEMENTS, LEADERBOARDS, type AchievementId } from './catalog';
import type { PlatformServices } from './types';

/**
 * Google Play Games Services as PlatformServices: the Android build plugs in here. The native
 * side is a Capacitor plugin named "PlayGames" (android/app, like PlayBillingPlugin) wrapping the
 * Play Games v2 SDK; this file is its contract and the mapping. Ids come from the Play Console
 * (catalog.ts `play`); anything without one is skipped. Purchases are the PlayBilling adapter
 * (src/platformStore.ts); collectibles stay in the game's own wallet (Play has no inventory).
 */
export interface PlayGamesPlugin {
  /** Silent sign-in (Play Games v2 signs in automatically on launch). */
  signIn(): Promise<{ playerId: string; displayName: string }>;
  unlockAchievement(o: { id: string }): Promise<void>;
  /** Achievement ids the player has unlocked. */
  unlockedAchievements(): Promise<{ ids: string[] }>;
  submitScore(o: { leaderboardId: string; score: number }): Promise<void>;
  /** collection: 'PUBLIC' | 'FRIENDS'; span: all time. */
  loadScores(o: { leaderboardId: string; collection: 'PUBLIC' | 'FRIENDS'; centered: boolean; count: number }): Promise<{
    scores: { playerId: string; displayName: string; rank: number; score: number }[];
  }>;
  /** Saved Games snapshots, by name. */
  loadSnapshot(o: { name: string }): Promise<{ data: string | null }>;
  saveSnapshot(o: { name: string; data: string; description: string }): Promise<{ ok: boolean }>;
}

export function createPlayServices(plugin: PlayGamesPlugin): PlatformServices {
  const sent = new Set<AchievementId>();
  return {
    platform: 'play',
    async identity() {
      const me = await plugin.signIn();
      return { id: me.playerId, name: me.displayName, handheld: false, language: 'english' };
    },
    async unlock(id) {
      const playId = ACHIEVEMENTS[id].play as string;
      if (!playId || sent.has(id)) return;
      sent.add(id);
      await plugin.unlockAchievement({ id: playId });
    },
    async unlocked() {
      const { ids } = await plugin.unlockedAchievements();
      const have = new Set(ids);
      return (Object.keys(ACHIEVEMENTS) as AchievementId[]).filter((a) => ACHIEVEMENTS[a].play && have.has(ACHIEVEMENTS[a].play));
    },
    // Play Games has no free-form stats: the leaderboards carry the numbers that matter.
    setStat() {},
    async flush() {},
    async submitScore(board, score) {
      const id = LEADERBOARDS[board].play as string;
      if (id) await plugin.submitScore({ leaderboardId: id, score: Math.floor(score) });
      return { rank: null };
    },
    async scores(board, scope, count = 10) {
      const id = LEADERBOARDS[board].play as string;
      if (!id) return [];
      const r = await plugin.loadScores({ leaderboardId: id, collection: scope === 'friends' ? 'FRIENDS' : 'PUBLIC', centered: scope === 'around', count });
      return r.scores.map((s) => ({ playerId: s.playerId, name: s.displayName, rank: s.rank, score: s.score }));
    },
    cloud: {
      read: async (file) => (await plugin.loadSnapshot({ name: file })).data,
      write: async (file, text) => (await plugin.saveSnapshot({ name: file, data: text, description: `Ringer 3D ${file}` })).ok,
    },
    presence() {},
    async friends() {
      return [];
    },
    moment() {},
    mode() {},
    items: null,
  };
}

