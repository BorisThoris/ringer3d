import type { CSSProperties, ReactNode } from 'react';
import { ECONOMY, playerLevel } from '../core/economy';
import { lookFor } from '../game/marbles';
import { progress, settings } from '../game/settings';
import { dailyReady, wallet } from '../game/wallet';
import { MarbleChip, tap } from './components';

/** The sections. `shop` and `coins` open the Collection's shop (`coins` at the coin packs). */
export type Target = 'menu' | 'shop' | 'coins' | 'marbles' | 'settings' | 'profile';

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
      <button className="profile" title={`${lv.xp.toLocaleString()} XP`} aria-label="Profile" aria-current={on === 'profile'} onClick={() => open('profile')}>
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
      </button>
      <div className="wallet">
        <button className="coin-bank" aria-label={`${coins.toLocaleString()} coins: get more`} onClick={() => open('coins')}>
          <span className="coin" aria-hidden />
          <span key={coins} className="num">
            {coins.toLocaleString()}
          </span>
          <span className="plus" aria-hidden>
            +
          </span>
        </button>
        <button className="bar-btn shop" aria-label="Shop" aria-current={on === 'collection'} onClick={() => open('shop')}>
          <BagIcon />
          <span className="label">Shop</span>
          {waiting && on !== 'collection' && <span className="badge">!</span>}
        </button>
        <button className="bar-btn" aria-label="Settings" aria-current={on === 'settings'} onClick={() => open('settings')}>
          <GearIcon />
        </button>
      </div>
    </header>
  );
}

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2.2" />
    <circle cx="12" cy="12" r="3.6" fill="currentColor" />
  </svg>
);
const MarblesIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
    <circle cx="7.5" cy="15.5" r="4" fill="currentColor" />
    <circle cx="16.5" cy="15.5" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="12" cy="7.5" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);
const PersonIcon = () => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
    <circle cx="12" cy="8" r="4" fill="currentColor" />
    <path d="M4 20.5c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5z" fill="currentColor" />
  </svg>
);

/**
 * The sections, where a thumb reaches them: a tab bar along the bottom of a phone held upright,
 * a rail down the left side of one held sideways (styles.css decides; big screens keep the top bar).
 */
export function BottomNav({ on, go }: { on: Target; go: (t: Target) => void }) {
  const coins = wallet.use((w) => w.coins);
  const daily = wallet.use((w) => dailyReady(w));
  const waiting = daily || coins >= ECONOMY.bagPrice;
  const tabs: { id: Target; label: string; icon: ReactNode; badge?: boolean }[] = [
    { id: 'menu', label: 'Play', icon: <PlayIcon /> },
    { id: 'shop', label: 'Shop', icon: <BagIcon />, badge: waiting },
    { id: 'marbles', label: 'Marbles', icon: <MarblesIcon /> },
    { id: 'profile', label: 'Profile', icon: <PersonIcon /> },
    { id: 'settings', label: 'Settings', icon: <GearIcon /> },
  ];
  return (
    <nav className="tabbar" aria-label="Sections">
      {tabs.map((t) => {
        const current = on === t.id || (on === 'coins' && t.id === 'shop');
        return (
          <button
            key={t.id}
            className="tabbar-btn"
            aria-current={current ? 'page' : undefined}
            onClick={() => {
              tap();
              // Tapping the tab you are on takes you back to its top.
              if (current) document.querySelector('.overlay .screen, .overlay .menu')?.scrollTo({ top: 0, behavior: 'smooth' });
              else go(t.id);
            }}
          >
            <span className="tabbar-icon">
              {t.icon}
              {t.badge && !current && <span className="badge" aria-label="Something is waiting" />}
            </span>
            <span className="tabbar-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
