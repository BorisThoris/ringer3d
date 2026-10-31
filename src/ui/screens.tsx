import { useEffect, useState, type CSSProperties } from 'react';
import { ECONOMY, playerLevel } from '../core/economy';
import type { PlayerInfo } from '../core/types';
import { BOT_PROFILES } from '../ai/profiles';
import { randomSeed } from '../game/maps';
import { lookFor, MARBLES, uiColor } from '../game/marbles';
import { wallet } from '../game/wallet';
import { useItems } from './useItems';
import { progress, settings, type GuideMode } from '../game/settings';
import { fighter, FIGHTERS } from '../game/story';
import type { Quality } from '../render/marbleMesh';
import { ARENAS } from '../game/arenas';
import { groundSwatch } from '../render/groundArt';
import { Chips, Confirm, MapPicker, mapLabel, Marble3D, MarbleChip, MarblePicker, PickRow, Screen, Sheet, tap, type MapChoice } from './components';

export const PLAYABLE_MARBLES = Object.keys(MARBLES).filter((m) => m !== 'mib' && m !== 'obsidian');

/** The named marbles plus every generated one you own, newest first. */
function usePlayable(): string[] {
  const owned = wallet.use((w) => w.owned);
  const onSteam = useItems().marbles;
  return [...onSteam.map((m) => m.id), ...owned.map((o) => o.id).reverse(), ...PLAYABLE_MARBLES];
}

/** The title, one marble colour per letter (Ember, sunshine, Jade, Tide, Nova, Volt). */
const LOGO: [string, string][] = [
  ['R', '#ff5a2a'],
  ['i', '#ffd23f'],
  ['n', '#14c06c'],
  ['g', '#1a7cff'],
  ['e', '#8b5cff'],
  ['r', '#00d8ff'],
];

export function MainMenu({ go }: { go: (s: 'story' | 'quick' | 'local' | 'online' | 'settings' | 'howto' | 'collection' | 'leaderboards') => void }) {
  const run = progress.use((p) => p.run);
  const items: { id: 'story' | 'quick' | 'local' | 'online'; title: string; sub: string; marble: string; hero?: boolean }[] = [
    { id: 'story', title: 'Tower', sub: run ? `Continue as ${fighter(run.fighter).name}, stage ${run.stage + 1} of 8` : 'Eight rings. One Black Taw.', marble: 'obsidian', hero: true },
    { id: 'quick', title: 'Quick match', sub: 'You against a bot, any field', marble: 'ember' },
    { id: 'online', title: 'Online', sub: 'Browse rooms or join with a code', marble: 'volt' },
    { id: 'local', title: 'Pass and play', sub: '2–4 players on this device', marble: 'tide' },
  ];
  return (
    <div className="menu">
      <h1 className="logo" aria-label="Ringer">
        {LOGO.map(([ch, colour], i) => (
          <span key={i} className="l" aria-hidden style={{ '--i': i, '--lc': colour } as CSSProperties}>
            {ch}
          </span>
        ))}
        <small>Knuckle down. Knock 'em out. Keep what you win.</small>
      </h1>
      {items.map((it, i) => (
        <button
          key={it.id}
          className={`menu-card${it.hero ? ' hero' : ''}`}
          style={
            {
              '--c': uiColor(lookFor(it.marble)),
              '--sheen': `${1.2 + i * 1.4}s`,
              animation: `sheet-in 520ms ${260 + i * 90}ms both cubic-bezier(0.34, 1.56, 0.64, 1)`,
            } as CSSProperties
          }
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
            go('leaderboards');
          }}
        >
          Leaderboards
        </button>
      </div>
    </div>
  );
}

const BOT_SKILLS = ['rookie', 'novice', 'casual', 'regular', 'skilled', 'expert', 'master', 'legend'] as const;

/** The shooter you play: a row on a setup screen, with the whole collection in its sheet. */
export function ShooterRow({ label = 'Your shooter', value, onChange }: { label?: string; value: string; onChange: (m: string) => void }) {
  const playable = usePlayable();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PickRow label={label} value={lookFor(value).name} icon={<MarbleChip id={value} size={40} />} onClick={() => setOpen(true)} />
      {open && (
        <Sheet
          title={label}
          onClose={() => setOpen(false)}
          footer={
            <button className="btn primary" onClick={() => setOpen(false)}>
              Done
            </button>
          }
        >
          <div className="taw-preview">
            <Marble3D id={value} size={150} />
          </div>
          <MarblePicker value={value} onChange={onChange} options={playable} />
        </Sheet>
      )}
    </>
  );
}

