import { describe, expect, it } from 'vitest';
import { BOT_PROFILES } from '../src/ai/profiles';
import { buildTower, FIGHTERS } from '../src/game/story';

const BOT_ORDER = ['rookie', 'novice', 'casual', 'regular', 'skilled', 'expert', 'master', 'legend'];
const MAP_ORDER = ['easy', 'medium', 'hard'];
const GUIDE_ORDER = ['full', 'short', 'off'];

describe('the tower', () => {
  it('only ever gets harder: opponent skill, map and aim guide never ease on the way up', () => {
    for (const f of FIGHTERS.filter((x) => x.id !== 'obsidian')) {
      const stages = buildTower(f.id);
      expect(stages).toHaveLength(8);
      for (let i = 1; i < stages.length; i++) {
        const a = stages[i - 1];
        const b = stages[i];
        // Strictly stronger every floor.
        expect(BOT_ORDER.indexOf(b.bot), `${f.id} floor ${i + 1} bot`).toBeGreaterThan(BOT_ORDER.indexOf(a.bot));
        expect(MAP_ORDER.indexOf(b.difficulty), `${f.id} floor ${i + 1} map`).toBeGreaterThanOrEqual(MAP_ORDER.indexOf(a.difficulty));
        expect(GUIDE_ORDER.indexOf(b.guide), `${f.id} floor ${i + 1} guide`).toBeGreaterThanOrEqual(GUIDE_ORDER.indexOf(a.guide));
      }
      // The first floor is gentle, the last is the hardest there is.
      expect(stages[0]).toMatchObject({ bot: 'rookie', difficulty: 'easy', guide: 'full' });
      expect(stages[7]).toMatchObject({ opponent: 'obsidian', bot: 'legend', difficulty: 'hard', guide: 'off', wins: 3 });
      // Ice is swingy: its floors are a series, never a single game.
      for (const s of stages) if (s.arena === 'ice') expect(s.wins, `${f.id} ${s.opponent}`).toBeGreaterThan(1);
    }
  });

  it('each step up the bot ladder steadies the hand and deepens the thinking', () => {
    for (let i = 1; i < BOT_ORDER.length; i++) {
      const a = BOT_PROFILES[BOT_ORDER[i - 1]];
      const b = BOT_PROFILES[BOT_ORDER[i]];
      expect(b.aimErrorDeg).toBeLessThan(a.aimErrorDeg);
      expect(b.powerError).toBeLessThan(a.powerError);
      expect(b.candidates).toBeGreaterThan(a.candidates);
      expect(b.blunder).toBeLessThanOrEqual(a.blunder);
    }
  });
});
