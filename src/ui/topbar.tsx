import type { CSSProperties } from 'react';
import { ECONOMY, playerLevel } from '../core/economy';
import { lookFor } from '../game/marbles';
import { progress, settings } from '../game/settings';
import { dailyReady, wallet } from '../game/wallet';
import { MarbleChip, tap } from './components';

type Target = 'collection' | 'settings';

/** A drawstring Marble Bag, like the one in the Collection. */
const BagIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
    <path d="M9.2 9.4 7 4.2l3.6 2 1.4-2.9 1.4 2.9 3.6-2-2.2 5.2z" fill="#c98a4e" />
    <path d="M8.6 9.4C4.4 11.2 3 15.6 4.6 18.6c1.4 2.6 13.4 2.6 14.8 0 1.6-3-.2-7.4-4-9.2z" fill="#a8672f" />
    <path d="M8.6 9.4C5.6 11 4.6 14.4 5.6 17c2.6.8 6.4.4 8-2.4 1.2-2 .6-4.3-.6-5.2z" fill="#d9a066" opacity=".55" />
    <rect x="8" y="8.2" width="8" height="2.4" rx="1.2" fill="#ff3d7f" />
  </svg>
);

const GearIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
    <path
      fill="currentColor"
      d="M13.6 2.5l.5 2.3a7.6 7.6 0 0 1 1.9.8l2-1.3 2.3 2.3-1.3 2a7.6 7.6 0 0 1 .8 1.9l2.3.5v3.2l-2.3.5a7.6 7.6 0 0 1-.8 1.9l1.3 2-2.3 2.3-2-1.3a7.6 7.6 0 0 1-1.9.8l-.5 2.3h-3.2l-.5-2.3a7.6 7.6 0 0 1-1.9-.8l-2 1.3-2.3-2.3 1.3-2a7.6 7.6 0 0 1-.8-1.9l-2.3-.5v-3.2l2.3-.5a7.6 7.6 0 0 1 .8-1.9l-1.3-2 2.3-2.3 2 1.3a7.6 7.6 0 0 1 1.9-.8l.5-2.3zM12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z"
    />
  </svg>
);

/**
 * The bar over every menu screen, as free-to-play games keep it: who you are and your level on
 * the left, your coins and the shop on the right. The shop button carries a red badge whenever
 * something is waiting there (today's reward, or enough coins for a Marble Bag).
 */
export function TopBar({ on, go }: { on: string; go: (t: Target) => void }) {
  const name = settings.use((s) => s.playerName);
  const marble = settings.use((s) => s.marble);
  const stats = progress.use((p) => p.stats);
  const coins = wallet.use((w) => w.coins);
  const daily = wallet.use((w) => dailyReady(w));
  const lv = playerLevel(stats);
  const waiting = daily || coins >= ECONOMY.bagPrice;
  const open = (t: Target) => {
    tap();
    go(t);
  };
  return (
    <header className="topbar">
      <div className="profile" title={`${lv.xp.toLocaleString()} XP`}>
        <span className="avatar">
          <MarbleChip id={marble} size={40} />
          <b className="lv" aria-label={`Level ${lv.level}`}>
            {lv.level}
          </b>
        </span>
        <span className="who">
          <b>{name}</b>
          <span className="xp" style={{ '--p': lv.into / lv.need } as CSSProperties} aria-label={`${lv.into} of ${lv.need} XP to level ${lv.level + 1}`}>
            <i />
          </span>
          <small>{lookFor(marble).name}</small>
        </span>
      </div>
      <div className="wallet">
        <button className="coin-bank" aria-label={`${coins.toLocaleString()} coins: get more`} onClick={() => open('collection')}>
          <span className="coin" aria-hidden />
          <span key={coins} className="num">
            {coins.toLocaleString()}
          </span>
          <span className="plus" aria-hidden>
            +
          </span>
        </button>
        <button className="bar-btn shop" aria-label="Collection" aria-current={on === 'collection'} onClick={() => open('collection')}>
          <BagIcon />
          {waiting && on !== 'collection' && <span className="badge">!</span>}
        </button>
        <button className="bar-btn" aria-label="Settings" aria-current={on === 'settings'} onClick={() => open('settings')}>
          <GearIcon />
        </button>
      </div>
    </header>
  );
}
