import { hashString } from '../core/rng';
import type { ArenaId } from './arenas';
import type { Difficulty } from './maps';
import type { GuideMode } from './settings';

export interface Fighter {
  id: string;
  /** Marble look id (game/marbles.ts). */
  marble: string;
  name: string;
  title: string;
  bio: string;
  /** Shown on the versus screen when you face them. */
  intro: string;
  /** Said when they beat you. */
  taunt: string;
  /** Said when you beat them. */
  defeat: string;
  homeArena: ArenaId;
  /** Ending text when this fighter conquers the tower. */
  ending: string;
  /** Playable from the start? Others unlock by beating them in the tower. */
  starter: boolean;
}

export const FIGHTERS: Fighter[] = [
  {
    id: 'ember',
    marble: 'ember',
    name: 'Ember',
    title: 'The Playground Prodigy',
    bio: 'Won her first ring at six. Has not lost a recess since. Fire in the glass, fire in the thumb.',
    intro: 'You knuckle down like you mean it. Good. So do I.',
    taunt: 'Keep the marble. Call it a souvenir.',
    defeat: 'Huh. Nobody\'s ever cooled me off before.',
    homeArena: 'culdesac',
    ending:
      'Ember carried the Black Taw home in her pocket and set it on the kerb at the end of her street. Every morning the kids touch it for luck on the way to school. She never takes it down.',
    starter: true,
  },
  {
    id: 'tide',
    marble: 'tide',
    name: 'Tide',
    title: 'The Undertow',
    bio: 'A boardwalk hustler who reads a ring like a swell: wait, wait, then everything at once.',
    intro: 'Every wave looks small until it takes your feet.',
    taunt: 'Washed out. Happens to everyone.',
    defeat: 'The tide always comes back. Remember that.',
    homeArena: 'sand',
    ending:
      'Tide threw the Black Taw into the sea at dawn. Fishermen still swear something dark rolls along the sand at low tide, looking for a ring.',
    starter: true,
  },
  {
    id: 'pip',
    marble: 'pip',
    name: 'Pip',
    title: 'The Clay Kid',
    bio: 'Shoots a hand-rolled clay taw his grandpa made. Not the best. Absolutely the most stubborn.',
    intro: 'Grandpa says clay doesn\'t crack. Let\'s test it!',
    taunt: 'Clay beats glass! I KNEW it!',
    defeat: 'Okay... okay. One more? Best of fifty?',
    homeArena: 'grass',
    ending:
      'Pip pressed a dent of the Black Taw into fresh clay and fired it into a new shooter. It never wins pretty. It never stops winning.',
    starter: true,
  },
  {
    id: 'jade',
    marble: 'jade',
    name: 'Jade',
    title: 'The Still Hand',
    bio: 'Keeper of a garden where the sand is raked each dawn. Believes a perfect shot is one you never rush.',
    intro: 'Breathe out. The marble already knows where it goes.',
    taunt: 'You flicked before you saw. Again tomorrow.',
    defeat: 'Your hand was quieter than your heart. Rare.',
    homeArena: 'grass',
    ending:
      'Jade buried the Black Taw beneath the oldest stone in the garden and raked a ring around it. The sand has never needed raking since.',
    starter: true,
  },
  {
    id: 'volt',
    marble: 'volt',
    name: 'Volt',
    title: 'The Night Shift',
    bio: 'Runs the money games on his bedroom desk. Streams every shot. Has never been off camera, or off tilt.',
    intro: 'Chat says you\'re cooked. Let\'s prove chat right.',
    taunt: 'Clip it. CLIP IT.',
    defeat: 'Stream\'s over. Don\'t... don\'t clip that.',
    homeArena: 'desk',
    ending:
      'Volt broadcast the final shot to eleven million viewers. The Black Taw now spins on a pedestal in a neon case, and his desk has a waiting list a year long.',
    starter: false,
  },
  {
    id: 'rime',
    marble: 'rime',
    name: 'Rime',
    title: 'Queen of Glacier Hall',
    bio: 'Plays only on ice, where a breath too hard sends a marble across the hall. She never breathes too hard.',
    intro: 'On my ice, the timid slide forever.',
    taunt: 'Frozen out. As foretold.',
    defeat: 'Spring arrives early this year, it seems.',
    homeArena: 'ice',
    ending:
      'Rime sealed the Black Taw inside a pillar of blue ice at the heart of Glacier Hall. On still nights you can see it glowing faintly, still trying to roll.',
    starter: false,
  },
  {
    id: 'ironside',
    marble: 'ironside',
    name: 'Ironside',
    title: 'The Steelie',
    bio: 'Ball-bearing taw, foundry-worker hands. Hits like a freight train and apologises after.',
    intro: 'Sorry in advance. It\'s a heavy marble.',
    taunt: 'Told you. Heavy.',
    defeat: 'Good shooting. Honest work.',
    // The gravel yard behind the foundry.
    homeArena: 'gravel',
    ending:
      'Ironside melted the Black Taw into the foundry\'s next pour. Somewhere out there is a bridge that can never quite be crossed by the unworthy.',
    starter: false,
  },
  {
    id: 'nova',
    marble: 'nova',
    name: 'Nova',
    title: 'The Far Shooter',
    bio: 'Nobody knows where she came from. Her marble has stars in it. Real ones, she insists.',
    intro: 'I have played on rings around other suns.',
    taunt: 'Small ring. Small player.',
    defeat: 'Interesting. This planet has teeth.',
    homeArena: 'sand',
    ending:
      'Nova pocketed the Black Taw and pointed at the sky. "That one next," she said. Nobody has seen her since, but there is one more star over the beach now.',
    starter: false,
  },
  {
    id: 'obsidian',
    marble: 'obsidian',
    name: 'Obsidian',
    title: 'The Black Taw',
    bio: 'The first marble ever shot, they say, cut from the black ice of a frozen lake. It has taken every ring it has ever entered. It keeps them.',
    intro: 'Every marble you ever lost... rolled to me.',
    taunt: 'For keeps.',
    defeat: 'Then keep me. If you can.',
    homeArena: 'ice',
    ending: 'Obsidian takes your marble, as it has taken all the others. The lake freezes a little deeper.',
    starter: false,
  },
];

