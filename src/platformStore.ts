import { PRODUCTS, type ProductId } from './core/economy';
import { isDesktopShell, platform } from './platform';
import { steam, type SteamBridge } from './steam';

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

/**
 * Steam microtransactions. Our server holds the publisher Web API key: it checks the player's
 * ticket, calls ISteamMicroTxn/InitTxn (Steam then shows its own purchase overlay), and calls
 * FinalizeTxn when the player authorises. The client hears the authorisation straight from
 * Steam (MicroTxnAuthorizationResponse) and asks the server for the receipt.
 */
function steamStore(base: string, bridge: SteamBridge): StoreAdapter {
  return {
    id: 'steam',
    unavailable: null,
    async purchase(product) {
      try {
        const me = await bridge.me();
        const ticket = await bridge.webApiTicket('ringer3d-store');
        const start = await fetch(`${base}/steam/init`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ steamId: me.steamId, ticket, product, language: me.language }),
        });
        if (!start.ok) return { ok: false, error: `The store said ${start.status}.` };
        const { order } = (await start.json()) as { order: string };
        const authorised = await new Promise<boolean>((resolve) => {
          const off = bridge.onMicroTxn((id, ok) => {
            if (id !== order) return;
            off();
            resolve(ok);
          });
          setTimeout(() => {
            off();
            resolve(false);
          }, 10 * 60_000);
        });
        if (!authorised) return { ok: false, error: 'The purchase was cancelled.' };
        const fin = await fetch(`${base}/steam/finalize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order }) });
        if (!fin.ok) return { ok: false, error: "The purchase didn't complete." };
        const { receipt } = (await fin.json()) as { receipt: string };
        return { ok: true, receipt };
      } catch {
        return { ok: false, error: "Couldn't reach the store." };
      }
    },
  };
}

function pick(): StoreAdapter {
  const target = (import.meta.env.VITE_STORE as string | undefined) ?? (steam ? 'steam' : isDesktopShell ? 'none' : platform === 'android' ? 'play' : 'none');
  if (target === 'steam') {
    const url = import.meta.env.VITE_STEAM_STORE_URL as string | undefined;
    if (!steam) return none('steam', 'Steam is not running.');
    return url ? steamStore(url.replace(/\/$/, ''), steam) : none('steam', 'The Steam store opens with the Steam release.');
  }
  if (target === 'itch') return none('itch', 'On itch.io, coins are earned by playing.');
  if (target === 'play') return none('play', 'Google Play purchases are coming with the Play Store release.');
  return none('none', 'Coins are earned by playing in this version.');
}

export const store: StoreAdapter = pick();
export { PRODUCTS };