/** Field, difficulty and map: a row on a setup screen, the full picker in its sheet. */
export function MapRow({ value, onChange }: { value: MapChoice; onChange: (v: MapChoice) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PickRow
        label="Field & map"
        value={mapLabel(value)}
        icon={<span className="field-swatch" style={{ background: `center / cover url(${groundSwatch(value.arena)}), ${ARENAS[value.arena].groundColor}` }} />}
        onClick={() => setOpen(true)}
      />
      {open && (
        <Sheet
          title="Field & map"
          onClose={() => setOpen(false)}
          footer={
            <button className="btn primary" onClick={() => setOpen(false)}>
              Done
            </button>
          }
        >
          <MapPicker value={value} onChange={onChange} />
        </Sheet>
      )}
    </>
  );
}

export function QuickPlay({ onBack, onStart }: { onBack: () => void; onStart: (map: MapChoice, players: PlayerInfo[]) => void }) {
  const st = settings.use((s) => s);
  const [map, setMap] = useState<MapChoice>(() => ({ arena: 'culdesac', difficulty: 'medium', seed: randomSeed() }));
  const [diff, setDiff] = useState<(typeof BOT_SKILLS)[number]>('casual');
  const [opp, setOpp] = useState('tide');
  const [sheet, setSheet] = useState<'opp' | null>(null);
  const oppOptions = FIGHTERS.filter((f) => f.marble !== st.marble).map((f) => f.id);
  const f = fighter(opp);

  return (
    <Screen
      title="Quick match"
      onBack={onBack}
      footer={
        <button
          className="btn primary"
          onClick={() => {
            tap();
            onStart(map, [
              { id: 'me', name: st.playerName, marble: st.marble, kind: 'human' },
              { id: 'bot', name: f.name, marble: f.marble, kind: 'bot', botProfile: diff },
            ]);
          }}
        >
          Play
        </button>
      }
    >
      <div className="pick-list">
        <PickRow label="Opponent" value={`${f.name} · ${BOT_PROFILES[diff].label}`} icon={<MarbleChip id={f.marble} size={40} />} onClick={() => setSheet('opp')} />
        <MapRow value={map} onChange={setMap} />
        <ShooterRow value={st.marble} onChange={(m) => settings.set({ marble: m })} />
      </div>
      <p className="fine">Bots see only what you see and flick with a shaky thumb like anyone else. Higher skill means a steadier hand and better planning.</p>
      {sheet === 'opp' && (
        <Sheet
          title="Opponent"
          onClose={() => setSheet(null)}
          footer={
            <button className="btn primary" onClick={() => setSheet(null)}>
              Done
            </button>
          }
        >
          <div className="chips">
            {oppOptions.map((id) => {
              const o = fighter(id);
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
                  <MarbleChip id={o.marble} size={22} /> {o.name}
                </button>
              );
            })}
          </div>
          <div className="section-title">Skill</div>
          <Chips label="Bot skill" value={diff} options={BOT_SKILLS.map((d) => ({ id: d, label: BOT_PROFILES[d].label }))} onChange={setDiff} />
        </Sheet>
      )}
    </Screen>
  );
}

