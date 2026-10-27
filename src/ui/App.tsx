import { useEffect, useRef, useState } from 'react';
import type { PlayerInfo } from '../core/types';
import type { ArenaId } from '../game/arenas';
import type { Difficulty, MapDef } from '../game/maps';
import type { SessionMode, SessionResult } from '../game/session';
import { MARBLES, uiColor } from '../game/marbles';
import { progress, settings, type GuideMode } from '../game/settings';
import { buildTower, fighter } from '../game/story';
import type { OnlineMatchConfig } from '../net/protocol';
import type { OnlineRoom } from '../net/room';
import { sound } from '../render/audio';
import { engine } from './engine';
import { Hud } from './Hud';
import { OnlineHub, RoomLobby } from './online';
import type { MapChoice } from './components';
import { HowTo, LocalPlay, MainMenu, QuickPlay, Results, SettingsScreen, type ResultsInfo } from './screens';
import { Ending, StorySelect, Tower, Versus } from './story';

type ScreenState =
  | { name: 'menu' | 'quick' | 'local' | 'settings' | 'howto' | 'story-select' | 'online' }
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

export function App() {
  const [screen, setScreen] = useState<ScreenState>({ name: 'menu' });
  const roomRef = useRef<OnlineRoom | null>(null);
  const myMarble = settings.use((s) => s.marble);

  // The main menu is a column on the left: slide the live ring into the space beside it.
  useEffect(() => {
    if (engine.view) engine.view.frameShift = screen.name === 'menu' ? 0.2 : 0;
  }, [screen.name]);

  // Every panel is tinted with the player's own marble.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', uiColor(MARBLES[myMarble]));
  }, [myMarble]);

  const toMenu = () => {
    roomRef.current?.leave();
    roomRef.current = null;
    engine.startDemo();
    setScreen({ name: 'menu' });
  };

  const scoresOf = (players: PlayerInfo[], r: SessionResult) =>
    players.map((p, i) => ({ name: p.name, marble: p.marble, score: r.scores[i] ?? 0, winner: r.winners.includes(i) }));

  const recordStats = (r: SessionResult) => {
    if (r.aborted || r.localSeats.length !== 1) return;
    const me = r.localSeats[0];
    progress.set((p) => ({
      stats: {
        played: p.stats.played + 1,
        won: p.stats.won + (r.winners.length === 1 && r.winners[0] === me ? 1 : 0),
        captured: p.stats.captured + (r.scores[me] ?? 0),
      },
    }));
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
        recordStats(r);
        setScreen({ name: 'results', info: a.results(r) });
      },
    });
    setScreen({ name: 'game', online: !!a.room });
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
            secondary: { label: 'Back to the Tower', action: () => { engine.startDemo(st.arena); setScreen({ name: 'tower', fighter: fighterId, stage }); } },
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
              ? { label: 'See the ending', action: () => setScreen({ name: 'ending', fighter: fighterId, unlocked: null }) }
              : { label: 'Next challenger', action: () => setScreen({ name: 'versus', fighter: fighterId, stage: next }) },
            secondary: { label: 'Back to the Tower', action: () => { engine.startDemo(st.arena); setScreen({ name: 'tower', fighter: fighterId, stage: next }); } },
          };
        }
        return {
          title: need > 1 ? `${opp.name} takes the series` : r.winners.length > 1 ? 'Draw — try again' : `${opp.name} wins`,
          sub: need > 1 ? `${bestOf} · ${tally[0]} to ${tally[1]}` : undefined,
          quote: { who: opp.name, marble: opp.marble, text: opp.taunt },
          scores: scoresOf(players, r),
          primary: { label: 'Try again', action: () => storyMatch(fighterId, stage) },
          secondary: { label: 'Back to the Tower', action: () => { engine.startDemo(st.arena); setScreen({ name: 'tower', fighter: fighterId, stage }); } },
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
    setScreen({ name: 'tower', fighter: fighterId, stage });
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
              else setScreen({ name: 'story-select' });
            } else setScreen({ name: s });
          }}
        />
      );
      break;
    case 'quick':
      body = <QuickPlay onBack={toMenu} onStart={quick} />;
      break;
    case 'local':
      body = <LocalPlay onBack={toMenu} onStart={local} />;
      break;
    case 'settings':
      body = <SettingsScreen onBack={toMenu} />;
      break;
    case 'howto':
      body = <HowTo onBack={toMenu} />;
      break;
    case 'story-select':
      body = <StorySelect onBack={toMenu} onChoose={continueStory} />;
      break;
    case 'tower':
      body = (
        <Tower
          fighterId={screen.fighter}
          stage={screen.stage}
          onBack={() => setScreen({ name: 'story-select' })}
          onFight={() => setScreen({ name: 'versus', fighter: screen.fighter, stage: screen.stage })}
        />
      );
      break;
    case 'versus':
      body = <Versus fighterId={screen.fighter} stage={screen.stage} onGo={() => storyMatch(screen.fighter, screen.stage)} />;
      break;
    case 'ending':
      body = <Ending fighterId={screen.fighter} unlockedName={screen.unlocked} onDone={toMenu} />;
      break;
    case 'online':
      body = <OnlineHub onBack={toMenu} onRoom={(room) => setScreen({ name: 'room', room })} />;
      break;
    case 'room':
      body = <RoomLobby room={screen.room} onLeave={toMenu} />;
      break;
    case 'results':
      body = <Results info={screen.info} />;
      break;
    case 'game':
      body = null;
      break;
  }

  return (
    <>
      {screen.name === 'game' && <Hud online={screen.online} onQuit={toMenu} />}
      {body && <div className="overlay">{body}</div>}
    </>
  );
}