export interface TowerStage {
  opponent: string;
  arena: ArenaId;
  bot: string;
  /** The stage's map: harder the higher you climb, the same course every time you retry. */
  difficulty: Difficulty;
  mapSeed: number;
  /** The most aim guide this floor allows: it shortens, then goes, as you climb. */
  guide: GuideMode;
  /** Games to win to take the floor: 1, or a best-of series. */
  wins: number;
}

const STAGE_GUIDE: GuideMode[] = ['full', 'full', 'full', 'short', 'short', 'short', 'off', 'off'];

/**
 * On ice one break can take half the ring, so a single game there is close to a coin toss
 * whoever the opponent is (measured: a skilled player took an expert and the legend alike
 * about one game in four). Ice floors are played as a series, which lets skill tell:
 * best of three, and best of five against the Black Taw. Ice games are short, so a series
 * runs about as long as one game elsewhere.
 */
const seriesOn = (arena: ArenaId) => (arena === 'ice' ? 2 : 1);

const STAGE_DIFFICULTY: Difficulty[] = ['easy', 'easy', 'medium', 'medium', 'hard', 'hard', 'hard', 'hard'];

/**
 * The tower: seven challengers then the Black Taw. Opponents matching your own fighter are
 * skipped and replaced by the next free fighter, MK-style.
 */
export function buildTower(playerFighter: string): TowerStage[] {
  const order = ['pip', 'tide', 'jade', 'volt', 'ironside', 'rime', 'nova', 'ember'].filter((f) => f !== playerFighter);
  const ladder = order.slice(0, 7);
  // One step up the ladder every floor: no floor repeats the last one's opponent strength.
  const bots = ['rookie', 'novice', 'casual', 'regular', 'skilled', 'expert', 'master'];
  const stages: TowerStage[] = ladder.map((id, i) => {
    const arena = FIGHTERS.find((f) => f.id === id)!.homeArena;
    return {
      opponent: id,
      arena,
      bot: bots[i],
      difficulty: STAGE_DIFFICULTY[i],
      mapSeed: hashString(`tower:${id}:${i}`) % 100000,
      guide: STAGE_GUIDE[i],
      wins: seriesOn(arena),
    };
  });
  stages.push({ opponent: 'obsidian', arena: 'ice', bot: 'legend', difficulty: 'hard', mapSeed: hashString('tower:obsidian') % 100000, guide: STAGE_GUIDE[7], wins: 3 });
  return stages;
}

export function fighter(id: string): Fighter {
  return FIGHTERS.find((f) => f.id === id) ?? FIGHTERS[0];
}