export function LocalPlay({ onBack, onStart }: { onBack: () => void; onStart: (map: MapChoice, players: PlayerInfo[]) => void }) {
  const st = settings.get();
  const [map, setMap] = useState<MapChoice>(() => ({ arena: 'culdesac', difficulty: 'medium', seed: randomSeed() }));
  const [players, setPlayers] = useState<{ name: string; marble: string }[]>([
    { name: st.playerName, marble: st.marble },
    { name: 'Player 2', marble: st.marble === 'tide' ? 'ember' : 'tide' },
  ]);
  const [picking, setPicking] = useState<number | null>(null);
  const update = (i: number, p: Partial<{ name: string; marble: string }>) => setPlayers((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <Screen
      title="Pass and play"
      onBack={onBack}
      footer={
        <button
          className="btn primary"
          onClick={() => {
            tap();
            onStart(
              map,
              players.map((p, i) => ({ id: `p${i}`, name: p.name.trim() || `Player ${i + 1}`, marble: p.marble, kind: 'human' })),
            );
          }}
        >
          Play
        </button>
      }
    >
      <p className="fine">Take turns on one device. The camera swings to whoever is up.</p>
      <div className="pick-list">
        {players.map((p, i) => (
          <div key={i} className="player-row">
            <button className="marble-btn" aria-label={`Player ${i + 1}'s marble: ${lookFor(p.marble).name}`} onClick={() => setPicking(i)}>
              <MarbleChip id={p.marble} size={40} />
            </button>
            <label className="field grow">
              <span className="hint">Player {i + 1}</span>
              <input value={p.name} maxLength={14} enterKeyHint="done" autoComplete="off" onChange={(e) => update(i, { name: e.target.value })} />
            </label>
            {players.length > 2 && (
              <button className="btn icon ghost" aria-label={`Remove player ${i + 1}`} onClick={() => setPlayers((ps) => ps.filter((_, j) => j !== i))}>
                ✕
              </button>
            )}
          </div>
        ))}
        {players.length < 4 && (
          <button
            className="pick-row add"
            onClick={() => {
              tap();
              setPlayers((ps) => [...ps, { name: `Player ${ps.length + 1}`, marble: PLAYABLE_MARBLES[(ps.length * 2) % PLAYABLE_MARBLES.length] }]);
            }}
          >
            <span className="pick-icon">+</span>
            <span className="pick-text">
              <b>Add a player</b>
            </span>
          </button>
        )}
        <MapRow value={map} onChange={setMap} />
      </div>
      {picking !== null && (
        <Sheet
          title={`${players[picking].name.trim() || `Player ${picking + 1}`}'s marble`}
          onClose={() => setPicking(null)}
          footer={
            <button className="btn primary" onClick={() => setPicking(null)}>
              Done
            </button>
          }
        >
          <MarblePicker value={players[picking].marble} onChange={(m) => update(picking, { marble: m })} options={PLAYABLE_MARBLES} />
        </Sheet>
      )}
    </Screen>
  );
}

export function SettingsScreen({ onBack, onHowTo }: { onBack: () => void; onHowTo?: () => void }) {
  const s = settings.use((x) => x);
  const [resetting, setResetting] = useState(false);
  return (
    <Screen title="Settings" onBack={onBack}>
      <label className="field">
        Your name
        <input value={s.playerName} maxLength={14} enterKeyHint="done" autoComplete="off" onChange={(e) => settings.set({ playerName: e.target.value })} />
      </label>
      <div className="pick-list">
        <ShooterRow label="Shooter" value={s.marble} onChange={(m) => settings.set({ marble: m })} />
        {onHowTo && <PickRow label="New to Ringer?" value="How to play" icon={<span className="pick-glyph">?</span>} onClick={onHowTo} />}
      </div>
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
      <div className="section-title">Sound &amp; feel</div>
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
      <label className="switch-row">
        <span>Vibration</span>
        <input type="checkbox" role="switch" checked={s.haptics} onChange={() => settings.set({ haptics: !s.haptics })} />
      </label>
      <div className="section-title">Online connection</div>
      <Chips<'p2p' | 'server' | 'steam'>
        label="Online connection"
        value={s.netMode}
        options={[
          ...(window.steam ? [{ id: 'steam' as const, label: 'Steam' }] : []),
          { id: 'p2p', label: 'Peer to peer' },
          { id: 'server', label: 'Lobby server' },
        ]}
        onChange={(m) => settings.set({ netMode: m })}
      />
      <p className="fine">
        {s.netMode === 'steam'
          ? 'Steam lobbies and Steam networking: invite friends from Steam, play through Valve\'s relays. Steam players meet Steam players.'
          : s.netMode === 'p2p'
          ? 'No server needed: games are found through public relays and matches run directly between devices.'
          : 'Uses your own Ringer lobby server, which can also relay games for players on very strict networks.'}
      </p>
      {s.netMode === 'server' && (
        <label className="field">
          Lobby server
          <input value={s.lobbyUrl} inputMode="url" autoComplete="off" onChange={(e) => settings.set({ lobbyUrl: e.target.value.trim() })} spellCheck={false} />
          <span className="hint">Used for the server browser and to connect players. Matches themselves run peer to peer.</span>
        </label>
      )}
      <button className="btn danger small" onClick={() => setResetting(true)}>
        Reset Tower progress
      </button>
      {resetting && (
        <Confirm
          title="Reset the Tower?"
          text="Your climb, cleared fighters and unlocked fighters start over. Coins and marbles stay."
          yes="Reset"
          danger
          onNo={() => setResetting(false)}
          onYes={() => {
            progress.set({ unlocked: ['ember', 'tide', 'pip', 'jade'], cleared: [], best: {}, run: null });
            setResetting(false);
          }}
        />
      )}
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
  /** What this match paid the player (single-player and online matches). */
  reward?: { coins: number; won: boolean };
  /** Marbles Steam dropped after this match (playtime drops). */
  drops?: string[];
}

/** Counts up to `to` over ~0.9 s, so a reward lands rather than just appears. */
function useCountUp(to: number, delay = 450): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now() + delay;
    const step = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / 900));
      setN(Math.round(to * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, delay]);
  return n;
}

