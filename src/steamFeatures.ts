import { progress, settings } from './game/settings';
import { wallet } from './game/wallet';
import { steam } from './steam';

/**
 * Steam features fed by the game's own stores, so no game code has to know about Steam:
 *  - achievements and stats (ids defined on the Steamworks partner site: see steam/README.md)
 *  - Steam Cloud: settings, progress and the wallet sync across PCs and the Steam Deck
 *  - rich presence for the friends list
 *  - Steam Deck: lighter graphics by default
 * Off the Steam build everything here is a no-op.
 */

export const ACHIEVEMENTS = {
  FIRST_WIN: 'Win your first match',
  CLEAN_SWEEP: 'Win a match without your opponent capturing a marble',
  ONLINE_WIN: 'Win an online match',
  TOWER_CLEARED: 'Beat the Tower with any fighter',
  FIRST_BAG: 'Open your first Marble Bag',
  LEGENDARY_PULL: 'Pull a Legendary marble',
  MYTHIC_PULL: 'Pull a Mythic marble',
  COLLECTOR_25: 'Own 25 generated marbles',
  DAILY_7: 'Claim the daily reward seven days in a row',
} as const;
export type AchievementId = keyof typeof ACHIEVEMENTS;

/** Integer stats (same names on the partner site). */
export const STATS = ['games_played', 'games_won', 'marbles_captured', 'bags_opened', 'marbles_owned'] as const;

const unlocked = new Set<string>();
function unlock(id: AchievementId) {
  if (!steam || unlocked.has(id)) return;
  unlocked.add(id);
  void steam.unlock(id);
}

/** Called when a match ends for the local player. */
export function steamMatchEnd(r: { won: boolean; myScore: number; otherScores: number[]; online: boolean }) {
  if (!steam) return;
  if (r.won) unlock('FIRST_WIN');
  if (r.won && r.otherScores.every((s) => s === 0)) unlock('CLEAN_SWEEP');
  if (r.won && r.online) unlock('ONLINE_WIN');
}

/** What the friends list shows: "In the Collection", "Playing on The Beach"... */
export function steamPresence(status: string, group?: string) {
  if (!steam) return;
  void steam.presence('status', status);
  // steam_display needs a localisation token on the partner site; #Status uses %status%.
  void steam.presence('steam_display', '#Status');
  void steam.presence('steam_player_group', group ?? null);
  void steam.presence('steam_player_group_size', null);
}

// ---- Steam Cloud ----------------------------------------------------------------------------
// One file per store, wrapped with the time it was saved. On launch the newer of this PC's copy
// and the cloud copy wins; after that every change is written through (debounced).
const CLOUD = [
  { file: 'settings.json', key: 'ringer3d.settings.v1', store: settings },
  { file: 'progress.json', key: 'ringer3d.progress.v1', store: progress },
  { file: 'wallet.json', key: 'ringer3d.wallet.v1', store: wallet },
] as const;
const AT_KEY = 'ringer3d.savedAt.v1';

function savedAt(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(AT_KEY) ?? '{}');
  } catch {
    return {};
  }
}

async function syncCloud() {
  const s = steam!;
  const at = savedAt();
  for (const c of CLOUD) {
    const text = await s.cloudRead(c.file);
    let remoteAt = -1;
    try {
      if (text) remoteAt = (JSON.parse(text) as { at: number }).at;
      if (text && remoteAt > (at[c.file] ?? 0)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c.store as any).set((JSON.parse(text) as { data: object }).data);
        at[c.file] = remoteAt;
        continue;
      }
    } catch {
      /* a damaged cloud file loses to the local copy */
    }
    // The local copy wins (or the cloud has none yet): upload it now, not on the next change.
    if (remoteAt < (at[c.file] ?? 0) || !text || remoteAt < 0) {
      at[c.file] = at[c.file] ?? Date.now();
      void s.cloudWrite(c.file, JSON.stringify({ at: at[c.file], data: c.store.get() }));
    }
  }
  localStorage.setItem(AT_KEY, JSON.stringify(at));
  for (const c of CLOUD) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    c.store.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const now = Date.now();
        const a = savedAt();
        a[c.file] = now;
        localStorage.setItem(AT_KEY, JSON.stringify(a));
        void s.cloudWrite(c.file, JSON.stringify({ at: now, data: c.store.get() }));
      }, 2500);
    });
  }
}

// ---- Achievements and stats from the stores --------------------------------------------------
function watchStores() {
  const s = steam!;
  const stat = (name: (typeof STATS)[number], v: number) => void s.statSet(name, Math.floor(v));
  const onProgress = () => {
    const p = progress.get();
    stat('games_played', p.stats.played);
    stat('games_won', p.stats.won);
    stat('marbles_captured', p.stats.captured);
    if (p.cleared.length > 0) unlock('TOWER_CLEARED');
    void s.statsStore();
  };
  const onWallet = () => {
    const w = wallet.get();
    stat('bags_opened', w.bagsOpened);
    stat('marbles_owned', w.owned.length);
    if (w.bagsOpened > 0) unlock('FIRST_BAG');
    if (w.owned.some((o) => o.tier === 'Legendary')) unlock('LEGENDARY_PULL');
    if (w.owned.some((o) => o.tier === 'Mythic')) unlock('MYTHIC_PULL');
    if (w.owned.length >= 25) unlock('COLLECTOR_25');
    if (w.streak >= 7) unlock('DAILY_7');
    void s.statsStore();
  };
  progress.subscribe(onProgress);
  wallet.subscribe(onWallet);
  onProgress();
  onWallet();
}

/** Start Steam integration once, at boot. */
export async function initSteam() {
  if (!steam) return;
  try {
    const me = await steam.me();
    const st = settings.get();
    // First launch on Steam: the Steam name, and lighter graphics on a Steam Deck.
    if (/^Player\d+$/.test(st.playerName)) settings.set({ playerName: me.name.slice(0, 20) });
    if (me.deck && !localStorage.getItem('ringer3d.deckDefaults')) {
      settings.set({ quality: 'medium' });
      localStorage.setItem('ringer3d.deckDefaults', '1');
    }
    await syncCloud();
    watchStores();
    steamPresence('In the menu');
  } catch (e) {
    console.warn('Steam integration failed', e);
  }
}
