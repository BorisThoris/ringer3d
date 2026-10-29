/**
 * Google Play coin packs: the server half of src/platformStore.ts `playStore`. The phone buys
 * through Play Billing and sends us the purchase token; only we hold the service-account key
 * that may ask Google whether the token is a real, paid purchase.
 *
 *   POST /play/verify  { product, token }
 *        androidpublisher v3 purchases.products.get -> paid? -> purchases.products.consume
 *        (coin packs are consumable: consuming lets the player buy the same pack again)
 *        -> { receipt, product }. One receipt per token; the game credits it once.
 *
 * Env: PLAY_SERVICE_ACCOUNT (the service account's JSON key, or a path to it),
 * PLAY_PACKAGE (com.boristhoris.ringer3d). The service account needs "View financial data"
 * and "Manage orders" in the Play Console. Without them the endpoint answers 503.
 *
 * Verified tokens live in memory: one server process. Several processes need a shared store.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Play product ids are the game's (core/economy.ts PRODUCTS); tests/playStore.test.ts checks. */
export const PLAY_PRODUCTS = ['coins_small', 'coins_medium', 'coins_large'];

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

export function loadServiceAccount(value) {
  if (!value) return null;
  try {
    return JSON.parse(value.trim().startsWith('{') ? value : readFileSync(value, 'utf8'));
  } catch {
    return null;
  }
}

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

export function createPlayStore({ account, packageName, fetchFn = fetch, now = () => Date.now() } = {}) {
  /** purchase token -> { product, receipt } */
  const verified = new Map();
  let access = { token: null, until: 0 };

  // OAuth for a service account: a signed JWT exchanged for an access token.
  async function accessToken() {
    if (access.token && now() < access.until - 60_000) return access.token;
    const iat = Math.floor(now() / 1000);
    const claims = { iss: account.client_email, scope: SCOPE, aud: account.token_uri ?? 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 };
    const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(claims)}`;
    const sig = createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');
    const r = await fetchFn(claims.aud, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }).toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) throw new Error('Google refused the service account');
    access = { token: j.access_token, until: now() + (j.expires_in ?? 3600) * 1000 };
    return access.token;
  }

  async function verify(body) {
    const { product, token } = body ?? {};
    if (!PLAY_PRODUCTS.includes(product)) return [400, { error: 'unknown product' }];
    if (typeof token !== 'string' || !/^[\w.\-:]{10,2000}$/.test(token)) return [400, { error: 'bad request' }];
    const known = verified.get(token);
    if (known) return known.product === product ? [200, known] : [409, { error: 'token is for another product' }];
    const auth = { authorization: `Bearer ${await accessToken()}` };
    const base = `${API}/${encodeURIComponent(packageName)}/purchases/products/${product}/tokens/${encodeURIComponent(token)}`;
    const r = await fetchFn(base, { headers: auth });
    if (r.status === 404 || r.status === 400) return [403, { error: 'not a purchase' }];
    if (!r.ok) return [502, { error: `Google said ${r.status}` }];
    const p = await r.json();
    // purchaseState 0 = purchased (1 cancelled, 2 pending); consumptionState 1 = already used.
    if (p.purchaseState !== 0) return [402, { error: p.purchaseState === 2 ? 'payment pending' : 'not paid' }];
    if (p.consumptionState === 1) return [409, { error: 'already used' }];
    const c = await fetchFn(`${base}:consume`, { method: 'POST', headers: auth });
    if (!c.ok) return [502, { error: "couldn't consume the purchase" }];
    const out = { receipt: `play:${p.orderId ?? token.slice(0, 24)}`, product };
    verified.set(token, out);
    return [200, out];
  }

  /** Route one request; returns [status, body] or null when the path isn't ours. */
  return async function handle(method, path, body) {
    if (!path.startsWith('/play/')) return null;
    if (method === 'OPTIONS') return [204, null];
    if (!account?.private_key || !account?.client_email || !packageName) return [503, { error: 'store not configured' }];
    if (method !== 'POST') return [405, { error: 'POST only' }];
    if (path === '/play/verify') return verify(body);
    return [404, { error: 'not found' }];
  };
}
