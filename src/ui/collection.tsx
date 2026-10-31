import { useEffect, useState, type CSSProperties } from 'react';
import { bookProgress, collectibleFromId, nextTier, SHINY_ODDS, TIERS, TRADE_UP_COUNT, WEARS, type Collectible } from '../core/collectible';
import { bagOdds, ECONOMY, meltValue, PRODUCTS } from '../core/economy';
import { EFFECTS, phenomenonOdds, type Tier } from '../core/marbleGen';
import { lookFor, uiColor } from '../game/marbles';
import { settings } from '../game/settings';
import { buyBag, claimBookSet, claimToday, credit, dailyPreview, meltMarble, tradeUpMarbles, wallet } from '../game/wallet';
import { store } from '../platformStore';
import { tradedUp } from '../platformFeatures';
import { services } from '../services';
import { useItems } from './useItems';
import { Marble3D, MarbleChip, Screen, Sheet, tap } from './components';

export const TIER_COLOR: Record<Tier, string> = {
  Common: '#b9c1d0',
  Rare: '#4f9dff',
  Epic: '#b45cff',
  Legendary: '#ffaa1e',
  Mythic: '#ff46be',
};

/** One marble the player holds: in this device's collection, or as an item in their Steam inventory. */
type Held = Collectible & { source: 'local' | 'steam'; itemId?: string; tally: number; at: number };
type Sort = 'new' | 'rarity' | 'float';

function useHeld(): Held[] {
  const owned = wallet.use((w) => w.owned);
  const onSteam = useItems().marbles;
  const local = owned.flatMap((o) => {
    const c = collectibleFromId(o.id);
    return c ? [{ ...c, source: 'local' as const, tally: o.tally ?? 0, at: o.at }] : [];
  });
  const remote = onSteam.map((m) => ({ ...m, source: 'steam' as const, at: Number(BigInt(m.itemId) % 1000000n) }));
  return [...remote, ...local];
}

const fmtFloat = (f: number) => f.toFixed(6);

/** The float on a strip of the five wear bands, with a marker where this marble sits. */
export function FloatBar({ float }: { float: number }) {
  return (
    <div className="float-bar" aria-label={`Float ${fmtFloat(float)}`}>
      {WEARS.map((w) => (
        <span key={w.name} className={`band ${w.short}`} style={{ flexGrow: w.max - w.min }} title={`${w.name} ${w.min}–${w.max}`} />
      ))}
      <i style={{ left: `${float * 100}%` }} />
    </div>
  );
}

