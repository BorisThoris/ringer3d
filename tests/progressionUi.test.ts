import { describe, expect, it } from 'vitest';
import { claimDaily, ECONOMY, freshWallet, nextDaily, playerLevel } from '../src/core/economy';

describe('daily reward strip', () => {
  it('previews exactly what the claim pays, day after day and after a missed day', () => {
    let w = freshWallet();
    for (const day of [100, 101, 102, 103, 104, 105, 106, 107, 109]) {
      const preview = nextDaily(w, day);
      const r = claimDaily(w, day);
      if (!r.ok) throw new Error('claim refused');
      expect(preview).toEqual({ streak: r.streak, coins: r.coins, ready: true });
      w = r.wallet;
      expect(nextDaily(w, day)).toMatchObject({ ready: false, streak: r.streak });
    }
    // day 109 followed a missed day 108: back to day one
    expect(w.streak).toBe(1);
    expect(nextDaily(w, 110).coins).toBe(ECONOMY.daily[1]);
  });
});

describe('player level', () => {
  it('starts at 1 and climbs with play', () => {
    expect(playerLevel({ played: 0, won: 0, captured: 0 })).toEqual({ level: 1, xp: 0, into: 0, need: 100 });
    // 5 games, 2 wins, 10 captures = 100 + 80 + 40 = 220 xp: level 2 at 100, 120 into the next 200
    expect(playerLevel({ played: 5, won: 2, captured: 10 })).toEqual({ level: 2, xp: 220, into: 120, need: 200 });
    const many = playerLevel({ played: 400, won: 200, captured: 3000 });
    expect(many.level).toBeGreaterThan(10);
    expect(many.into).toBeLessThan(many.need);
  });
});
