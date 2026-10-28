// Icons + first two thumbnails of the top-earning / top-playing games, for a style contact sheet.
import { writeFileSync, mkdirSync } from 'node:fs';
const games = { Rivals: 6035872082, 'Blox Fruits': 994732206, Brookhaven: 1686885941, 'Adopt Me': 383310974, 'Pet Sim 99': 3317771874, 'Steal a Brainrot': 7709344486, Fisch: 5750914919, 'Dress to Impress': 5203828273, 'Steal An Egg': 10563114921, '99 Nights': 7326934954, 'Murder Mystery 2': 66654135, 'Grow a Garden': 7436755782 };
mkdirSync('img', { recursive: true });
const ids = Object.values(games).join(',');
const icons = await (await fetch(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${ids}&size=512x512&format=Png`)).json();
const thumbs = await (await fetch(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${ids}&countPerUniverse=2&size=768x432&format=Png`)).json();
for (const [name, id] of Object.entries(games)) {
  const slug = name.replace(/\W+/g, '');
  const ic = icons.data.find((d) => d.targetId === id);
  if (ic?.imageUrl) writeFileSync(`img/${slug}-icon.png`, Buffer.from(await (await fetch(ic.imageUrl)).arrayBuffer()));
  const th = thumbs.data.find((d) => d.universeId === id);
  let n = 0;
  for (const t of th?.thumbnails || []) if (t.imageUrl) writeFileSync(`img/${slug}-thumb${++n}.png`, Buffer.from(await (await fetch(t.imageUrl)).arrayBuffer()));
  console.log(name, ic?.state, (th?.thumbnails || []).map((t) => t.state).join(','));
}