export function Results({ info, onCollection }: { info: ResultsInfo; onCollection?: () => void }) {
  const coins = wallet.use((w) => w.coins);
  const stats = progress.use((p) => p.stats);
  const shown = useCountUp(info.reward?.coins ?? 0);
  const lv = playerLevel(stats);
  const outcome = info.reward ? (info.reward.won ? 'win' : 'loss') : info.scores.some((s) => s.winner) ? 'win' : 'draw';
  return (
    <div className={`sheet screen results ${outcome}`} style={{ marginTop: 'auto', marginBottom: 'auto' }}>
      <div className="result-banner">
        <h2>{info.title}</h2>
      </div>
      {info.sub && <p className="lede">{info.sub}</p>}
      {info.reward && (
        <div className="reward" aria-label={`You earned ${info.reward.coins} coins`}>
          <span className="coin big" aria-hidden />
          <b className="gain">+{shown}</b>
          <span className="reward-meta">
            <small>coins earned</small>
            <span className="xp" style={{ '--p': lv.into / lv.need } as CSSProperties} aria-label={`Level ${lv.level}: ${lv.into} of ${lv.need} XP`}>
              <i />
            </span>
            <small>
              Level {lv.level} · {lv.into}/{lv.need} XP
            </small>
          </span>
        </div>
      )}
      {info.drops?.map((id) => (
        <div key={id} className="drop" aria-live="polite">
          <MarbleChip id={id} size={52} />
          <span>
            <small>Steam drop!</small>
            <b>{lookFor(id).name}</b>
          </span>
        </div>
      ))}
      {info.reward && onCollection && coins >= ECONOMY.bagPrice && (
        <button
          className="btn bag-nudge"
          onClick={() => {
            tap();
            onCollection();
          }}
        >
          <span className="bag small" aria-hidden />
          <span>
            <b>Open a Marble Bag</b>
            <small>{coins.toLocaleString()} coins: enough for {Math.floor(coins / ECONOMY.bagPrice)}</small>
          </span>
        </button>
      )}
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