/** A big look at one marble: everything a collector checks. */
function Inspect({ c, equipped, onEquip, onMelt }: { c: Held; equipped: boolean; onEquip: () => void; onMelt?: () => void }) {
  return (
    <section
      className={`inspect${c.shiny ? ' shiny' : ''}${c.effect !== 'none' ? ' phenomenon' : ''}`}
      style={{ '--c': TIER_COLOR[c.tier], '--fx': c.marble.effectColor } as CSSProperties}
      aria-live="polite"
    >
      <div className="inspect-view">
        <Marble3D id={c.id} size={200} />
      </div>
      <div className="inspect-info">
        <small className="tier">
          {c.tier}
          {c.source === 'steam' && <span className="steam-tag">Steam item</span>}
        </small>
        <h2>{c.marble.name}</h2>
        {c.effect !== 'none' && (
          <p className="fx-line">
            <b>✦ {EFFECTS[c.effect].title}</b> {EFFECTS[c.effect].desc}
          </p>
        )}
        <div className="facts">
          <span>
            <b>{c.wear}</b>
            <small>wear</small>
          </span>
          <span>
            <b className="mono">{fmtFloat(c.float)}</b>
            <small>float</small>
          </span>
          <span>
            <b>#{c.pattern}</b>
            <small>pattern</small>
          </span>
          <span>
            <b>{c.tally}</b>
            <small>captures</small>
          </span>
        </div>
        <FloatBar float={c.float} />
        <p className="fine">
          {c.marble.pattern} · {c.marble.finish} · {c.marble.scheme} colours · {c.source === 'steam' ? `item ${c.itemId}` : `id ${c.uid}`}
        </p>
        {c.traits.length > 0 && (
          <div className="traits">
            {c.traits.map((t) => (
              <span key={t} className="trait">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="row">
          <button
            className="btn primary"
            aria-pressed={equipped}
            onClick={() => {
              tap();
              onEquip();
            }}
          >
            {equipped ? 'Equipped' : 'Equip'}
          </button>
          {onMelt && (
            <button className="btn" disabled={equipped} onClick={onMelt}>
              Melt for {meltValue(c)}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** Which half to open on: the shop, the shop scrolled to the coin packs, or your marbles. */
export type CollectionTab = 'shop' | 'coins' | 'marbles';

/**
 * Two tabs. Shop: Marble Bags, coin packs, the daily reward and Steam. My marbles: what you hold
 * (here and on Steam), trade-ups and the Marble Book. A marble you open or pick shows above both.
 */
export function Collection({ onBack, tab: initial = 'shop', onTab }: { onBack: () => void; tab?: CollectionTab; onTab: (t: CollectionTab) => void }) {
  // The tab belongs to the app (a phone switches it from the bottom bar).
  const tab = initial === 'marbles' ? 'marbles' : 'shop';
  const setTab = onTab;
  useEffect(() => {
    if (initial === 'coins') requestAnimationFrame(() => document.getElementById('coin-packs')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [initial]);
  const w = wallet.use((x) => x);
  const equipped = settings.use((s) => s.marble);
  const held = useHeld();
  const steamState = useItems();
  const items = services.items;
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<Sort>('new');
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const daily = dailyPreview(w);
  // "Best value" is the pack with the most coins per dollar; the bonus is measured against the smallest.
  const perDollar = (p: (typeof PRODUCTS)[number]) => p.coins / p.usd;
  const best = PRODUCTS.reduce((a, b) => (perDollar(b) > perDollar(a) ? b : a));
  const bonus = Math.round((perDollar(best) / perDollar(PRODUCTS[0]) - 1) * 100);

  const sorted = [...held].sort((a, b) =>
    sort === 'rarity'
      ? TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier) || +(b.effect !== 'none') - +(a.effect !== 'none') || +b.shiny - +a.shiny || a.float - b.float : sort === 'float' ? a.float - b.float : b.at - a.at,
  );
  const shown = open ? held.find((h) => h.id === open) ?? null : null;
  const pickedHeld = picked.map((id) => held.find((h) => h.id === id)).filter((h): h is Held => !!h);
  const pickTier = pickedHeld[0]?.tier;
  const pickSource = pickedHeld[0]?.source;
  const book = bookProgress(held);
  const claimed = w.sets ?? [];

  const say = (s: string) => {
    setNote(s);
    window.setTimeout(() => setNote((n) => (n === s ? null : n)), 3500);
  };
  const show = (id: string) => setOpen(id);

  const doTradeUp = async () => {
    tap();
    setBusy(true);
    const r = pickSource === 'steam' && items ? await items.tradeUp(pickedHeld.map((h) => h.itemId!)) : tradeUpMarbles(picked);
    setBusy(false);
    if (r.ok) {
      tradedUp();
      setPicking(false);
      setPicked([]);
      show(r.marble.id);
      say(`Traded up: ${r.marble.marble.name}`);
    } else say(r.why);
  };

  return (
    <Screen title={tab === 'shop' ? 'Shop' : 'My marbles'} onBack={onBack} wide>
      <div className="tabs collection-tabs" role="tablist" aria-label="Shop or your marbles">
        {(['shop', 'marbles'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            className="tab"
            aria-selected={tab === t}
            onClick={() => {
              tap();
              setTab(t);
            }}
          >
            {t === 'shop' ? 'Shop' : 'My marbles'}
            {t === 'marbles' && <span className="count">{held.length}</span>}
          </button>
        ))}
      </div>
      <div className="collection">
        {shown && (
          <Sheet title={shown.source === 'steam' ? 'Steam marble' : 'Marble'} onClose={() => setOpen(null)}>
          <Inspect
            c={shown}
            equipped={equipped === shown.id}
            onEquip={() => settings.set({ marble: shown.id })}
            onMelt={
              shown.source === 'local'
                ? () => {
                    tap();
                    const r = meltMarble(shown.id);
                    if (r.ok) setOpen(null);
                    say(r.ok ? `Melted ${shown.marble.name}: +${r.coins} coins` : r.why);
                  }
                : undefined
            }
          />
          </Sheet>
        )}

        {tab === 'shop' && (
          <>
        <section className="bag-card">
          <div className="bag" aria-hidden />
          <div>
            <h3>Marble Bag</h3>
            <p>A brand-new marble, minted for you: its own look, wear float and pattern. Nobody else has this one.</p>
            <p className="odds">
              {bagOdds().map((o) => (
                <span key={o.tier} style={{ color: TIER_COLOR[o.tier] }}>
                  {o.tier} {o.odds}%
                </span>
              ))}
              <span className="shiny-odds">✦ Shiny {100 / SHINY_ODDS}%</span>
              <span className="fx-odds">✦ Phenomenon {phenomenonOdds().toFixed(1)}%</span>
            </p>
            <button
              className="btn primary"
              disabled={w.coins < ECONOMY.bagPrice}
              onClick={() => {
                tap();
                const r = buyBag();
                if (r.ok) show(r.marble.id);
                else say(r.why);
              }}
            >
              Open for {ECONOMY.bagPrice} coins
            </button>
          </div>
        </section>

        <section id="coin-packs">
          <div className="daily-head">
            <h3>Coins</h3>
            <small>Every match pays coins too</small>
          </div>
          {/* Where nothing can be bought (itch.io, the website) the packs stay out of sight. */}
          {!store.unavailable && (
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
          )}
          {store.unavailable && <p className="fine">{store.unavailable}</p>}
        </section>

        {items && (
          <section className="steam-inv">
            <div className="daily-head">
              <h3>Steam inventory</h3>
              <small>{steamState.error ? `Steam: ${steamState.error}` : `${steamState.marbles.length} marbles · ${steamState.bags.length} bags · tradable on Steam`}</small>
            </div>
            <div className="row">
              {steamState.bags.length > 0 && (
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={async () => {
                    tap();
                    setBusy(true);
                    const r = await items.openBag(steamState.bags[0]);
                    setBusy(false);
                    if (r.ok) show(r.marble.id);
                    else say(r.why);
                  }}
                >
                  Open a Steam bag ({steamState.bags.length})
                </button>
              )}
              {items.canBuyBags && (
                <button
                  className="btn"
                  onClick={async () => {
                    tap();
                    await items.buyBag();
                  }}
                >
                  Buy a bag on Steam
                </button>
              )}
              <button
                className="btn"
                disabled={busy}
                onClick={async () => {
                  tap();
                  setBusy(true);
                  const got = await items.drop();
                  setBusy(false);
                  if (got[0]) show(got[0].id);
                  say(got.length ? `Steam drop: ${got.map((g) => g.marble.name).join(', ')}` : 'No drop yet: drops come with playtime.');
                }}
              >
                Check for a drop
              </button>
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
          </>
        )}

        {tab === 'marbles' && (
          <>
        <section>
          <div className="daily-head">
            <h3>Your marbles ({held.length})</h3>
            <div className="chips sort" role="group" aria-label="Sort">
              {(['new', 'rarity', 'float'] as Sort[]).map((s) => (
                <button key={s} className="chip" aria-pressed={sort === s} onClick={() => setSort(s)}>
                  {s === 'new' ? 'Newest' : s === 'rarity' ? 'Rarity' : 'Best float'}
                </button>
              ))}
              <button
                className="chip"
                aria-pressed={picking}
                onClick={() => {
                  setPicking(!picking);
                  setPicked([]);
                }}
              >
                Trade up
              </button>
            </div>
          </div>
          {picking && (
            <div className="tradeup">
              <p>
                {pickTier
                  ? nextTier(pickTier)
                    ? `${picked.length} of ${TRADE_UP_COUNT} ${pickTier} → 1 brand-new ${nextTier(pickTier)}`
                    : 'Mythic is the top: pick another rarity.'
                  : `Pick ${TRADE_UP_COUNT} marbles of one rarity: they become one marble of the next.`}
              </p>
              <button className="btn primary" disabled={busy || picked.length !== TRADE_UP_COUNT || !pickTier || !nextTier(pickTier)} onClick={doTradeUp}>
                Trade up
              </button>
            </div>
          )}
          {held.length === 0 && (
            <p>
              Open a bag in the{' '}
              <button className="link" onClick={() => setTab('shop')}>
                Shop
              </button>{' '}
              to start your collection. Every match earns coins.
            </p>
          )}
          <div className="gen-grid">
            {sorted.map((h) => {
              const look = lookFor(h.id);
              const isOn = equipped === h.id;
              const sel = picked.includes(h.id);
              const blocked = picking && !sel && ((pickTier && (h.tier !== pickTier || h.source !== pickSource)) || picked.length >= TRADE_UP_COUNT || isOn);
              return (
                <button
                  key={h.id}
                  className={`gen-card${h.shiny ? ' shiny' : ''}${h.effect !== 'none' ? ' phenomenon' : ''}${sel ? ' picked' : ''}`}
                  style={{ '--c': TIER_COLOR[h.tier], '--a': uiColor(look), '--fx': h.marble.effectColor } as CSSProperties}
                  aria-pressed={picking ? sel : open === h.id}
                  disabled={!!blocked}
                  onClick={() => {
                    tap();
                    if (picking) setPicked((p) => (p.includes(h.id) ? p.filter((x) => x !== h.id) : p.length < TRADE_UP_COUNT ? [...p, h.id] : p));
                    else show(h.id);
                  }}
                >
                  {h.source === 'steam' && <span className="corner steam">Steam</span>}
                  {isOn && <span className="corner on">Equipped</span>}
                  {h.effect !== 'none' && !isOn && h.source !== 'steam' && <span className="corner fx">✦</span>}
                  <MarbleChip id={h.id} size={56} />
                  <b>{h.marble.name}</b>
                  <small className="tier">{h.tier}</small>
                  <span className="wear-line">
                    <abbr title={h.wear}>{WEARS.find((x) => x.name === h.wear)!.short}</abbr> <span className="mono">{h.float.toFixed(4)}</span>
                    {h.tally > 0 && <span className="tally"> · {h.tally}✕</span>}
                  </span>
                  {h.traits.length > 0 && <span className="trait mini">{h.traits[0]}</span>}
                </button>
              );
            })}
          </div>
        </section>

        <section className="book">
          <h3>Marble Book</h3>
          <div className="book-sets">
            {book.map(({ set, got, done }) => {
              const paid = claimed.includes(set.id);
              return (
                <div key={set.id} className={`book-set${done ? ' done' : ''}`}>
                  <div className="book-head">
                    <b>{set.name}</b>
                    <small>
                      {got.length}/{set.needs.length}
                    </small>
                  </div>
                  <div className="book-slots">
                    {set.needs.map((n) => (
                      <span key={n} className={`slot${got.includes(n) ? ' got' : ''}`} title={n}>
                        {n}
                      </span>
                    ))}
                  </div>
                  <button
                    className={done && !paid ? 'btn small primary' : 'btn small'}
                    disabled={!done || paid}
                    onClick={() => {
                      tap();
                      const r = claimBookSet(
                        set.id,
                        held.filter((h) => h.source === 'steam'),
                      );
                      say(r.ok ? `${set.name}: +${r.coins} coins` : r.why);
                    }}
                  >
                    {paid ? 'Claimed' : `+${set.reward.toLocaleString()} coins`}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
          </>
        )}
        {note && (
          <p className="toast" role="status">
            {note}
          </p>
        )}
      </div>
    </Screen>
  );
}
