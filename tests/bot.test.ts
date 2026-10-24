import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/core/physics';
import { Match } from '../src/core/match';
import { DEFAULT_SURFACE, type PlayerInfo } from '../src/core/types';
import { Rng } from '../src/core/rng';
import { planBotShot } from '../src/ai/bot';
import { BOT_PROFILES } from '../src/ai/profiles';

beforeAll(async () => {
  await initPhysics();
});

async function botMatch(a: string, b: string, seed: number) {
  const players: PlayerInfo[] = [
    { id: 'a', name: a, marble: 'ember', kind: 'bot', botProfile: a },
    { id: 'b', name: b, marble: 'tide', kind: 'bot', botProfile: b },
  ];
  const m = new Match({ players, seed, surface: DEFAULT_SURFACE });
  const rng = new Rng(seed ^ 0xabc);
  m.start();
  let guard = 0;
  while (m.phase !== 'gameOver' && guard++ < 300) {
    const prof = BOT_PROFILES[m.currentPlayer.botProfile!];
    const shot = await planBotShot(
      { layout: m.layout, firstShotOfTurn: m.firstShotOfTurn, seatAngle: m.seatAngle(m.current), surface: DEFAULT_SURFACE },
      prof,
      rng,
    );
    m.shoot(shot);
    m.finishShot();
  }
  return { winners: m.winners, scores: m.scores, shots: m.shotsTaken };
}

describe('bots', () => {
  it('stronger bots beat weaker ones more often than not', async () => {
    let legendWins = 0;
    const games = 6;
    let shots = 0;
    for (let g = 0; g < games; g++) {
      const r = await botMatch('legend', 'rookie', 100 + g);
      shots += r.shots;
      if (r.winners.length === 1 && r.winners[0] === 0) legendWins++;
    }
    console.log(`legend beat rookie ${legendWins}/${games}, avg shots ${(shots / games).toFixed(1)}`);
    expect(legendWins).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('bot vs bot is reproducible from the seed', async () => {
    const a = await botMatch('skilled', 'casual', 7);
    const b = await botMatch('skilled', 'casual', 7);
    expect(a).toEqual(b);
  }, 120_000);
});
