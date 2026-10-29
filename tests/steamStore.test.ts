import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '../src/core/economy';
// @ts-expect-error plain JS server module
import { createSteamStore, STEAM_PRICES } from '../server/steamStore.mjs';

const STEAM_ID = '76561198000000042';

/** Steam's Web API, pretend: a ticket for STEAM_ID, and orders the player authorises (or not). */
function fakeSteam(authorise = true) {
  const calls: { url: string; form: Record<string, string> }[] = [];
  const fetchFn = async (url: string, init?: { body?: string }) => {
    const form = Object.fromEntries(new URLSearchParams(init?.body ?? ''));
    calls.push({ url, form });
    let response: unknown = {};
    if (url.includes('AuthenticateUserTicket')) response = { params: url.includes('ticket=abc123') ? { result: 'OK', steamid: STEAM_ID } : { result: 'Invalid' } };
    else if (url.includes('InitTxn')) response = { result: 'OK', params: { orderid: form.orderid, transid: '9001' } };
    else if (url.includes('FinalizeTxn')) response = authorise ? { result: 'OK', params: { orderid: form.orderid, transid: '9001' } } : { result: 'Failure', error: { errordesc: 'not approved' } };
    return { json: async () => ({ response }) };
  };
  return { calls, fetchFn };
}

describe('Steam coin-pack store server', () => {
  it('charges exactly what the game advertises', () => {
    for (const p of PRODUCTS) expect(STEAM_PRICES[p.id].cents).toBe(Math.round(p.usd * 100));
    expect(Object.keys(STEAM_PRICES).sort()).toEqual(PRODUCTS.map((p) => p.id).sort());
  });

  it('is off without a publisher key', async () => {
    const handle = createSteamStore({});
    expect(await handle('POST', '/steam/init', {})).toEqual([503, { error: 'store not configured' }]);
    expect(await handle('GET', '/elsewhere', null)).toBe(null);
  });

  it('runs a purchase: ticket, InitTxn, authorisation, FinalizeTxn, one receipt', async () => {
    const s = fakeSteam();
    const handle = createSteamStore({ key: 'KEY', appId: 480, sandbox: true, fetchFn: s.fetchFn, now: () => 1 });
    const [st, body] = await handle('POST', '/steam/init', { steamId: STEAM_ID, ticket: 'abc123', product: 'coins_medium', language: 'english' });
    expect(st).toBe(200);
    const init = s.calls.find((c) => c.url.includes('InitTxn'))!;
    expect(init.url).toContain('ISteamMicroTxnSandbox');
    expect(init.form).toMatchObject({ key: 'KEY', steamid: STEAM_ID, appid: '480', 'amount[0]': '299', currency: 'USD', orderid: body.order });
    const [fs, fin] = await handle('POST', '/steam/finalize', { order: body.order });
    expect(fs).toBe(200);
    expect(fin).toEqual({ receipt: `steam:${body.order}:9001`, product: 'coins_medium' });
    // Asking again gives the same receipt and doesn't finalise twice.
    expect(await handle('POST', '/steam/finalize', { order: body.order })).toEqual([200, fin]);
    expect(s.calls.filter((c) => c.url.includes('FinalizeTxn'))).toHaveLength(1);
  });

  it('refuses a stranger\'s ticket, unknown products and unauthorised orders', async () => {
    const s = fakeSteam(false);
    const handle = createSteamStore({ key: 'KEY', appId: 480, fetchFn: s.fetchFn });
    expect((await handle('POST', '/steam/init', { steamId: STEAM_ID, ticket: 'ffff', product: 'coins_small' }))[0]).toBe(403);
    expect((await handle('POST', '/steam/init', { steamId: STEAM_ID, ticket: 'abc123', product: 'free_money' }))[0]).toBe(400);
    const [, { order }] = await handle('POST', '/steam/init', { steamId: STEAM_ID, ticket: 'abc123', product: 'coins_small' });
    expect(s.calls.find((c) => c.url.includes('InitTxn'))!.url).not.toContain('Sandbox');
    expect((await handle('POST', '/steam/finalize', { order }))[0]).toBe(402);
    expect((await handle('POST', '/steam/finalize', { order: '123' }))[0]).toBe(404);
  });
});
