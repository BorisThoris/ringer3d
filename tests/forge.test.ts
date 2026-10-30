import { describe, expect, it } from 'vitest';
import { BOOK, bookProgress, mintCollectible, EFFECT_IDS, EFFECT_ODDS, EFFECTS, generateMarble, RARITY, type GeneratedMarble } from '../packages/marble-forge/src';
import { meltValue } from '../src/core/economy';

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
};

/** A marble as the generator made it before phenomena and shapes existed. */
function legacy(m: GeneratedMarble) {
  const { effect, effectColor, shape, ...rest } = m;
  void effectColor;
  void shape;
  return { ...rest, name: effect === 'none' ? m.name : m.name.slice(EFFECTS[effect].title.length + 1) };
}

describe('Marble Forge', () => {
  it('keeps every existing marble exactly as it was (phenomena and shapes are drawn last)', () => {
    const old = [];
    for (let i = 0; i < 3000; i++) old.push(JSON.stringify(legacy(generateMarble(i * 104729 + 3))));
    // Digest of the same 3,000 marbles from the generator before this change.
    expect(fnv(old.join('|'))).toBe('5e73ad37');
  });

  it('rolls phenomena at the advertised odds, per tier', () => {
    for (const r of RARITY) {
      let n = 0;
      const N = 4000;
      for (let i = 0; i < N; i++) if (generateMarble(i * 7 + 11, r.tier).effect !== 'none') n++;
      const p = (n / N) * 100;
      expect(Math.abs(p - EFFECT_ODDS[r.tier])).toBeLessThan(Math.max(1, EFFECT_ODDS[r.tier] * 0.25));
    }
  });

  it('names a phenomenon, lists it as a trait and values it higher', () => {
    let found = null;
    for (let i = 0; i < 5000 && !found; i++) {
      const c = mintCollectible(`Lfx${i}`, 'Mythic');
      if (c.effect !== 'none') found = c;
    }
    expect(found).not.toBeNull();
    const c = found!;
    expect(c.marble.name.startsWith(EFFECTS[c.effect as keyof typeof EFFECTS].title)).toBe(true);
    expect(c.traits[0]).toBe(EFFECTS[c.effect as keyof typeof EFFECTS].title);
    expect(meltValue(c)).toBe(meltValue({ ...c, effect: 'none' }) * 4);
  });

  it('every phenomenon can be pulled, and the Book has a set for them', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20000 && seen.size < EFFECT_IDS.length; i++) {
      const e = generateMarble(i, 'Mythic').effect;
      if (e !== 'none') seen.add(e);
    }
    expect(seen.size).toBe(EFFECT_IDS.length);
    const set = BOOK.find((b) => b.id === 'phenomena')!;
    expect(set.needs.length).toBe(EFFECT_IDS.length);
    const owned = [];
    for (let i = 0; owned.length < 40; i++) {
      const c = mintCollectible(`Lbk${i}`, 'Mythic');
      if (c.effect !== 'none') owned.push(c);
    }
    expect(bookProgress(owned).find((p) => p.set.id === 'phenomena')!.got.length).toBeGreaterThan(3);
  });

  it('gives every marble its own interior shape, in range', () => {
    for (let i = 0; i < 500; i++) {
      const s = generateMarble(i * 31).shape;
      expect(s.blades).toBeGreaterThanOrEqual(3);
      expect(s.blades).toBeLessThanOrEqual(5);
      expect(s.bubbles).toBeGreaterThanOrEqual(1);
      expect(Math.abs(s.tilt)).toBeLessThanOrEqual(0.4);
    }
  });
});
