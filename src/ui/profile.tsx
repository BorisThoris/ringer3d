import { useEffect, type CSSProperties } from 'react';
import { collectibleFromId, type Collectible } from '../core/collectible';
import { meltValue, playerLevel } from '../core/economy';
import { lookFor } from '../game/marbles';
import { progress, settings } from '../game/settings';
import { wallet } from '../game/wallet';
import { achieved, achievementShown } from '../platformFeatures';
import { sound } from '../render/audio';
import { ACHIEVEMENTS, type AchievementId } from '../services';
import { MarbleChip, PickRow, Screen } from './components';
import { useItems } from './useItems';

/** Progress toward the countable achievements: [have, need]. */
function progressOf(id: AchievementId, n: { owned: number; daily: number; streak: number }): [number, number] | null {
  if (id === 'COLLECTOR_25') return [n.owned, 25];
  if (id === 'DAILY_7') return [n.daily, 7];
  if (id === 'STREAK_5') return [n.streak, 5];
  return null;
}

/** Who you are in Ringer: level, lifetime record and every achievement, earned or not. */
export function Profile({ onBack, onLeaderboards }: { onBack: () => void; onLeaderboards?: () => void }) {
  const name = settings.use((s) => s.playerName);
  const marble = settings.use((s) => s.marble);
  const p = progress.use((s) => s);
  const w = wallet.use((s) => s);
  const held = useItems().marbles;
  const have = achieved.use((a) => a.list);
  const lv = playerLevel(p.stats);
  const owned = [...w.owned.map((o) => collectibleFromId(o.id)).filter((c): c is Collectible => !!c), ...held];
  const value = owned.reduce((a, c) => a + meltValue(c), 0);
  const floors = Math.max(0, ...Object.values(p.best));
  const rate = p.stats.played ? Math.round((p.stats.won / p.stats.played) * 100) : 0;
  const ids = Object.keys(ACHIEVEMENTS) as AchievementId[];
  const count = { owned: owned.length, daily: w.streak, streak: p.stats.bestStreak ?? 0 };

  const record: [string, string][] = [
    ['Matches', p.stats.played.toLocaleString()],
    ['Wins', p.stats.won.toLocaleString()],
    ['Win rate', p.stats.played ? `${rate}%` : '–'],
    ['Best streak', String(p.stats.bestStreak ?? 0)],
    ['Captured', p.stats.captured.toLocaleString()],
    ['Tower', p.cleared.length ? `Cleared ×${p.cleared.length}` : `Floor ${floors}/8`],
    ['Marbles', owned.length.toLocaleString()],
    ['Collection', `${value.toLocaleString()} ¢`],
  ];

  return (
    <Screen title="Profile" onBack={onBack}>
      <div className="me-card">
        <MarbleChip id={marble} size={72} />
        <div className="grow">
          <b className="me-name">{name}</b>
          <span className="fine">
            Level {lv.level} · plays {lookFor(marble).name}
          </span>
          <span className="xp wide" style={{ '--p': lv.into / lv.need } as CSSProperties} aria-label={`${lv.into} of ${lv.need} XP to level ${lv.level + 1}`}>
            <i />
          </span>
          <small className="fine">
            {lv.into} / {lv.need} XP to level {lv.level + 1}
          </small>
        </div>
      </div>

      {onLeaderboards && (
        <div className="pick-list">
          <PickRow label="How you rank" value="Leaderboards" icon={<span className="pick-glyph">#</span>} onClick={onLeaderboards} />
        </div>
      )}

      <div className="section-title">Record</div>
      <div className="stat-grid">
        {record.map(([k, v]) => (
          <div key={k} className="stat-tile">
            <b>{v}</b>
            <small>{k}</small>
          </div>
        ))}
      </div>
      {p.stats.streak ? <p className="fine">On a {p.stats.streak}-win streak right now.</p> : null}

      <div className="section-title">
        Achievements · {have.filter((id) => id in ACHIEVEMENTS).length} of {ids.length}
      </div>
      <ul className="ach-list">
        {ids.map((id) => {
          const a = ACHIEVEMENTS[id];
          const done = have.includes(id);
          const pr = done ? null : progressOf(id, count);
          return (
            <li key={id} className={done ? 'done' : ''}>
              <span className="ach-icon" aria-hidden>
                {done ? '★' : '☆'}
              </span>
              <span className="grow">
                <b>{a.title}</b>
                <small>{a.desc}</small>
                {pr && (
                  <span className="ach-bar" style={{ '--p': Math.min(1, pr[0] / pr[1]) } as CSSProperties} aria-label={`${pr[0]} of ${pr[1]}`}>
                    <i />
                  </span>
                )}
              </span>
              {pr && (
                <span className="ach-count">
                  {Math.min(pr[0], pr[1])}/{pr[1]}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Screen>
  );
}

/** "Achievement unlocked" pop-ups, one at a time, over any screen. */
export function AchievementToast() {
  const next = achieved.use((a) => a.fresh[0]);
  useEffect(() => {
    if (!next) return;
    sound.chime('win');
    const t = setTimeout(achievementShown, 3800);
    return () => clearTimeout(t);
  }, [next]);
  if (!next) return null;
  const a = ACHIEVEMENTS[next];
  return (
    <div key={next} className="ach-toast" role="status">
      <span className="ach-icon" aria-hidden>
        ★
      </span>
      <span>
        <small>Achievement unlocked</small>
        <b>{a.title}</b>
      </span>
    </div>
  );
}
