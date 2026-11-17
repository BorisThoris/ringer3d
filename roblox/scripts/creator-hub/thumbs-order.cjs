// Re-send the page order (Roblox drops an order sent while new uploads are still in moderation).
// Ids are upload ids as digit strings, written raw (they pass 2^53).
const U = 10773508905;
const ORDER = [
  '7332489437186282', '6311916960185439', '6435997331567651', '5034640734460528', // round 5: duel, mythic, aura, knockout
  '6130115191835091', '9436793176752201', '6064094803477492', // round 6: race, air, fields
];
module.exports = async (ctx, page, out, log) => {
  let token = null;
  for (let i = 0; i < 2; i++) {
    const r = await ctx.request.fetch(`https://develop.roblox.com/v1/universes/${U}/thumbnails/order`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) }, data: `{"thumbnailIds":[${ORDER.join(',')}]}` });
    if (r.status() === 403 && r.headers()['x-csrf-token'] && r.headers()['x-csrf-token'] !== token) {
      token = r.headers()['x-csrf-token'];
      continue;
    }
    log('order', r.status(), (await r.text()).slice(0, 200));
    break;
  }
};
