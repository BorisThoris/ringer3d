// Upload Home page thumbnails (own page, closed afterwards), then read back what's there.
const fs = require('fs');
module.exports = async (ctx, _page, out, log) => {
  const U = 10773508905;
  const files = (process.env.FILES || '').split(',').filter(Boolean).map((f) => `D:/agent-work/ringer3d/roblox-art/final2/${f}`);
  const page = await ctx.newPage();
  try {
    page.on('response', async (r) => {
      if (/thumbnail-personalization/.test(r.url()) && r.request().method() !== 'GET') log('RESP', r.request().method(), r.status(), r.url().slice(0, 160), (await r.text().catch(() => '')).slice(0, 200));
    });
    await page.goto(`https://create.roblox.com/dashboard/creations/experiences/${U}/places/114836219465070/thumbnails`);
    await page.waitForTimeout(12000);
    if (files.length) {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), page.getByRole('button', { name: /upload thumbnails/i }).first().click()]);
      await chooser.setFiles(files);
      log('uploading', files.length);
      await page.waitForTimeout(20000);
    }
    const list = await (await ctx.request.get(`https://apis.roblox.com/thumbnail-personalization-api/v1/universe/${U}/thumbnails?limit=200`)).text();
    log('list', list.slice(0, 1500));
    fs.writeFileSync(`${out}/list.json`, list);
    fs.writeFileSync(`${out}/page.txt`, await page.evaluate(() => document.body.innerText));
  } finally {
    await page.close();
  }
};
