// Screenshot every shooter in the live main build's quick-match picker.
//   node scripts/peek-live-taws.mjs <url> <outDir>
import { join } from 'node:path';
import { launch, logger } from './lib.mjs';

const [url, out] = process.argv.slice(2);
const say = logger(out);
const NAMES = ['Ember', 'Tide', 'Pip', 'Jade', 'Volt', 'Rime', 'Ironside', 'Nova', 'Obsidian'];
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
page.setDefaultTimeout(180000);
page.on('pageerror', (e) => say('pageerror', e.message));
await page.goto(url);
await page.waitForTimeout(10000);
await page.getByRole('button', { name: /^Quick match/i }).first().evaluate((el) => el.click());
await page.waitForTimeout(6000);
const preview = page.locator('.taw-preview').first();
await preview.scrollIntoViewIfNeeded();
for (const name of NAMES) {
  // The picker sits right after the preview; pick by accessible name.
  const opt = page.locator('.taw-preview ~ *').getByRole('button', { name: new RegExp(`^${name}`, 'i') }).first();
  if (!(await opt.count())) {
    say('no option', name);
    continue;
  }
  await opt.evaluate((el) => el.click());
  await page.waitForTimeout(3500);
  await preview.screenshot({ path: join(out, `taw-${name.toLowerCase()}.png`) });
  say('shot', name);
}
await page.screenshot({ path: join(out, 'quick-screen.png'), fullPage: true });
await browser.close();
