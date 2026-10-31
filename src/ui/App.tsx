import { useEffect, useRef, useState } from 'react';
import type { PlayerInfo } from '../core/types';
import type { ArenaId } from '../game/arenas';
import type { Difficulty, MapDef } from '../game/maps';
import type { SessionMode, SessionResult } from '../game/session';
import { lookFor, uiColor } from '../game/marbles';
import { hud } from '../game/store';
import { rewardMatch } from '../game/wallet';
import { matchEnded, presence } from '../platformFeatures';
import { services } from '../services';
import { Collection, type CollectionTab } from './collection';
import { progress, settings, type GuideMode } from '../game/settings';
import { buildTower, fighter } from '../game/story';
import type { OnlineMatchConfig } from '../net/protocol';
import type { OnlineRoom } from '../net/room';
import { sound } from '../render/audio';
import { engine } from './engine';
import { Hud } from './Hud';
import { goBack, installBack, setBaseBack } from './nav';
import { listenForInviteLinks, listenForSteamInvites, OnlineHub, RoomLobby } from './online';
import type { MapChoice } from './components';
import { HowTo, LocalPlay, MainMenu, QuickPlay, Results, SettingsScreen, type ResultsInfo } from './screens';
import { Ending, StorySelect, Tower, Versus } from './story';
import { Leaderboards } from './social';
import { AchievementToast, Profile } from './profile';
import { BottomNav, TopBar, type Target } from './topbar';

/** Screens that sit under the top bar (everything but the match and the Tower's cut-scenes). */
const BAR_SCREENS = new Set<ScreenState['name']>(['menu', 'quick', 'local', 'settings', 'howto', 'story-select', 'online', 'collection', 'leaderboards', 'profile', 'tower', 'results']);
/** The sections. On a phone they are the bottom tabs; every other screen opens over them. */
const TAB_SCREENS = new Set<ScreenState['name']>(['menu', 'collection', 'profile', 'settings']);

type ScreenState =
  | { name: 'menu' | 'quick' | 'local' | 'settings' | 'howto' | 'story-select' | 'online' | 'leaderboards' | 'profile' }
  | { name: 'collection'; tab?: CollectionTab }
  | { name: 'tower'; fighter: string; stage: number }
  | { name: 'versus'; fighter: string; stage: number }
  | { name: 'ending'; fighter: string; unlocked: string | null }
  | { name: 'room'; room: OnlineRoom }
  | { name: 'game'; online: boolean }
  | { name: 'results'; info: ResultsInfo };

interface PlayArgs {
  mode: SessionMode;
  arena: ArenaId;
  level?: { difficulty: Difficulty; seed: number };
  map?: MapDef;
  guideCap?: GuideMode;
  players: PlayerInfo[];
  localSeats: number[];
  room?: OnlineRoom;
  seed?: number;
  results: (r: SessionResult) => ResultsInfo;
}

const MENU: ScreenState = { name: 'menu' };

