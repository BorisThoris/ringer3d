import { ACHIEVEMENTS, LEADERBOARDS, type AchievementId } from './catalog';
import type { PlatformServices } from './types';

/**
 * Google Play Games Services as PlatformServices: the Android build plugs in here. The native
 * side is a Capacitor plugin named "PlayGames" (android/app, like PlayBillingPlugin) wrapping the
 * Play Games v2 SDK; this file is its contract and the mapping. Ids come from the Play Console
 * (catalog.ts `play`); anything without one is skipped. Purchases are the PlayBilling adapter
 * (src/platformStore.ts); collectibles stay in the game's own wallet (Play has no inventory).
 *
 * Play sits on top of `local` (this device's own record): achievements and personal bests are
 * kept there too, so the Profile, pop-ups and leaderboards behave the same before the Console ids
 * exist, when the player isn't signed in to Play Games, or offline.
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

export function createPlayServices(plugin: PlayGamesPlugin, local: PlatformServices): PlatformServices {
  const sent = new Set<AchievementId>();
  return {
    platform: 'play',
    async identity() {
      try {
        const me = await plugin.signIn();
        return { id: me.playerId, name: me.displayName, handheld: false, language: 'english' };
      } catch {
        return local.identity();
      }
    },
    async unlock(id) {
      await local.unlock(id);
      const playId = ACHIEVEMENTS[id].play as string;
      if (!playId || sent.has(id)) return;
      sent.add(id);
      await plugin.unlockAchievement({ id: playId });
    },
    async unlocked() {
      const mine = await local.unlocked();
      const ids = await plugin.unlockedAchievements().then((r) => new Set(r.ids), () => new Set<string>());
      const onPlay = (Object.keys(ACHIEVEMENTS) as AchievementId[]).filter((a) => ACHIEVEMENTS[a].play && ids.has(ACHIEVEMENTS[a].play));
      return [...new Set([...mine, ...onPlay])];
    },
    // Play Games has no free-form stats: the leaderboards carry the numbers that matter.
    setStat() {},
    async flush() {},
    async submitScore(board, score) {
      await local.submitScore(board, score);
      const id = LEADERBOARDS[board].play as string;
      if (id) await plugin.submitScore({ leaderboardId: id, score: Math.floor(score) });
      return { rank: null };
    },
    async scores(board, scope, count = 10) {
      const id = LEADERBOARDS[board].play as string;
      // No Play board yet: your personal best, like the web build.
      if (!id) return scope === 'friends' ? [] : local.scores(board, scope, count);
      const r = await plugin.loadScores({ leaderboardId: id, collection: scope === 'friends' ? 'FRIENDS' : 'PUBLIC', centered: scope === 'around', count });
      return r.scores.map((s) => ({ playerId: s.playerId, name: s.displayName, rank: s.rank, score: s.score }));
    },
    cloud: {
      // Saved Games off in the Console, or not signed in: no cloud copy, the device keeps its own.
      read: (file) => plugin.loadSnapshot({ name: file }).then((r) => r.data, () => null),
      write: (file, text) => plugin.saveSnapshot({ name: file, data: text, description: `Ringer 3D ${file}` }).then((r) => r.ok, () => false),
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

