import { useState } from 'react';
import type { PlayerInfo } from '../core/types';
import { BOT_PROFILES } from '../ai/profiles';
import type { ArenaId } from '../game/arenas';
import { MARBLES } from '../game/marbles';
import { progress, settings, type GuideMode } from '../game/settings';
import { fighter, FIGHTERS } from '../game/story';
import type { Quality } from '../render/marbleMesh';
import { ArenaPicker, Chips, Marble3D, MarbleChip, MarblePicker, Screen, tap } from './components';

export const PLAYABLE_MARBLES = Object.keys(MARBLES).filter((m) => m !== 'mib' && m !== 'obsidian');

export function MainMenu({ go }: { go: (s: 'story' | 'quick' | 'local' | 'online' | 'settings' | 'howto') => void }) {
  const run = progress.use((p) => p.run);
  const items: { id: 'story' | 'quick' | 'local' | 'online'; title: string; sub: string; marble: string; hero?: boolean }[] = [
    { id: 'story', title: 'Tower', sub: run ? `Continue as ${fighter(run.fighter).name}, stage ${run.stage + 1} of 8` : 'Eight rings. One Black Taw.', marble: 'obsidian', hero: true },
    { id: 'quick', title: 'Quick match', sub: 'You against a bot, any field', marble: 'ember' },
    { id: 'online', title: 'Online', sub: 'Browse rooms or join with a code', marble: 'volt' },
    { id: 'local', title: 'Pass and play', sub: '2–4 players on this device', marble: 'tide' },
  ];
  return (
    <div className="menu">
      <h1 className="logo title-in">
        Ringer
        <small>Knuckle down. Knock them out. Keep what you win.</small>
      </h1>
      {items.map((it, i) => (
        <button
          key={it.id}
          className={`menu-card${it.hero ? ' hero' : ''}`}
          style={{ animation: `sheet-in 380ms ${80 + i * 60}ms both cubic-bezier(0.2,0.9,0.3,1.1)` }}
          onClick={() => {
            tap();
            go(it.id);
          }}
        >
          <MarbleChip id={it.marble} size={48} />
          <span>
            <h3>{it.title}</h3>
            <p>{it.sub}</p>
          </span>
          <span className="chev">›</span>
        </button>
      ))}
      <div className="menu-foot">
        <button
          className="btn small ghost"
          onClick={() => {
            tap();
            go('howto');
          }}
        >
          How to play
        </button>
        <button
          className="btn small ghost"
          onClick={() => {
            tap();
            go('settings');
          }}
        >
          Settings
        </button>
      </div>
    </div>
  );
}

const DIFFICULTIES = ['rookie', 'casual', 'skilled', 'expert', 'master', 'legend'] as const;

export function QuickPlay({ onBack, onStart }: { onBack: () => void; onStart: (arena: ArenaId, players: PlayerInfo[]) => void }) {
  const st = settings.use((s) => s);
  const [arena, setArena] = useState<ArenaId>('schoolyard');
  const [diff, setDiff] = useState<(typeof DIFFICULTIES)[number]>('casual');
  const [opp, setOpp] = useState('tide');
  const oppOptions = FIGHTERS.filter((f) => f.marble !== st.marble).map((f) => f.id);

  return (
    <Screen title="Quick match" onBack={onBack}>
      <div className="section-title">Opponent</div>
      <div className="chips">
        {oppOptions.map((id) => {
          const f = fighter(id);
          return (
            <button
              key={id}
              className="chip"
              aria-pressed={opp === id}
              onClick={() => {
                tap();
                setOpp(id);
              }}
            >
              <MarbleChip id={f.marble} size={22} /> {f.name}
            </button>
          );
        })}
      </div>
      <div className="section-title">Bot skill</div>
      <Chips label="Bot skill" value={diff} options={DIFFICULTIES.map((d) => ({ id: d, label: BOT_PROFILES[d].label }))} onChange={setDiff} />
      <p className="lede" style={{ margin: 0 }}>
        Bots see only what you see and flick with a shaky thumb like anyone else. Higher skill means a steadier hand and better planning.
      </p>
      <div className="section-title">Field</div>
      <ArenaPicker value={arena} onChange={setArena} />
      <div className="section-title">Your shooter</div>
      <div className="taw-preview">
        <Marble3D id={st.marble} size={150} />
      </div>
      <MarblePicker value={st.marble} onChange={(m) => settings.set({ marble: m })} options={PLAYABLE_MARBLES} />
      <button
        className="btn primary"
        onClick={() => {
          tap();
          const f = fighter(opp);
          onStart(arena, [
            { id: 'me', name: st.playerName, marble: st.marble, kind: 'human' },
            { id: 'bot', name: f.name, marble: f.marble, kind: 'bot', botProfile: diff },
          ]);
        }}
      >
        Play
      </button>
    </Screen>
  );
}

