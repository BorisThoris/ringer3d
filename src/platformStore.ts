import { Capacitor, registerPlugin } from '@capacitor/core';
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
 *  play     Google Play Billing through our native PlayBilling plugin (android/app, Play
 *           Billing Library). Our server checks each purchase token with Google and consumes it
 *           (server/playStore.mjs) at VITE_PLAY_STORE_URL. Unset: no store.
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
  /** Purchases paid for but never credited (the app closed mid-purchase): credit these at boot. */
  restore?(): Promise<{ receipt: string; product: ProductId }[]>;
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

/** The native side: android/app/.../PlayBillingPlugin.java. */
export interface PlayBillingPlugin {
  /** Shows Google's purchase sheet. Rejects with code 'cancelled' when the player backs out. */
  purchase(o: { productId: string }): Promise<{ purchaseToken: string; state: 'purchased' | 'pending' }>;
  /** Paid purchases Google holds for us that aren't consumed yet. */
  unconsumed(): Promise<{ purchases: { productId: string; purchaseToken: string }[] }>;
}

/**
 * Google Play Billing. The phone buys; our server asks Google whether the token is paid and
 * consumes it (so the pack can be bought again), then hands back the receipt. A purchase whose
 * app died before the server answered stays unconsumed in Play and is picked up by restore().
 */
export function playStore(base: string, plugin: PlayBillingPlugin, fetchFn: typeof fetch = fetch): StoreAdapter {
  const verify = async (product: string, token: string) => {
    const r = await fetchFn(`${base}/play/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ product, token }) });
    if (!r.ok) return null;
    return (await r.json()) as { receipt: string; product: ProductId };
  };
  return {
    id: 'play',
    unavailable: null,
    async purchase(product) {
      let bought: { purchaseToken: string; state: string };
      try {
        bought = await plugin.purchase({ productId: product });
      } catch (e) {
        return { ok: false, error: (e as { code?: string }).code === 'cancelled' ? 'The purchase was cancelled.' : "Google Play couldn't start the purchase." };
      }
      if (bought.state === 'pending') return { ok: false, error: 'Your payment is pending. The coins arrive once it clears.' };
      try {
        const v = await verify(product, bought.purchaseToken);
        return v ? { ok: true, receipt: v.receipt } : { ok: false, error: "The purchase didn't check out." };
      } catch {
        return { ok: false, error: "Couldn't reach the store. Your coins arrive next time you open the game." };
      }
    },
    async restore() {
      const known = new Set<string>(PRODUCTS.map((p) => p.id));
      const out: { receipt: string; product: ProductId }[] = [];
      try {
        const { purchases } = await plugin.unconsumed();
        for (const p of purchases) {
          if (!known.has(p.productId)) continue;
          const v = await verify(p.productId, p.purchaseToken).catch(() => null);
          if (v) out.push(v);
        }
      } catch {
        /* offline: try again next launch */
      }
      return out;
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
  if (target === 'play') {
    const url = import.meta.env.VITE_PLAY_STORE_URL as string | undefined;
    if (!Capacitor.isPluginAvailable('PlayBilling')) return none('play', 'Google Play purchases need the Play Store app.');
    return url ? playStore(url.replace(/\/$/, ''), registerPlugin<PlayBillingPlugin>('PlayBilling')) : none('play', 'Google Play purchases open with the Play Store release.');
  }
  return none('none', 'Coins are earned by playing in this version.');
}

export const store: StoreAdapter = pick();
export { PRODUCTS };
