# Marble Forge

Procedural collectible marbles for games: a seeded generator and a three.js renderer.

Every seed is a marble. The generator rolls a rarity tier with fixed odds, then everything the
tier allows: a pattern (cat's-eye, swirl, onionskin, opal, galaxy, neon, onyx, steelie, clay,
clearie), a finish (glass, frosted, pearl, metallic, glitter, holo, prism), a colour scheme off
the colour wheel, and glass clarity, glow and sparkle. A rare few hold a phenomenon: a living
effect inside the glass (Aurora, Inferno, Void, Storm, Geode, Starfall). Millions of distinct
marbles, every one with a name ("Inferno Indigo Comet"), all from one 32-bit number.

For collectible systems there is a second layer: an instance id (an inventory item id, a uid
you mint) gives a marble its own wear float (Mint to Chipped, shown as real scratches and
chips on the glass), a pattern number 0-999 and a one-in-fifty Shiny roll. The same id always
gives the same marble, on any machine, so you store and trade ids, never images.

Every marble also has surface flaws from the furnace, from its id alone (`surfaceFlaws(id)`):
orange peel, the shear seam, burst-bubble pits, fingerprints, a trail of seed bubbles inside, now
and then an unmelted stone, and one in 25 comes out Flawless. The renderer draws them as a normal
map (so they bend the light through the glass) and a roughness map, with the wear marks on top;
both export in the GLB. Pass `flaws: false` in the look to turn them off.

Made for and used in Ringer 3D, a marble game: the Marble Bags, Marble Book and Steam
inventory there all run on this package.

## What's in the box

| | |
|---|---|
| `src/` | The generator. Pure TypeScript, no DOM and no three.js: runs in Node, browsers, workers and on a game server. |
| `src/three/` | The renderer: real refracting glass, interiors built from geometry, the phenomena as animated shaders, wear marks, a close-up preview, PNG and GLB export. |
| `forge/` | The Forge: a web page to roll, inspect and download marbles. |
| `scripts/pack.mjs` | Renders a whole asset pack: PNGs, GLBs, sprite sheets, turntables, a manifest. |
| `scripts/qa-forge.mjs` | Renders one marble of every phenomenon, for a quick look. |

## Quick start

```bash
npm install
npm run dev        # the Forge at http://localhost:5173
```

```ts
import { generateMarble, mintCollectible, marbleLook } from 'marble-forge';
import { buildMarble, advanceMarbles } from 'marble-forge/three';

const m = generateMarble(1234);          // a marble from a seed: name, tier, colours...
const myth = generateMarble(99, 'Mythic'); // or force the tier (a reward, a drop)
const c = mintCollectible('Lfa21b7c09e4d3a11'); // an instance: wear float, pattern, Shiny

// In a three.js scene: radius 0.5, high quality.
const { group, caustic, contact } = buildMarble({ ...marbleLook(c.marble), wear: c.float, shiny: c.shiny }, 0.5, 'high');
scene.add(group);
// Once per frame, so the phenomena move:
advanceMarbles();
```

`marbleFixtures()` returns reference marbles, for checking a port of the generator to another
language (Ringer 3D's Roblox build runs a line-for-line Luau copy).

## Exports

`snapshot(look, { size, background: 'transparent', time, turn })` renders one marble to a
canvas. Transparent output keeps the glass's tint: the marble is rendered over black and over
white and the difference is the alpha. `exportGlb(look)` gives a binary glTF with standard PBR
glass (transmission, iridescence, sheen, clearcoat as glTF extensions).

From the Forge page, or headless through `window.forge` (`roll`, `resolve`, `png`, `pngSet`,
`frames`, `glb`). `npm run pack` builds a full pack that way (needs Chrome; set `CHROME_PATH`).

## Odds

| Tier | Bag odds | Phenomenon chance |
|---|---|---|
| Common | 55% | none |
| Rare | 28% | 1.5% |
| Epic | 12% | 5% |
| Legendary | 4.5% | 15% |
| Mythic | 0.5% | 40% |

Phenomena live in see-through glass only (never clay or steelies), so the overall bag chance is
`phenomenonOdds()` = 1.8%. Shiny is one in 50 on collectibles, any tier.

## Stability

A marble's look is a promise to whoever owns it. New traits are always drawn after the existing
ones, so a seed that made a marble keeps making exactly that marble; the test suite pins a
digest of 3,000 of them.

## Licence

See LICENSE.txt. three.js is MIT, (c) the three.js authors.