export function LocalPlay({ onBack, onStart }: { onBack: () => void; onStart: (arena: ArenaId, players: PlayerInfo[]) => void }) {
  const st = settings.get();
  const [arena, setArena] = useState<ArenaId>('schoolyard');
  const [players, setPlayers] = useState<{ name: string; marble: string }[]>([
    { name: st.playerName, marble: st.marble },
    { name: 'Player 2', marble: st.marble === 'tide' ? 'ember' : 'tide' },
  ]);
  const update = (i: number, p: Partial<{ name: string; marble: string }>) => setPlayers((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <Screen title="Pass and play" onBack={onBack}>
      <p className="lede">Take turns on one device. The camera swings to whoever is up.</p>
      <div className="list">
        {players.map((p, i) => (
          <div key={i} className="list-item" style={{ flexWrap: 'wrap' }}>
            <MarbleChip id={p.marble} size={40} />
            <label className="field grow">
              <span className="hint">Player {i + 1}</span>
              <input value={p.name} maxLength={14} onChange={(e) => update(i, { name: e.target.value })} />
            </label>
            {players.length > 2 && (
              <button className="btn icon ghost" aria-label={`Remove player ${i + 1}`} onClick={() => setPlayers((ps) => ps.filter((_, j) => j !== i))}>
                ✕
              </button>
            )}
            <div style={{ width: '100%' }}>
              <div className="chips">
                {PLAYABLE_MARBLES.map((m) => (
                  <button key={m} className="chip" aria-pressed={p.marble === m} aria-label={MARBLES[m].name} onClick={() => update(i, { marble: m })} style={{ padding: 6, minHeight: 40 }}>
                    <MarbleChip id={m} size={26} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      {players.length < 4 && (
        <button
          className="btn"
          onClick={() => {
            tap();
            setPlayers((ps) => [...ps, { name: `Player ${ps.length + 1}`, marble: PLAYABLE_MARBLES[(ps.length * 2) % PLAYABLE_MARBLES.length] }]);
          }}
        >
          Add player
        </button>
      )}
      <div className="section-title">Field</div>
      <ArenaPicker value={arena} onChange={setArena} />
      <button
        className="btn primary"
        onClick={() => {
          tap();
          onStart(
            arena,
            players.map((p, i) => ({ id: `p${i}`, name: p.name.trim() || `Player ${i + 1}`, marble: p.marble, kind: 'human' })),
          );
        }}
      >
        Play
      </button>
    </Screen>
  );
}

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const s = settings.use((x) => x);
  return (
    <Screen title="Settings" onBack={onBack}>
      <label className="field">
        Your name
        <input value={s.playerName} maxLength={14} onChange={(e) => settings.set({ playerName: e.target.value })} />
      </label>
      <div className="section-title">Shooter</div>
      <div className="taw-preview">
        <Marble3D id={s.marble} size={150} />
      </div>
      <MarblePicker value={s.marble} onChange={(m) => settings.set({ marble: m })} options={PLAYABLE_MARBLES} />
      <div className="section-title">Aim guide</div>
      <Chips<GuideMode>
        label="Aim guide"
        value={s.guide}
        options={[
          { id: 'full', label: 'Full' },
          { id: 'short', label: 'Short' },
          { id: 'off', label: 'Off' },
        ]}
        onChange={(g) => settings.set({ guide: g })}
      />
      <div className="section-title">Graphics</div>
      <Chips<Quality>
        label="Graphics quality"
        value={s.quality}
        options={[
          { id: 'low', label: 'Battery saver' },
          { id: 'medium', label: 'Balanced' },
          { id: 'high', label: 'Best' },
        ]}
        onChange={(q) => settings.set({ quality: q })}
      />
      <label className="field">
        Effects volume
        <input type="range" min={0} max={1} step={0.05} value={s.sfx} onChange={(e) => settings.set({ sfx: +e.target.value })} />
      </label>
      <label className="field">
        Music volume
        <input type="range" min={0} max={1} step={0.05} value={s.music} onChange={(e) => settings.set({ music: +e.target.value })} />
      </label>
      <label className="field">
        Aim sensitivity
        <input type="range" min={0.4} max={2} step={0.05} value={s.aimSensitivity} onChange={(e) => settings.set({ aimSensitivity: +e.target.value })} />
      </label>
      <div className="chips">
        <button className="chip" aria-pressed={s.haptics} onClick={() => settings.set({ haptics: !s.haptics })}>
          Vibration {s.haptics ? 'on' : 'off'}
        </button>
      </div>
      <div className="section-title">Online connection</div>
      <Chips<'p2p' | 'server'>
        label="Online connection"
        value={s.netMode}
        options={[
          { id: 'p2p', label: 'Peer to peer' },
          { id: 'server', label: 'Lobby server' },
        ]}
        onChange={(m) => settings.set({ netMode: m })}
      />
      <p className="lede" style={{ margin: 0 }}>
        {s.netMode === 'p2p'
          ? 'No server needed: games are found through public relays and matches run directly between devices.'
          : 'Uses your own Ringer lobby server, which can also relay games for players on very strict networks.'}
      </p>
      {s.netMode === 'server' && (
      <label className="field">
        Lobby server
        <input value={s.lobbyUrl} onChange={(e) => settings.set({ lobbyUrl: e.target.value.trim() })} spellCheck={false} />
        <span className="hint">Used for the server browser and to connect players. Matches themselves run peer to peer.</span>
      </label>
      )}
      <button
        className="btn danger small"
        onClick={() => {
          if (confirm('Reset Tower progress and unlocked fighters?')) {
            progress.set({ unlocked: ['ember', 'tide', 'pip', 'jade'], cleared: [], best: {}, run: null });
          }
        }}
      >
        Reset Tower progress
      </button>
    </Screen>
  );
}

export function HowTo({ onBack }: { onBack: () => void }) {
  const steps = [
    ['Knuckle down', 'Your first shot of each turn starts anywhere on the ring line. Drag your shooter to slide it around.'],
    ['Aim', 'Drag anywhere on the screen. Slow drags make tiny adjustments. Tap the camera button for a top view.'],
    ['Flick', 'Pull the power slider down and let go. Add backspin to make your shooter stop near the hit, or topspin to follow through.'],
    ['Keep them', 'Every marble you knock fully out of the ring is yours.'],
    ['Shoot again', 'If you knocked one out and your shooter stayed inside, shoot again from where it stopped. Miss, or roll out, and the turn passes.'],
    ['Win', 'Most marbles when the ring is empty wins. The game ends early once nobody can catch the leader.'],
  ];
  return (
    <Screen title="How to play" onBack={onBack}>
      <ol className="list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {steps.map(([t, d], i) => (
          <li key={t} className="list-item" style={{ alignItems: 'flex-start' }}>
            <span className="pill">{i + 1}</span>
            <span className="grow">
              <b>{t}</b>
              <small style={{ fontSize: 'var(--t-sm)', lineHeight: 1.5 }}>{d}</small>
            </span>
          </li>
        ))}
      </ol>
      <p className="lede" style={{ margin: 0 }}>
        Keyboard: ←/→ aim (Shift for fine), A/D slide along the ring, hold Space to charge and release to flick, Q/E spin, T camera.
      </p>
    </Screen>
  );
}

export interface ResultsInfo {
  title: string;
  sub?: string;
  quote?: { who: string; marble: string; text: string };
  scores: { name: string; marble: string; score: number; winner: boolean }[];
  primary: { label: string; action: () => void };
  secondary?: { label: string; action: () => void };
}

export function Results({ info }: { info: ResultsInfo }) {
  return (
    <div className="sheet screen" style={{ marginTop: 'auto', marginBottom: 'auto' }}>
      <div className="screen-head">
        <h2>{info.title}</h2>
      </div>
      {info.sub && <p className="lede">{info.sub}</p>}
      {info.quote && (
        <div className="list-item">
          <MarbleChip id={info.quote.marble} size={44} />
          <span className="grow">
            <b>{info.quote.who}</b>
            <small style={{ fontSize: 'var(--t-md)' }}>“{info.quote.text}”</small>
          </span>
        </div>
      )}
      <div className="list">
        {info.scores.map((s, i) => (
          <div key={i} className="list-item">
            <MarbleChip id={s.marble} size={32} />
            <span className="grow">
              <b>{s.name}</b>
            </span>
            {s.winner && <span className="pill ok">Winner</span>}
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--t-xl)' }}>{s.score}</span>
          </div>
        ))}
      </div>
      <button
        className="btn primary"
        onClick={() => {
          tap();
          info.primary.action();
        }}
      >
        {info.primary.label}
      </button>
      {info.secondary && (
        <button
          className="btn"
          onClick={() => {
            tap();
            info.secondary!.action();
          }}
        >
          {info.secondary.label}
        </button>
      )}
    </div>
  );
}