export function App() {
  // The back stack: the last screen is the one showing, and back returns to the one under it.
  const [stack, setStack] = useState<ScreenState[]>([MENU]);
  const screen = stack[stack.length - 1];
  const roomRef = useRef<OnlineRoom | null>(null);
  const myMarble = settings.use((s) => s.marble);

  /** Opens a screen over the current one. */
  const push = (s: ScreenState) => setStack((st) => [...st, s]);
  /** Swaps the current screen for another (the results for the match). */
  const replace = (s: ScreenState) => setStack((st) => [...st.slice(0, -1), s]);
  /** A fresh history on top of the home screen. */
  const reset = (...s: ScreenState[]) => setStack([MENU, ...s]);

  // The main menu is a column on the left: slide the live ring into the space beside it.
  useEffect(() => {
    if (engine.view) engine.view.frameShift = screen.name === 'menu' ? 0.2 : 0;
  }, [screen.name]);

  // Presence (what friends see next to your name) and the game-recording mode.
  useEffect(() => {
    const status: Partial<Record<ScreenState['name'], string>> = {
      menu: 'In the menu',
      collection: 'Opening Marble Bags',
      tower: 'Climbing the Tower',
      versus: 'Climbing the Tower',
      online: 'Looking for a game',
      room: 'In a lobby',
      game: screen.name === 'game' && screen.online ? 'Playing online' : 'Playing a match',
    };
    presence(status[screen.name] ?? 'In the menu', {
      group: screen.name === 'room' ? screen.room.state.get().room?.id : undefined,
      mode: screen.name === 'game' ? 'playing' : screen.name === 'room' ? 'lobby' : 'menus',
    });
  }, [screen]);

  // Steam: accepting a friend's invite (or "Join game") drops you into their room.
  useEffect(
    () =>
      listenForSteamInvites((room) => {
        roomRef.current?.leave();
        roomRef.current = room;
        reset({ name: 'online' }, { name: 'room', room });
      }),
    [],
  );

  // An invite link (web, or an Android App Link) drops you into that room; a dead one says why.
  const [linkError, setLinkError] = useState<string | null>(null);
  useEffect(
    () =>
      listenForInviteLinks(
        (room) => {
          roomRef.current?.leave();
          roomRef.current = room;
          setLinkError(null);
          reset({ name: 'online' }, { name: 'room', room });
        },
        (why) => setLinkError(why),
      ),
    [],
  );
  useEffect(() => {
    if (!linkError) return;
    const t = setTimeout(() => setLinkError(null), 6000);
    return () => clearTimeout(t);
  }, [linkError]);

  // Every panel is tinted with the player's own marble.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', uiColor(lookFor(myMarble)));
  }, [myMarble]);

  const leaveRoom = () => {
    roomRef.current?.leave();
    roomRef.current = null;
  };

  const toMenu = () => {
    leaveRoom();
    engine.startDemo();
    reset();
  };

  // ---- Back ------------------------------------------------------------------------------
  /** One step back on the stack. A match handles its own back (the pause menu). */
  const stepBack = (): boolean => {
    const top = stack[stack.length - 1];
    if (top.name === 'game') return true;
    // Back from the results is their second button (Menu, Back to the Tower), else the menu.
    if (top.name === 'results') {
      (top.info.secondary?.action ?? toMenu)();
      return true;
    }
    if (top.name === 'ending') {
      toMenu();
      return true;
    }
    if (stack.length < 2) return false;
    if (top.name === 'room') leaveRoom();
    setStack(stack.slice(0, -1));
    return true;
  };
  setBaseBack(() => stack.length > 1 || screen.name !== 'menu', stepBack);
  useEffect(() => {
    // Esc is the game's own (it cancels a flick) while one is being charged.
    installBack(() => hud.get().active && hud.get().power > 0.02);
  }, []);

  /** A tab's (or top-bar button's) screen. */
  const tabScreen = (t: Target): ScreenState =>
    t === 'shop' || t === 'coins' || t === 'marbles' ? { name: 'collection', tab: t } : t === 'menu' ? MENU : { name: t };

  /** Opens a section: its own history, over the home screen. Leaves a finished match's room. */
  const openTab = (t: Target) => {
    if (screen.name === 'results') {
      leaveRoom();
      engine.startDemo();
    }
    if (t === 'menu') reset();
    else reset(tabScreen(t));
  };

  const scoresOf = (players: PlayerInfo[], r: SessionResult) =>
    players.map((p, i) => ({ name: p.name, marble: p.marble, score: r.scores[i] ?? 0, winner: r.winners.includes(i) }));

  /** Records a finished match; returns the coins it paid, if any. */
  const recordStats = (r: SessionResult, marble?: string): number | undefined => {
    if (r.aborted || r.localSeats.length !== 1) return undefined;
    const me = r.localSeats[0];
    // Every finished match pays coins toward Marble Bags (core/economy.ts); the captures go on
    // the tally of the marble you played (a Steam marble keeps its tally on the Steam item).
    const coins = rewardMatch(r.winners.length === 1 && r.winners[0] === me, r.scores[me] ?? 0, marble);
    if (marble) void services.items?.addTally(marble, r.scores[me] ?? 0);
    matchEnded({
      won: r.winners.length === 1 && r.winners[0] === me,
      myScore: r.scores[me] ?? 0,
      otherScores: r.scores.filter((_, i) => i !== me),
      online: !!roomRef.current,
    });
    const won = r.winners.length === 1 && r.winners[0] === me;
    progress.set((p) => {
      const streak = won ? (p.stats.streak ?? 0) + 1 : 0;
      return {
        stats: {
          played: p.stats.played + 1,
          won: p.stats.won + (won ? 1 : 0),
          captured: p.stats.captured + (r.scores[me] ?? 0),
          streak,
          bestStreak: Math.max(p.stats.bestStreak ?? 0, streak),
        },
      };
    });
    return coins;
  };

  const play = (a: PlayArgs) => {
    sound.unlock();
    engine.run({
      mode: a.mode,
      arena: a.arena,
      level: a.level,
      map: a.map,
      guideCap: a.guideCap,
      players: a.players,
      seed: a.seed ?? ((Math.random() * 2 ** 31) | 0),
      localSeats: a.localSeats,
      net: a.room,
      onEnd: (r) => {
        const me = r.localSeats.length === 1 ? r.localSeats[0] : -1;
        const coins = recordStats(r, a.players[me]?.marble);
        const info = a.results(r);
        replace({ name: 'results', info: coins === undefined ? info : { ...info, reward: { coins, won: r.winners.length === 1 && r.winners[0] === me } } });
        // Playtime drops: Steam decides whether one is due; if one comes, it lands on the results.
        if (coins !== undefined && services.items)
          void services.items?.drop().then((drops) => {
            if (drops.length) setStack((st) => st.map((s) => (s.name === 'results' ? { ...s, info: { ...s.info, drops: drops.map((d) => d.id) } } : s)));
          });
      },
    });
    // A match takes the place of its cut-scene, an earlier match or its results; otherwise it
    // opens over its setup screen.
    setStack((st) => {
      const top = st[st.length - 1].name;
      const g: ScreenState = { name: 'game', online: !!a.room };
      return top === 'versus' || top === 'game' || top === 'results' ? [...st.slice(0, -1), g] : [...st, g];
    });
  };

  // ---- Modes ----------------------------------------------------------------------------
  const quick = (choice: MapChoice, players: PlayerInfo[]) => {
    play({
      mode: 'bot',
      arena: choice.arena,
      level: choice,
      players,
      localSeats: [0],
      results: (r) => ({
        title: r.winners.length > 1 ? 'Draw' : r.winners[0] === 0 ? 'You win' : `${players[1].name} wins`,
        scores: scoresOf(players, r),
        primary: { label: 'Rematch', action: () => quick(choice, players) },
        secondary: { label: 'Menu', action: toMenu },
      }),
    });
  };

  const local = (choice: MapChoice, players: PlayerInfo[]) => {
    play({
      mode: 'local',
      arena: choice.arena,
      level: choice,
      players,
      localSeats: players.map((_, i) => i),
      results: (r) => ({
        title: r.winners.length > 1 ? 'Draw' : `${players[r.winners[0]].name} wins`,
        scores: scoresOf(players, r),
        primary: { label: 'Play again', action: () => local(choice, players) },
        secondary: { label: 'Menu', action: toMenu },
      }),
    });
  };

  /** The Tower at a floor, its field idling behind it; back from there is the menu. */
  const toTower = (fighterId: string, stage: number) => {
    engine.startDemo(buildTower(fighterId)[stage].arena);
    reset({ name: 'tower', fighter: fighterId, stage });
  };

  /** `series`: games won so far by [you, them] on a best-of floor. */
  const storyMatch = (fighterId: string, stage: number, series: [number, number] = [0, 0]) => {
    const st = buildTower(fighterId)[stage];
    const me = fighter(fighterId);
    const opp = fighter(st.opponent);
    const players: PlayerInfo[] = [
      { id: 'me', name: me.name, marble: me.marble, kind: 'human' },
      { id: 'opp', name: opp.name, marble: opp.marble, kind: 'bot', botProfile: st.bot },
    ];
    play({
      mode: 'story',
      arena: st.arena,
      level: { difficulty: st.difficulty, seed: st.mapSeed },
      guideCap: st.guide,
      players,
      localSeats: [0],
      results: (r) => {
        const need = st.wins;
        const tally: [number, number] = [...series];
        if (r.winners.length === 1) tally[r.winners[0] === 0 ? 0 : 1]++;
        const bestOf = `Best of ${need * 2 - 1}`;
        if (need > 1 && tally[0] < need && tally[1] < need) {
          const mine = r.winners.length === 1 && r.winners[0] === 0;
          return {
            title: r.winners.length > 1 ? 'Drawn game' : mine ? 'Game to you' : `Game to ${opp.name}`,
            sub: `${bestOf} · you ${tally[0]}, ${opp.name} ${tally[1]}`,
            scores: scoresOf(players, r),
            primary: { label: 'Next game', action: () => storyMatch(fighterId, stage, tally) },
            secondary: { label: 'Back to the Tower', action: () => toTower(fighterId, stage) },
          };
        }
        const won = need > 1 ? tally[0] >= need : r.winners.length === 1 && r.winners[0] === 0;
        const last = stage === 7;
        if (won) {
          const next = stage + 1;
          const newlyUnlocked = opp.id !== 'obsidian' && !progress.get().unlocked.includes(opp.id) ? opp.name : null;
          progress.set((p) => ({
            run: last ? null : { fighter: fighterId, stage: next },
            best: { ...p.best, [fighterId]: Math.max(p.best[fighterId] ?? 0, next) },
            unlocked: opp.id !== 'obsidian' && !p.unlocked.includes(opp.id) ? [...p.unlocked, opp.id] : p.unlocked,
            cleared: last && !p.cleared.includes(fighterId) ? [...p.cleared, fighterId] : p.cleared,
          }));
          return {
            title: last ? 'The Black Taw falls' : `${opp.name} is beaten`,
            sub: [need > 1 ? `${bestOf} · ${tally[0]} to ${tally[1]}` : '', newlyUnlocked ? `${opp.name} can now be chosen in the Tower.` : ''].filter(Boolean).join(' · ') || undefined,
            quote: { who: opp.name, marble: opp.marble, text: opp.defeat },
            scores: scoresOf(players, r),
            primary: last
              ? {
                  label: 'See the ending',
                  action: () => {
                    engine.startDemo();
                    reset({ name: 'ending', fighter: fighterId, unlocked: null });
                  },
                }
              : { label: 'Next challenger', action: () => reset({ name: 'tower', fighter: fighterId, stage: next }, { name: 'versus', fighter: fighterId, stage: next }) },
            secondary: { label: 'Back to the Tower', action: () => toTower(fighterId, next) },
          };
        }
        return {
          title: need > 1 ? `${opp.name} takes the series` : r.winners.length > 1 ? 'Draw — try again' : `${opp.name} wins`,
          sub: need > 1 ? `${bestOf} · ${tally[0]} to ${tally[1]}` : undefined,
          quote: { who: opp.name, marble: opp.marble, text: opp.taunt },
          scores: scoresOf(players, r),
          primary: { label: 'Try again', action: () => storyMatch(fighterId, stage) },
          secondary: { label: 'Back to the Tower', action: () => toTower(fighterId, stage) },
        };
      },
    });
  };

  const startOnline = (room: OnlineRoom, config: OnlineMatchConfig) => {
    const mySeat = room.mySeat;
    const players: PlayerInfo[] = config.players.map((p, i) => ({
      ...p,
      kind: i === mySeat ? 'human' : p.kind === 'bot' ? 'bot' : 'remote',
    }));
    play({
      mode: 'online',
      arena: config.arena,
      map: config.map,
      players,
      localSeats: [mySeat],
      room,
      seed: config.seed,
      results: (r) => ({
        title: r.aborted ? 'Match ended' : r.winners.length > 1 ? 'Draw' : r.winners[0] === mySeat ? 'You win' : `${players[r.winners[0]].name} wins`,
        sub: r.aborted,
        scores: scoresOf(players, r),
        primary: { label: 'Leave room', action: toMenu },
      }),
    });
  };

  // Online room → game start.
  useEffect(() => {
    if (screen.name !== 'room') return;
    const room = screen.room;
    roomRef.current = room;
    const off = room.onStart((config) => startOnline(room, config));
    return () => {
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const continueStory = (fighterId: string) => {
    const run = progress.get().run;
    const stage = run && run.fighter === fighterId ? run.stage : 0;
    if (!run || run.fighter !== fighterId) progress.set({ run: { fighter: fighterId, stage: 0 } });
    engine.startDemo(buildTower(fighterId)[stage].arena);
    // The Tower takes the place of the fighter choice: back from it is the menu.
    reset({ name: 'tower', fighter: fighterId, stage });
  };

  // ---- Render ---------------------------------------------------------------------------
  let body: React.ReactNode = null;
  switch (screen.name) {
    case 'menu':
      body = (
        <MainMenu
          go={(s) => {
            if (s === 'story') {
              const run = progress.get().run;
              if (run) continueStory(run.fighter);
              else push({ name: 'story-select' });
            } else if (s === 'collection') openTab('shop');
            else push({ name: s });
          }}
        />
      );
      break;
    case 'quick':
      body = <QuickPlay onBack={goBack} onStart={quick} />;
      break;
    case 'local':
      body = <LocalPlay onBack={goBack} onStart={local} />;
      break;
    case 'settings':
      body = <SettingsScreen onBack={goBack} onHowTo={() => push({ name: 'howto' })} />;
      break;
    case 'howto':
      body = <HowTo onBack={goBack} />;
      break;
    case 'collection':
      body = <Collection onBack={goBack} tab={screen.tab} onTab={(t) => replace({ name: 'collection', tab: t })} />;
      break;
    case 'leaderboards':
      body = <Leaderboards onBack={goBack} />;
      break;
    case 'profile':
      body = <Profile onBack={goBack} onLeaderboards={() => push({ name: 'leaderboards' })} />;
      break;
    case 'story-select':
      body = <StorySelect onBack={goBack} onChoose={continueStory} />;
      break;
    case 'tower':
      body = <Tower fighterId={screen.fighter} stage={screen.stage} onBack={goBack} onFight={() => push({ name: 'versus', fighter: screen.fighter, stage: screen.stage })} />;
      break;
    case 'versus':
      body = <Versus fighterId={screen.fighter} stage={screen.stage} onGo={() => storyMatch(screen.fighter, screen.stage)} />;
      break;
    case 'ending':
      body = <Ending fighterId={screen.fighter} unlockedName={screen.unlocked} onDone={toMenu} />;
      break;
    case 'online':
      body = <OnlineHub onBack={goBack} onRoom={(room) => push({ name: 'room', room })} />;
      break;
    case 'room':
      body = (
        <RoomLobby
          room={screen.room}
          onLeave={() => {
            leaveRoom();
            setStack((st) => st.slice(0, -1));
          }}
        />
      );
      break;
    case 'results':
      body = <Results info={screen.info} onCollection={() => openTab('marbles')} />;
      break;
    case 'game':
      body = null;
      break;
  }

  const tab: Target | null = !TAB_SCREENS.has(screen.name)
    ? null
    : screen.name === 'collection'
    ? screen.tab === 'marbles'
      ? 'marbles'
      : 'shop'
    : screen.name === 'menu'
    ? 'menu'
    : (screen.name as 'profile' | 'settings');

  return (
    <>
      {screen.name === 'game' && <Hud online={screen.online} onQuit={toMenu} />}
      <AchievementToast />
      {linkError && (
        <div className="ach-toast link-error" role="alert">
          <span>{linkError}</span>
        </div>
      )}
      {body && (
        <div className={`overlay${BAR_SCREENS.has(screen.name) ? ' has-bar' : ''}${tab ? ' is-tab' : ' is-pushed'}`} data-screen={screen.name}>
          {BAR_SCREENS.has(screen.name) && <TopBar on={screen.name} go={openTab} />}
          {body}
          {tab && <BottomNav on={tab} go={openTab} />}
        </div>
      )}
    </>
  );
}
