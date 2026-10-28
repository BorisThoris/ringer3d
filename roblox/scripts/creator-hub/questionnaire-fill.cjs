// Walk the content-rating questionnaire with the answers decided for Ringer 3D, one page at a
// time. Stops (without submitting) at any question it has no rule for, and before the final
// submit, dumping that page so the answer can be decided deliberately.
// Set SUBMIT=1 to press the final submit once the summary has been reviewed.
const fs = require('fs');

// First matching rule wins: [question text pattern, answer button/label pattern].
const RULES = [
  [/violen/i, /^No$/],
  [/blood/i, /^No$/],
  [/fear|horror|scary/i, /^No$/],
  [/crude humor/i, /^No$/],
  [/gambling/i, /^No$/],
  [/social hangout/i, /^No$/],
  [/free-?form user creation|user creation/i, /^No$/],
  [/sensitive/i, /^No$/],
  [/cross-experience|other experiences|teleport/i, /^No$/],
  [/\bAI\b|artificial|generative|chatbot/i, /^No$/],
  [/ArePaidRandomItemsRestricted/i, /^Yes$/],
  [/random/i, /^Yes$/],
  [/trad/i, /^No$/],
  [/media sharing|share media|photos|videos/i, /^No$/],
  [/continuous|autoplay|automatically|content feeds/i, /^No$/],
];

module.exports = async (ctx, page, out, log) => {
  const U = 10773508905;
  await page.goto(`https://create.roblox.com/dashboard/creations/experiences/${U}/content-rating`);
  await page.waitForTimeout(20000);
  const start = page.getByRole('button', { name: /^(start|resume|edit|retake|continue questionnaire)$/i });
  if (await start.count()) {
    await start.first().click();
    await page.waitForTimeout(6000);
  }
  let lastQ = '';
  let sameQ = 0;
  for (let step = 1; step <= 40; step++) {
    const text = await page.evaluate(() => (document.querySelector('main') || document.body).innerText);
    fs.writeFileSync(`${out}/step${step}.txt`, text);
    // The question is the line ending in "?" nearest the bottom of the form.
    const qs = text.split('\n').filter((l) => /\?\s*$/.test(l.trim()));
    const q = qs[qs.length - 1] || '';
    log('step', step, 'Q:', q.slice(0, 160));
    const submit = page.getByRole('button', { name: /^(submit|submit and publish|confirm|confirm rating)$/i });
    if (await submit.count()) {
      await page.screenshot({ path: `${out}/summary.png`, fullPage: true });
      if (process.env.SUBMIT) {
        await submit.first().click();
        await page.waitForTimeout(8000);
        log('SUBMITTED');
        fs.writeFileSync(`${out}/after.txt`, await page.evaluate(() => (document.querySelector('main') || document.body).innerText));
      } else log('at submit: stopping for review');
      return;
    }
    const rule = RULES.find(([re]) => re.test(q));
    if (!rule) {
      await page.screenshot({ path: `${out}/unknown-${step}.png`, fullPage: true });
      log('no rule for this question: stopping');
      return;
    }
    // Choose the answer: the radio button itself (Radix radios ignore clicks on their label).
    let clicked = false;
    // A follow-up shares the page with its parent question: answer in the last group, which is
    // the question read above.
    const radios = page.getByRole('radiogroup').last().getByRole('radio', { name: rule[1] });
    if (await radios.count()) {
      await radios.first().click();
      await page.waitForTimeout(700);
      const cont = page.getByRole('button', { name: /^continue$/i }).first();
      clicked = true;
      log('  answer:', String(rule[1]), 'checked', clicked);
    }
    if (q === lastQ && ++sameQ >= 2) {
      await page.screenshot({ path: `${out}/stuck-${step}.png`, fullPage: true });
      log('the same question keeps coming back: stopping');
      return;
    }
    if (q !== lastQ) sameQ = 0;
    lastQ = q;
    const cont = page.getByRole('button', { name: /^(continue|preview rating)$/i }).first();
    if (await cont.isEnabled().catch(() => false)) await cont.click();
    await page.waitForTimeout(3500);
  }
};
