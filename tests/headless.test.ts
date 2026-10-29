import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { botAgent, playMatch, randomAgent } from '../src/headless/agents';
import { HeadlessGame } from '../src/headless/game';
import { stdioAgent } from '../src/headless/node';
import { generateMarble, marbleFixtures, RARITY, tierFor } from '../src/core/marbleGen';

describe('headless game', () => {
  it('observes plain JSON and plays a shot', async () => {
    const g = await HeadlessGame.create({ arena: 'grass', difficulty: 'hard', seed: 7, players: [{ name: 'a' }, { name: 'b' }] });
    const obs = g.observe();
    expect(JSON.parse(JSON.stringify(obs))).toEqual(obs);
    expect(obs.targets).toHaveLength(13);
    expect(obs.pieces.length).toBeGreaterThan(0);
    const r = g.act({ placeAngle: obs.seatAngle, aimAngle: obs.seatAngle + Math.PI, power: 0.7, spin: 0 });
    expect(r.events.some((e) => e.type === 'shot')).toBe(true);
    g.dispose();
  });

  it('a bot beats a random player over a whole match', async () => {
    const r = await playMatch({ arena: 'desk', difficulty: 'easy', seed: 3 }, [botAgent('expert', 3), randomAgent(3)]);
    expect(r.winners.length).toBeGreaterThan(0);
    expect(r.scores[0]).toBeGreaterThan(r.scores[1]);
    expect(r.log.length).toBe(r.shots);
  }, 120_000);

  it('plays an agent in another process over stdio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ringer-agent-'));
    const file = join(dir, 'agent.mjs');
    // Shoots from its seat straight at the middle of the ring at 80% power.
    writeFileSync(
      file,
      `import { createInterface } from 'node:readline';
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.type !== 'observe') continue;
  const o = m.obs, a = o.seatAngle;
  const from = o.shooter ?? { x: Math.cos(a) * o.world.ringRadius, z: Math.sin(a) * o.world.ringRadius };
  process.stdout.write(JSON.stringify({ placeAngle: a, aimAngle: Math.atan2(-from.z, -from.x), power: 0.8, spin: 0 }) + '\\n');
}`,
    );
    const agent = stdioAgent(`node "${file}"`);
    const r = await playMatch({ arena: 'ice', difficulty: 'easy', seed: 5 }, [agent, randomAgent(5)], 30);
    await agent.close?.();
    expect(r.log.filter((l) => l.player === 0).length).toBeGreaterThan(0);
  }, 120_000);
});

describe('generated marbles', () => {
  it('a seed is always the same marble', () => {
    expect(generateMarble(12345)).toEqual(generateMarble(12345));
    expect(generateMarble(1).name).not.toEqual(generateMarble(2).name + 'x');
  });

  it('rolls tiers with the published odds', () => {
    const n = 20000;
    const count: Record<string, number> = {};
    for (let s = 0; s < n; s++) {
      const t = generateMarble(s).tier;
      count[t] = (count[t] ?? 0) + 1;
    }
    for (const r of RARITY) expect(Math.abs((count[r.tier] ?? 0) / n * 100 - r.odds)).toBeLessThan(Math.max(0.6, r.odds * 0.12));
    expect(tierFor(99.9)).toBe('Mythic');
  });

  it('keeps every trait inside its tier', () => {
    for (let s = 0; s < 3000; s++) {
      const m = generateMarble(s);
      const rule = RARITY.find((r) => r.tier === m.tier)!;
      expect(rule.patterns).toContain(m.pattern);
      expect(rule.finishes).toContain(m.finish);
      expect(m.base).toMatch(/^#[0-9a-f]{6}$/);
      expect(m.glow).toBeGreaterThanOrEqual(rule.glow[0]);
      expect(m.glow).toBeLessThanOrEqual(rule.glow[1]);
    }
  });

  it('is varied: thousands of distinct looks', () => {
    const looks = new Set<string>();
    for (let s = 0; s < 5000; s++) {
      const m = generateMarble(s);
      looks.add(`${m.pattern}|${m.finish}|${m.base}|${m.accent}|${m.accent2}`);
    }
    expect(looks.size).toBe(5000);
    expect(marbleFixtures().length).toBe(45);
  });
});

import { claimDaily, ECONOMY, freshWallet, grantPurchase, matchReward, melt, openBag } from '../src/core/economy';

describe('economy', () => {
  it('a bag costs its price and mints the seed\'s marble', () => {
    const w = { ...freshWallet(), coins: 1000 };
    const r = openBag(w, 777, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wallet.coins).toBe(1000 - ECONOMY.bagPrice);
    expect(r.wallet.owned).toEqual([{ id: 'g777', tier: r.marble.tier, at: 5 }]);
    expect(openBag({ ...freshWallet(), coins: 10 }, 1).ok).toBe(false);
  });

  it('melting pays the tier and removes the marble', () => {
    const r = openBag({ ...freshWallet(), coins: 300 }, 42);
    if (!r.ok) throw new Error('bag');
    const m = melt(r.wallet, 'g42');
    expect(m.ok && m.wallet.owned.length === 0 && m.coins === ECONOMY.melt[r.marble.tier]).toBe(true);
    expect(melt(r.wallet, 'g43').ok).toBe(false);
  });

  it('daily streaks grow, reset after a gap, and pay once a day', () => {
    let w = freshWallet();
    const a = claimDaily(w, 100);
    if (!a.ok) throw new Error();
    w = a.wallet;
    expect(claimDaily(w, 100).ok).toBe(false);
    const b = claimDaily(w, 101);
    expect(b.ok && b.streak === 2).toBe(true);
    const c = claimDaily(w, 105);
    expect(c.ok && c.streak === 1).toBe(true);
  });

  it('a store receipt is credited once', () => {
    const w = grantPurchase(freshWallet(), 'r1', 'coins_small');
    expect(w.coins).toBe(ECONOMY.startCoins + 500);
    expect(grantPurchase(w, 'r1', 'coins_small')).toBe(w);
    expect(matchReward({ won: true, captured: 7 })).toBe(95);
  });
});
