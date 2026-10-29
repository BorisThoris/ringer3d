/**
 * Steam microtransactions for coin packs: the server half of src/platformStore.ts `steamStore`.
 * It holds the publisher Web API key (never shipped in the game), so only it may talk to
 * ISteamMicroTxn.
 *
 *   POST /steam/init      { steamId, ticket, product, language }
 *        checks the player's Web API ticket (ISteamUserAuth/AuthenticateUserTicket), then
 *        InitTxn; Steam shows its purchase overlay in the game -> { order }
 *   POST /steam/finalize  { order }
 *        after the game hears MicroTxnAuthorizationResponse: FinalizeTxn -> { receipt }
 *        A receipt is issued once per order; the game credits it once (core/economy.ts).
 *
 * Env: STEAM_PUBLISHER_KEY, STEAM_APP_ID, STEAM_SANDBOX=1 (ISteamMicroTxnSandbox: test
 * purchases with no money moving). Without a key the endpoints answer 503.
 *
 * Orders live in memory: one server process. Several processes need a shared store.
 */

/** Prices in US cents; must match PRODUCTS in src/core/economy.ts (tests/steamStore.test.ts). */
export const STEAM_PRICES = {
  coins_small: { cents: 99, description: '500 coins' },
  coins_medium: { cents: 299, description: '1,500 coins' },
  coins_large: { cents: 799, description: '5,000 coins' },
};

const API = 'https://partner.steam-api.com';

export function createSteamStore({ key, appId, sandbox = false, fetchFn = fetch, now = () => Date.now() } = {}) {
  const txn = sandbox ? 'ISteamMicroTxnSandbox' : 'ISteamMicroTxn';
  /** order id -> { steamId, product, state: 'open' | 'done', receipt? , at } */
  const orders = new Map();
  let seq = BigInt(now()) * 1000n;

  const post = async (path, form) => {
    const r = await fetchFn(`${API}/${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
    const j = await r.json().catch(() => ({}));
    return j.response ?? {};
  };

  async function init(body) {
    const { steamId, ticket, product, language } = body ?? {};
    const price = STEAM_PRICES[product];
    if (!price) return [400, { error: 'unknown product' }];
    if (!/^\d{17}$/.test(String(steamId ?? '')) || !/^[0-9a-f]+$/i.test(String(ticket ?? ''))) return [400, { error: 'bad request' }];
    // The ticket proves the request comes from this Steam account.
    const auth = await fetchFn(`${API}/ISteamUserAuth/AuthenticateUserTicket/v1/?key=${encodeURIComponent(key)}&appid=${appId}&ticket=${ticket}&identity=ringer3d-store`);
    const who = (await auth.json().catch(() => ({})))?.response?.params;
    if (!who || who.steamid !== String(steamId) || who.result !== 'OK') return [403, { error: 'ticket rejected' }];
    const order = String(++seq);
    const res = await post(`${txn}/InitTxn/v3/`, {
      key,
      orderid: order,
      steamid: String(steamId),
      appid: String(appId),
      itemcount: '1',
      language: String(language || 'english').slice(0, 20),
      currency: 'USD',
      usersession: 'client',
      'itemid[0]': String(Object.keys(STEAM_PRICES).indexOf(product) + 1),
      'qty[0]': '1',
      'amount[0]': String(price.cents),
      'description[0]': price.description,
    });
    if (res.result !== 'OK') return [502, { error: res.error?.errordesc ?? 'Steam refused the order' }];
    orders.set(order, { steamId: String(steamId), product, state: 'open', at: now() });
    return [200, { order }];
  }

  async function finalize(body) {
    const order = String(body?.order ?? '');
    const o = orders.get(order);
    if (!o) return [404, { error: 'no such order' }];
    if (o.state === 'done') return [200, { receipt: o.receipt, product: o.product }];
    const res = await post(`${txn}/FinalizeTxn/v2/`, { key, orderid: order, appid: String(appId) });
    if (res.result !== 'OK') return [402, { error: res.error?.errordesc ?? 'not authorised' }];
    o.state = 'done';
    o.receipt = `steam:${order}:${res.params?.transid ?? ''}`;
    return [200, { receipt: o.receipt, product: o.product }];
  }

  /** Route one request; returns [status, body] or null when the path isn't ours. */
  return async function handle(method, path, body) {
    if (!path.startsWith('/steam/')) return null;
    if (method === 'OPTIONS') return [204, null];
    if (!key || !appId) return [503, { error: 'store not configured' }];
    if (method !== 'POST') return [405, { error: 'POST only' }];
    if (path === '/steam/init') return init(body);
    if (path === '/steam/finalize') return finalize(body);
    return [404, { error: 'not found' }];
  };
}
