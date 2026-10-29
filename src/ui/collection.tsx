import { useState, type CSSProperties } from 'react';
import { bagOdds, ECONOMY, PRODUCTS } from '../core/economy';
import { generateMarble, type Tier } from '../core/marbleGen';
import { lookFor, uiColor } from '../game/marbles';
import { settings } from '../game/settings';
import { buyBag, claimToday, credit, dailyPreview, meltMarble, wallet } from '../game/wallet';
import { store } from '../platformStore';
import { Marble3D, MarbleChip, Screen, tap } from './components';

export const TIER_COLOR: Record<Tier, string> = {
  Common: '#b9c1d0',
  Rare: '#4f9dff',
  Epic: '#b45cff',
  Legendary: '#ffaa1e',
  Mythic: '#ff46be',
};

/** The collection: Marble Bags, the marbles you've minted, the daily reward and the store. */
export function Collection({ onBack }: { onBack: () => void }) {
  const w = wallet.use((x) => x);
  const equipped = settings.use((s) => s.marble);
  const [reveal, setReveal] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const owned = [...w.owned].reverse();
  const daily = dailyPreview(w);
  // "Best value" is the pack with the most coins per dollar; the bonus is measured against the smallest.
  const perDollar = (p: (typeof PRODUCTS)[number]) => p.coins / p.usd;
  const best = PRODUCTS.reduce((a, b) => (perDollar(b) > perDollar(a) ? b : a));
  const bonus = Math.round((perDollar(best) / perDollar(PRODUCTS[0]) - 1) * 100);
  const revealed = reveal ? generateMarble(Number(reveal.slice(1))) : null;

  const say = (s: string) => {
    setNote(s);
    window.setTimeout(() => setNote((n) => (n === s ? null : n)), 3500);
  };

  return (
    <Screen title="Collection" onBack={onBack} wide>
      <div className="collection">
        <section className="bag-card">
          <div className="bag" aria-hidden />
          <div>
            <h3>Marble Bag</h3>
            <p>A brand-new marble, minted for you: nobody else has this one.</p>
            <p className="odds">
              {bagOdds().map((o) => (
                <span key={o.tier} style={{ color: TIER_COLOR[o.tier] }}>
                  {o.tier} {o.odds}%
                </span>
              ))}
            </p>
            <button
              className="btn primary"
              disabled={w.coins < ECONOMY.bagPrice}
              onClick={() => {
                tap();
                const r = buyBag();
                if (r.ok) setReveal(r.marble.id);
                else say(r.why);
              }}
            >
              Open for {ECONOMY.bagPrice} coins
            </button>
          </div>
        </section>

        {revealed && (
          <section className="reveal" style={{ '--c': TIER_COLOR[revealed.tier] } as CSSProperties} aria-live="polite">
            <Marble3D id={revealed.id} size={170} />
            <div>
              <small>{revealed.tier}</small>
              <h2>{revealed.name}</h2>
              <p>
                {revealed.pattern} · {revealed.finish} · {revealed.scheme} colours
              </p>
              <div className="row">
                <button
                  className="btn primary"
                  onClick={() => {
                    tap();
                    settings.set({ marble: revealed.id });
                  }}
                >
                  Equip
                </button>
                <button className="btn ghost" onClick={() => setReveal(null)}>
                  Nice!
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="daily">
          <div className="daily-head">
            <h3>Daily reward</h3>
            <small>{daily.ready ? `Day ${daily.streak} is ready` : 'Come back tomorrow to keep your streak'}</small>
          </div>
          <ol className="daily-strip">
            {ECONOMY.daily.map((c, i) => {
              const d = i + 1;
              const last = ECONOMY.daily.length;
              const at = Math.min(daily.streak, last);
              const state = daily.ready && d === at ? 'today' : d <= Math.min(daily.ready ? daily.streak - 1 : daily.streak, last) ? 'done' : 'later';
              return (
                <li key={d} className={`day ${state}${d === last ? ' big' : ''}`} aria-label={`Day ${d}: ${c} coins${state === 'done' ? ', claimed' : state === 'today' ? ', ready' : ''}`}>
                  <small>Day {d}</small>
                  <span className="coin" aria-hidden />
                  <b>{c}</b>
                  {state === 'done' && (
                    <span className="tick" aria-hidden>
                      ✓
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <button
            className={daily.ready ? 'btn primary' : 'btn'}
            disabled={!daily.ready}
            onClick={() => {
              tap();
              const r = claimToday();
              say(r.ok ? `+${r.coins} coins (day ${r.streak})` : r.why);
            }}
          >
            {daily.ready ? `Claim ${daily.coins} coins` : 'Claimed today'}
          </button>
        </section>

        <section>
          <h3>Your marbles ({owned.length})</h3>
          {owned.length === 0 && <p>Open a bag to start your collection. Every match earns coins.</p>}
          <div className="gen-grid">
            {owned.map((o) => {
              const look = lookFor(o.id);
              const isOn = equipped === o.id;
              return (
                <div key={o.id} className="gen-card" style={{ '--c': TIER_COLOR[o.tier], '--a': uiColor(look) } as CSSProperties}>
                  <MarbleChip id={o.id} size={56} />
                  <b>{look.name}</b>
                  <small>{o.tier}</small>
                  <div className="row">
                    <button
                      className="btn small"
                      aria-pressed={isOn}
                      onClick={() => {
                        tap();
                        settings.set({ marble: o.id });
                      }}
                    >
                      {isOn ? 'Equipped' : 'Equip'}
                    </button>
                    <button
                      className="btn small ghost"
                      disabled={isOn}
                      onClick={() => {
                        tap();
                        const r = meltMarble(o.id);
                        say(r.ok ? `Melted ${look.name}: +${r.coins} coins` : r.why);
                      }}
                    >
                      Melt {ECONOMY.melt[o.tier]}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h3>Coins</h3>
          <div className="packs">
            {PRODUCTS.map((p, i) => (
              <button
                key={p.id}
                className={`pack${p.id === best.id ? ' best' : ''}`}
                style={{ '--stack': i + 1 } as CSSProperties}
                disabled={!!store.unavailable || busy}
                onClick={async () => {
                  tap();
                  setBusy(true);
                  const r = await store.purchase(p.id);
                  setBusy(false);
                  if (r.ok && r.receipt) {
                    credit(r.receipt, p.id);
                    say(`+${p.coins} coins. Thank you!`);
                  } else say(r.error ?? 'The purchase did not go through.');
                }}
              >
                {p.id === best.id && bonus > 0 && <span className="ribbon">Best value</span>}
                <span className="pile" aria-hidden>
                  {Array.from({ length: i + 2 }, (_, k) => (
                    <span key={k} className="coin" />
                  ))}
                </span>
                <b>{p.coins.toLocaleString()}</b>
                <small>{p.id === best.id && bonus > 0 ? `coins · +${bonus}%` : 'coins'}</small>
                <span className="price">US${p.usd.toFixed(2)}</span>
              </button>
            ))}
          </div>
          {store.unavailable && <p className="fine">{store.unavailable}</p>}
        </section>
        {note && (
          <p className="toast" role="status">
            {note}
          </p>
        )}
      </div>
    </Screen>
  );
}
