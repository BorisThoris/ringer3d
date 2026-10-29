import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '../src/core/economy';
import { playStore, type PlayBillingPlugin } from '../src/platformStore';
// @ts-expect-error plain JS server module
import { createPlayStore, PLAY_PRODUCTS } from '../server/playStore.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { client_email: 'shop@ringer3d.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, token_uri: 'https://oauth2.googleapis.com/token' };
const PKG = 'com.boristhoris.ringer3d';

/** Google, pretend: the OAuth endpoint checks our JWT's signature; tokens map to purchases. */
function fakeGoogle(purchases: Record<string, { product: string; purchaseState: number; consumptionState?: number; orderId?: string }>) {
  const calls: { url: string; method: string; auth?: string }[] = [];
  const fetchFn = async (url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
    calls.push({ url, method: init.method ?? 'GET', auth: init.headers?.authorization });
    const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
    if (url === account.token_uri) {
      const jwt = new URLSearchParams(init.body).get('assertion')!;
      const [h, c, sig] = jwt.split('.');
      const good = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'));
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
      return good && claims.iss === account.client_email && claims.scope.includes('androidpublisher') ? json(200, { access_token: 'AT', expires_in: 3600 }) : json(401, {});
    }
    if (init.headers?.authorization !== 'Bearer AT') return json(401, {});
    const m = url.match(/applications\/([^/]+)\/purchases\/products\/([^/]+)\/tokens\/([^/:]+)(:consume)?$/);
    if (!m || decodeURIComponent(m[1]) !== PKG) return json(404, {});
    const p = purchases[decodeURIComponent(m[3])];
    if (!p || p.product !== m[2]) return json(404, {});
    if (m[4]) {
      p.consumptionState = 1;
      return json(204, {});
    }
    return json(200, { purchaseState: p.purchaseState, consumptionState: p.consumptionState ?? 0, orderId: p.orderId });
  };
  return { calls, fetchFn };
}

describe('Google Play coin-pack server', () => {
  it('sells exactly the game\'s products', () => {
    expect([...PLAY_PRODUCTS].sort()).toEqual(PRODUCTS.map((p) => p.id).sort());
  });

  it('is off without a service account', async () => {
    expect(await createPlayStore({})('POST', '/play/verify', {})).toEqual([503, { error: 'store not configured' }]);
    expect(await createPlayStore({})('GET', '/steam/init', null)).toBe(null);
  });

  it('checks a paid token with Google, consumes it, and receipts it once', async () => {
    const g = fakeGoogle({ 'tok-paid-0001': { product: 'coins_large', purchaseState: 0, orderId: 'GPA.1234-5678' } });
    const handle = createPlayStore({ account, packageName: PKG, fetchFn: g.fetchFn });
    const out = await handle('POST', '/play/verify', { product: 'coins_large', token: 'tok-paid-0001' });
    expect(out).toEqual([200, { receipt: 'play:GPA.1234-5678', product: 'coins_large' }]);
    expect(g.calls.filter((c) => c.url.endsWith(':consume'))).toHaveLength(1);
    // A retry (lost response) gets the same receipt, with no second consume.
    expect(await handle('POST', '/play/verify', { product: 'coins_large', token: 'tok-paid-0001' })).toEqual(out);
    expect(g.calls.filter((c) => c.url.endsWith(':consume'))).toHaveLength(1);
    // One OAuth exchange, reused.
    expect(g.calls.filter((c) => c.url === account.token_uri)).toHaveLength(1);
  });

  it('refuses forged, pending, used, mismatched and unknown purchases', async () => {
    const g = fakeGoogle({
      'tok-pending-01': { product: 'coins_small', purchaseState: 2 },
      'tok-cancelled1': { product: 'coins_small', purchaseState: 1 },
      'tok-used-00001': { product: 'coins_small', purchaseState: 0, consumptionState: 1 },
    });
    const handle = createPlayStore({ account, packageName: PKG, fetchFn: g.fetchFn });
    const st = async (product: string, token: string) => (await handle('POST', '/play/verify', { product, token }))[0];
    expect(await st('coins_small', 'tok-forged-001')).toBe(403);
    expect(await st('coins_small', 'tok-pending-01')).toBe(402);
    expect(await st('coins_small', 'tok-cancelled1')).toBe(402);
    expect(await st('coins_small', 'tok-used-00001')).toBe(409);
    expect(await st('coins_large', 'tok-used-00001')).toBe(403); // token is for another product
    expect(await st('free_money', 'tok-used-00001')).toBe(400);
    expect(await st('coins_small', 'bad token!')).toBe(400);
  });

  it('a wrong service-account key gets nothing', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const g = fakeGoogle({ 'tok-paid-0001': { product: 'coins_small', purchaseState: 0 } });
    const handle = createPlayStore({ account: { ...account, private_key: other }, packageName: PKG, fetchFn: g.fetchFn });
    await expect(handle('POST', '/play/verify', { product: 'coins_small', token: 'tok-paid-0001' })).rejects.toThrow(/refused/);
  });
});

describe('Google Play adapter in the game', () => {
  // The game's adapter talking to the real server module, which talks to fake Google.
  const setup = (purchases: Parameters<typeof fakeGoogle>[0], plugin: PlayBillingPlugin) => {
    const g = fakeGoogle(purchases);
    const handle = createPlayStore({ account, packageName: PKG, fetchFn: g.fetchFn });
    const fetchFn = (async (url: string, init: { body: string }) => {
      const [status, body] = await handle('POST', new URL(url).pathname, JSON.parse(init.body));
      return { ok: status < 300, status, json: async () => body };
    }) as unknown as typeof fetch;
    return playStore('https://shop.example', plugin, fetchFn);
  };

  it('buys a pack: Google sheet, server check, receipt', async () => {
    const s = setup({ 'tok-buy-000001': { product: 'coins_medium', purchaseState: 0, orderId: 'GPA.9' } }, {
      purchase: async ({ productId }) => ({ purchaseToken: productId === 'coins_medium' ? 'tok-buy-000001' : 'x', state: 'purchased' }),
      unconsumed: async () => ({ purchases: [] }),
    });
    expect(await s.purchase('coins_medium')).toEqual({ ok: true, receipt: 'play:GPA.9' });
  });

  it('reports cancel and pending without crediting', async () => {
    const cancel = setup({}, { purchase: async () => Promise.reject(Object.assign(new Error('x'), { code: 'cancelled' })), unconsumed: async () => ({ purchases: [] }) });
    expect(await cancel.purchase('coins_small')).toMatchObject({ ok: false, error: 'The purchase was cancelled.' });
    const pend = setup({}, { purchase: async () => ({ purchaseToken: 'tok-pending-01', state: 'pending' }), unconsumed: async () => ({ purchases: [] }) });
    expect((await pend.purchase('coins_small')).ok).toBe(false);
  });

  it('restores a purchase the app never got to credit', async () => {
    const s = setup({ 'tok-orphan-001': { product: 'coins_small', purchaseState: 0, orderId: 'GPA.7' } }, {
      purchase: async () => Promise.reject(new Error('unused')),
      unconsumed: async () => ({ purchases: [{ productId: 'coins_small', purchaseToken: 'tok-orphan-001' }, { productId: 'old_sku', purchaseToken: 'tok-other-0001' }] }),
    });
    expect(await s.restore!()).toEqual([{ receipt: 'play:GPA.7', product: 'coins_small' }]);
  });
});
