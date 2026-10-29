import { PRODUCTS, type ProductId } from './core/economy';
import { isDesktopShell, platform } from './platform';

/**
 * Real-money purchases, one adapter per store. The game only ever asks "is a store here?" and
 * "buy this product"; a successful purchase comes back with a receipt id that the wallet
 * credits once. Product ids are the same everywhere (core/economy.ts PRODUCTS).
 *
 *  steam    Steam microtransactions. The purchase is started and finalised by our server
 *           (it holds the publisher Web API key Steam requires); this client asks it over
 *           HTTPS at VITE_STEAM_STORE_URL with the player's Steam id. Unset: no store.
 *  itch     itch.io has no in-app purchase API: the game is sold (or pay-what-you-want) on
 *           its page, and coins are earned by playing. No store in the game.
 *  play     Google Play Billing would be its own adapter here (a Capacitor billing plugin plus
 *           products in the Play Console). Not built yet.
 *  none     Development and the plain web build.
 */

export interface PurchaseResult {
  ok: boolean;
  receipt?: string;
  error?: string;
}

export interface StoreAdapter {
  readonly id: 'steam' | 'itch' | 'play' | 'none';
  /** Why there is no store, for the shop's footnote; null when purchases work. */
  readonly unavailable: string | null;
  purchase(product: ProductId): Promise<PurchaseResult>;
}

const none = (id: StoreAdapter['id'], why: string): StoreAdapter => ({
  id,
  unavailable: why,
  purchase: async () => ({ ok: false, error: why }),
});

/** Steam: our server talks to ISteamMicroTxn; the client only starts and polls an order. */
function steamStore(base: string, steamId: () => string | null): StoreAdapter {
  return {
    id: 'steam',
    unavailable: null,
    async purchase(product) {
      const user = steamId();
      if (!user) return { ok: false, error: 'Steam is not running.' };
      try {
        // The server calls InitTxn; Steam shows its own purchase overlay to the player.
        const start = await fetch(`${base}/steam/init`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ steamId: user, product }) });
        if (!start.ok) return { ok: false, error: `The store said ${start.status}.` };
        const { order } = (await start.json()) as { order: string };
        // The server finalises when Steam reports the player's authorisation; poll for it.
        for (let i = 0; i < 90; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const st = await fetch(`${base}/steam/order/${encodeURIComponent(order)}`);
          if (!st.ok) continue;
          const o = (await st.json()) as { state: 'pending' | 'done' | 'failed'; receipt?: string };
          if (o.state === 'done' && o.receipt) return { ok: true, receipt: o.receipt };
          if (o.state === 'failed') return { ok: false, error: 'The purchase was cancelled.' };
        }
        return { ok: false, error: 'The purchase timed out.' };
      } catch {
        return { ok: false, error: "Couldn't reach the store." };
      }
    },
  };
}

/** The Steam id of the player, set by the desktop shell once Steamworks is integrated. */
let steamUser: string | null = null;
export function setSteamUser(id: string | null) {
  steamUser = id;
}

function pick(): StoreAdapter {
  const target = (import.meta.env.VITE_STORE as string | undefined) ?? (isDesktopShell ? 'steam' : platform === 'android' ? 'play' : 'none');
  if (target === 'steam') {
    const url = import.meta.env.VITE_STEAM_STORE_URL as string | undefined;
    return url ? steamStore(url.replace(/\/$/, ''), () => steamUser) : none('steam', 'The Steam store opens with the Steam release.');
  }
  if (target === 'itch') return none('itch', 'On itch.io, coins are earned by playing.');
  if (target === 'play') return none('play', 'Google Play purchases are coming with the Play Store release.');
  return none('none', 'Coins are earned by playing in this version.');
}

export const store: StoreAdapter = pick();
export { PRODUCTS };
