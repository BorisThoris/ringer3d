/**
 * Everything the game reports to a platform, under the game's own ids, with each platform's id
 * next to it. Steam names are created on the Steamworks partner site (steam/README.md); Play ids
 * come from the Play Console once the app exists there (empty = not reported on Play yet).
 */

export const ACHIEVEMENTS = {
  FIRST_WIN: { title: 'First knuckle', desc: 'Win your first match', steam: 'FIRST_WIN', play: '' },
  CLEAN_SWEEP: { title: 'Clean sweep', desc: 'Win a match without your opponent capturing a marble', steam: 'CLEAN_SWEEP', play: '' },
  ONLINE_WIN: { title: 'Ringer abroad', desc: 'Win an online match', steam: 'ONLINE_WIN', play: '' },
  TOWER_CLEARED: { title: 'Black Taw', desc: 'Beat the Tower with any fighter', steam: 'TOWER_CLEARED', play: '' },
  FIRST_BAG: { title: 'Mint condition', desc: 'Open your first Marble Bag', steam: 'FIRST_BAG', play: '' },
  LEGENDARY_PULL: { title: 'Legend in the bag', desc: 'Pull a Legendary marble', steam: 'LEGENDARY_PULL', play: '' },
  MYTHIC_PULL: { title: 'Myth made glass', desc: 'Pull a Mythic marble', steam: 'MYTHIC_PULL', play: '' },
  SHINY_PULL: { title: 'Something shiny', desc: 'Own a Shiny marble', steam: 'SHINY_PULL', play: '' },
  MINT_PULL: { title: 'Factory fresh', desc: 'Own a Mint marble', steam: 'MINT_PULL', play: '' },
  TRADE_UP: { title: 'Five for one', desc: 'Trade up five marbles', steam: 'TRADE_UP', play: '' },
  BOOK_SET: { title: 'Page complete', desc: 'Complete a Marble Book set', steam: 'BOOK_SET', play: '' },
  COLLECTOR_25: { title: 'Pocketful', desc: 'Own 25 collectible marbles', steam: 'COLLECTOR_25', play: '' },
  DAILY_7: { title: 'Every day a ringer', desc: 'Claim the daily reward seven days in a row', steam: 'DAILY_7', play: '' },
} as const;
export type AchievementId = keyof typeof ACHIEVEMENTS;

/** Integer stats. Play has no free-form stats; it keeps the leaderboards below instead. */
export const STATS = {
  games_played: { steam: 'games_played' },
  games_won: { steam: 'games_won' },
  marbles_captured: { steam: 'marbles_captured' },
  bags_opened: { steam: 'bags_opened' },
  marbles_owned: { steam: 'marbles_owned' },
} as const;
export type StatId = keyof typeof STATS;

/** Leaderboards: higher is better on all of them. */
export const LEADERBOARDS = {
  wins: { title: 'Most wins', steam: 'ringer_wins', play: '' },
  captures: { title: 'Most marbles captured', steam: 'ringer_captures', play: '' },
  collection: { title: 'Best collection', steam: 'ringer_collection', play: '' },
} as const;
export type BoardId = keyof typeof LEADERBOARDS;
