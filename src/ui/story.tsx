import { useState } from 'react';
import { BOT_PROFILES } from '../ai/profiles';
import { ARENAS } from '../game/arenas';
import { progress } from '../game/settings';
import { buildTower, fighter, FIGHTERS } from '../game/story';
import { Marble3D, MarbleChip, Screen, tap } from './components';

export function StorySelect({ onBack, onChoose }: { onBack: () => void; onChoose: (fighterId: string) => void }) {
  const p = progress.use((x) => x);
  const playable = FIGHTERS.filter((f) => f.id !== 'obsidian');
  const [sel, setSel] = useState(p.run?.fighter ?? p.unlocked[0] ?? 'ember');
  const f = fighter(sel);
  const unlocked = p.unlocked.includes(sel);

  return (
    <Screen
      title="Choose your marble"
      onBack={onBack}
      footer={
        <button
          className="btn primary"
          disabled={!unlocked}
          onClick={() => {
            tap();
            onChoose(sel);
          }}
        >
          {p.run?.fighter === sel ? `Continue · stage ${p.run.stage + 1}` : `Climb as ${f.name}`}
        </button>
      }
    >
      <div className="fighter-grid" role="radiogroup" aria-label="Fighters">
        {playable.map((x) => {
          const locked = !p.unlocked.includes(x.id);
          return (
            <button
              key={x.id}
              className="marble-pick"
              aria-pressed={sel === x.id}
              aria-label={locked ? `${x.name}, locked` : x.name}
              onClick={() => {
                tap();
                setSel(x.id);
              }}
            >
              <MarbleChip id={x.marble} size={48} style={locked ? { filter: 'grayscale(1) brightness(0.45)' } : undefined} />
              {locked ? 'Locked' : x.name}
              {p.cleared.includes(x.id) && <span className="pill ok">Cleared</span>}
            </button>
          );
        })}
      </div>
      <div className="fighter-detail">
        {unlocked ? <Marble3D id={f.marble} size={120} /> : <MarbleChip id={f.marble} size={84} style={{ filter: 'grayscale(1) brightness(0.45)' }} />}
        <div>
          <h3>{unlocked ? f.name : '???'}</h3>
          <div className="title">{unlocked ? f.title : 'Beat them in the Tower to unlock'}</div>
          {unlocked && <p>{f.bio}</p>}
        </div>
      </div>
    </Screen>
  );
}

const DIFF_WORD = { easy: 'easy', medium: 'medium', hard: 'hard' } as const;
const GUIDE_WORD = { full: 'full aim guide', short: 'short aim guide', off: 'no aim guide' } as const;

export function Tower({ fighterId, stage, onBack, onFight }: { fighterId: string; stage: number; onBack: () => void; onFight: () => void }) {
  const stages = buildTower(fighterId);
  const me = fighter(fighterId);
  return (
    <Screen
      title={`${me.name}'s climb`}
      onBack={onBack}
      footer={
        <button
          className="btn primary"
          onClick={() => {
            tap();
            onFight();
          }}
        >
          Fight
        </button>
      }
    >
      <div className="tower">
        {stages.map((s, i) => {
          const opp = fighter(s.opponent);
          const boss = s.opponent === 'obsidian';
          return (
            <div key={i} className={`list-item${i === stage ? ' current' : ''}${i < stage ? ' done' : ''}${boss ? ' boss' : ''}`}>
              <span className="num">{i + 1}</span>
              <MarbleChip id={opp.marble} size={38} />
              <span className="grow">
                <b>{i > stage + 1 && boss ? '???' : opp.name}</b>
                <small>
                  {ARENAS[s.arena].name} · {BOT_PROFILES[s.bot].label} · {DIFF_WORD[s.difficulty]} map · {GUIDE_WORD[s.guide]}
                  {s.wins > 1 ? ` · best of ${s.wins * 2 - 1}` : ''}
                </small>
              </span>
              {i < stage && <span className="pill ok">Beaten</span>}
              {i === stage && <span className="pill wait">Next</span>}
            </div>
          );
        })}
      </div>
    </Screen>
  );
}

export function Versus({ fighterId, stage, onGo }: { fighterId: string; stage: number; onGo: () => void }) {
  const s = buildTower(fighterId)[stage];
  const me = fighter(fighterId);
  const opp = fighter(s.opponent);
  return (
    <div
      className="versus"
      role="button"
      tabIndex={0}
      aria-label="Start the match"
      onClick={() => {
        tap();
        onGo();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onGo();
      }}
    >
      <div className="side">
        <Marble3D id={me.marble} size={170} />
        <h3>{me.name}</h3>
        <small style={{ color: 'var(--chalk-dim)' }}>{me.title}</small>
      </div>
      <div className="vs">vs</div>
      <div className="side right">
        <Marble3D id={opp.marble} size={170} />
        <h3>{opp.name}</h3>
        <small style={{ color: 'var(--chalk-dim)' }}>{opp.title}</small>
      </div>
      <p className="quote">“{opp.intro}”</p>
      <p className="arena-name">
        Stage {stage + 1} · {ARENAS[s.arena].name} · {BOT_PROFILES[s.bot].label} · {DIFF_WORD[s.difficulty]} map · {GUIDE_WORD[s.guide]}{s.wins > 1 ? ` · best of ${s.wins * 2 - 1}` : ''} · tap to begin
      </p>
    </div>
  );
}

export function Ending({ fighterId, unlockedName, onDone }: { fighterId: string; unlockedName: string | null; onDone: () => void }) {
  const f = fighter(fighterId);
  return (
    <Screen title={`${f.name} takes the Black Taw`}>
      <MarbleChip id="obsidian" size={72} />
      <p className="ending-text">{f.ending}</p>
      {unlockedName && <div className="notice info">{unlockedName} joined your roster.</div>}
      <button
        className="btn primary"
        onClick={() => {
          tap();
          onDone();
        }}
      >
        Back to the menu
      </button>
    </Screen>
  );
}
