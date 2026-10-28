// Create an experience from the Baseplate template through the endpoint Studio uses, with the
// browser's own session (no keys). The new experience is private until made public.
module.exports = async (ctx, page, out, log) => {
  await page.goto('https://create.roblox.com/dashboard/creations');
  await page.waitForTimeout(3000);
  const res = await page.evaluate(async () => {
    const call = async (url, body, token) => {
      const r = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) },
        body: JSON.stringify(body),
      });
      return { status: r.status, token: r.headers.get('x-csrf-token'), text: await r.text() };
    };
    const url = 'https://apis.roblox.com/universes/v1/universes/create';
    const body = { templatePlaceId: 95206881 };
    let r = await call(url, body);
    if (r.status === 403 && r.token) r = await call(url, body, r.token);
    return { status: r.status, text: r.text.slice(0, 500) };
  });
  log('create', res.status, res.text);
};
