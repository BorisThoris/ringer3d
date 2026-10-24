/**
 * Story mode: a tower of opponents, Mortal Kombat style. Climb from the
 * schoolyard to the Taw King's courtyard. Each rung is a bot profile on its
 * home arena, with lines for the versus screen and the result.
 *
 * Difficulty rises through the bot's hand (aim/power noise) and judgement,
 * never through hidden advantages: see the fairness contract in bots/bot.ts.
 */
import type { BotProfile } from '../bots/bot';
import { TAWS, type MarbleLook } from '../render/marble';

export interface Fighter {
  id: string;
  name: string;
  title: string;
  arena: string;
  look: MarbleLook;
  profile: BotProfile;
  /** Versus-screen taunt. */
  intro: string;
  /** What they say when you beat them. */
  defeat: string;
  /** What they say when they beat you. */
  victory: string;
  /** Play first-to-7 instead of clearing the ring. */
  majority?: boolean;
}

const p = (id: string, aimNoise: number, powerNoise: number, judgement: number, aggression: number, usesSpin: boolean): BotProfile => ({
  id,
  aimNoise,
  powerNoise,
  judgement,
  aggression,
  usesSpin,
});

export const LADDER: Fighter[] = [
  {
    id: 'pip',
    name: 'Pip Tumble',
    title: 'The Recess Rookie',
    arena: 'schoolyard',
    look: { name: 'Cereal-Box Swirl', base: '#fff3d0', swirl: ['#ff8a3d', '#ffd23f', '#ff3b5c'], pattern: 'swirl' },
    profile: p('pip', 0.04, 0.14, 0.25, 0.5, false),
    intro: 'I got this marble from a cereal box. It\'s LUCKY.',
    defeat: 'Okay okay, best of three? Best of five?',
    victory: 'Cereal box luck never fails!',
  },
  {
    id: 'dusty',
    name: 'Dusty Knuckles',
    title: 'Keeper of the Dirt',
    arena: 'schoolyard',
    look: { name: 'Dust Devil', base: '#f3dcb8', swirl: ['#8a5a2b', '#e8c48a', '#5a3b22', '#ffffff'], pattern: 'onionskin' },
    profile: p('dusty', 0.028, 0.1, 0.45, 0.2, false),
    intro: 'Knuckles down, kid. Dirt doesn\'t forgive.',
    defeat: 'Huh. You knuckle down proper.',
    victory: 'Wash your hands. Then practise.',
  },
  {
    id: 'carla',
    name: 'Concrete Carla',
    title: 'Queen of the Rooftop',
    arena: 'rooftop',
    look: { name: 'Neon Roof', base: '#c9c2d6', swirl: ['#ff4fd8', '#7af3ff', '#ffe14f'], pattern: 'catseye' },
    profile: p('carla', 0.02, 0.08, 0.6, 0.6, false),
    intro: 'Up here the pavement\'s fast and the drop is long.',
    defeat: 'Fine. The roof is yours. Tonight.',
    victory: 'Watch your step on the way down.',
  },
  {
    id: 'velvet',
    name: 'Lord Velvet',
    title: 'The Carpet Duke',
    arena: 'parlour',
    look: { name: 'Velvet Plum', base: '#d9a6c8', swirl: ['#c9a14a', '#f3e2b5', '#6b1f4f'], pattern: 'catseye' },
    profile: p('velvet', 0.016, 0.065, 0.7, -0.4, true),
    intro: 'Shoes off. One does not scuff Grandmother\'s rug.',
    defeat: 'Most... uncouth. And most effective.',
    victory: 'Finesse, dear child. Not force.',
  },
  {
    id: 'steelie',
    name: 'Steelie Sam',
    title: 'Ball-Bearing Bruiser',
    arena: 'rooftop',
    look: { name: 'The Steelie', base: '#c3cad3', swirl: ['#ffffff'], pattern: 'steelie' },
    profile: p('steelie', 0.013, 0.055, 0.78, 0.8, false),
    intro: 'Steel beats glass. Every. Single. Time.',
    defeat: 'Dented. Not broken.',
    victory: 'Clang. That\'s the sound of you losing.',
  },
  {
    id: 'agate',
    name: 'Madame Agate',
    title: 'The Seer of Swirls',
    arena: 'parlour',
    look: { name: 'Seer\'s Nebula', base: '#b9a3ff', swirl: ['#ffd6fb', '#b38cff', '#1a0b33'], pattern: 'galaxy' },
    profile: p('agate', 0.009, 0.045, 0.86, -0.2, true),
    intro: 'I have seen this match already. You lose.',
    defeat: 'The swirls... lied?',
    victory: 'As foretold.',
  },
  {
    id: 'ghost',
    name: 'The Chalk Ghost',
    title: 'Haunter of the Line',
    arena: 'courtyard',
    look: { name: 'Ghostlight Clearie', base: '#7fd6ff', swirl: ['#e8fbff'], pattern: 'clearie' },
    profile: p('ghost', 0.007, 0.038, 0.9, 0, true),
    intro: 'Every ring ever drawn... I have played in it.',
    defeat: 'Rub me out, then. I\'ll be drawn again.',
    victory: 'Stay. Haunt with me.',
  },
  {
    id: 'tawking',
    name: 'The Taw King',
    title: 'Lord of All Rings',
    arena: 'courtyard',
    look: { name: 'Crown of Embers', base: '#ffb84d', swirl: ['#ffd23f', '#ff6a00', '#140a02'], pattern: 'galaxy' },
    profile: p('tawking', 0.005, 0.03, 0.96, -0.3, true),
    intro: 'Kneel. Knuckle down. It is the last thing you will do.',
    defeat: 'The crown... rolls to you. Wear it well.',
    victory: 'Back to the schoolyard with you.',
    majority: true,
  },
];

/** Taws on offer: the starters, plus every fighter's marble you have beaten. */
export function availableTaws(progress: StoryProgress): MarbleLook[] {
  const beaten = progress.champion ? LADDER.length : progress.best;
  return [...TAWS, ...LADDER.slice(0, beaten).map((f) => f.look)];
}

const KEY = 'ringer3d.story.v1';

export interface StoryProgress {
  /** Index of the next fighter to face. */
  rung: number;
  /** Highest rung ever reached; gates the Taw King ending replay. */
  best: number;
  champion: boolean;
}

export function loadProgress(): StoryProgress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { rung: 0, best: 0, champion: false, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: start fresh */
  }
  return { rung: 0, best: 0, champion: false };
}

export function saveProgress(p: StoryProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}
