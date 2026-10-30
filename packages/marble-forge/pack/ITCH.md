# itch.io pages (drafts)

Two products, plus the free web demo that sells both. Media comes from `npm run pack`
(`<OUT>/store/`); uploads are the zips it builds.

---

## 1. Marble Forge Vol. 1: Collectible Glass Marbles (asset pack)

- **Kind:** Assets › 2D / 3D, tags: `marbles`, `glass`, `collectibles`, `loot`, `icons`,
  `items`, `sprites`, `3d-models`, `gltf`, `procedural`
- **Price:** suggested $9.99 (pay what you want above it)
- **Upload:** `MarbleForge-Vol1.zip`
- **Cover:** `store/cover-630x500.png` · **Banner:** `store/banner-1920x480.png`
- **Screenshots:** `store/sheet-phenomena.png`, then a sheet per tier, `store/phenomena.gif`

### Description

**Over 300 one-of-a-kind glass marbles for your game's loot, shop, inventory or collection
screen. Every one rendered as real refracting glass, in five sizes, with a 3D model.**

Each marble has a rarity (Common, Rare, Epic, Legendary, Mythic) and its own pattern,
finish and colours: cat's-eyes, swirls, onionskins, opals, galaxies with drifting nebulae,
neon, onyx with magma veins, steelies and clearies, in glass, frosted, pearl, metallic,
glitter, holo and prism finishes.

**Phenomena.** Thirty marbles hold something alive inside the glass: an **Aurora**, an
**Inferno**, a **Void** (a black hole in its own burning disc), a **Storm** with lightning, a
**Geode**, or a **Starfall**. Each comes as an animated turntable sprite sheet, GIF and MP4.

**What you get**
- Transparent PNGs at 1024, 512, 256, 128 and 64 px. The glass keeps its tint and
  refraction on any background.
- A GLB model of every marble with physically based glass (transmission, iridescence,
  clearcoat), ready for Godot, Unity, Unreal, Blender and three.js.
- A 128 px icon atlas with its frame data, and a manifest (JSON and CSV) with every marble's
  name, rarity, pattern, finish and colours, so you can build loot tables from data.
- 32-frame turntables of every phenomenon.

Commercial use is fine; see the licence. Made with the **Marble Forge** generator (also on
itch.io), the same one that powers the marble game *Ringer 3D*.

---

## 2. Marble Forge: Procedural Marble Generator (source code)

- **Kind:** Tools, tags: `procedural-generation`, `threejs`, `typescript`, `webgl`,
  `collectibles`, `loot`, `gacha`, `rarity`, `shader`
- **Price:** suggested $24.99
- **Uploads:** `MarbleForge-Generator.zip` (paid); `MarbleForge-Web.zip` as the free in-browser
  Forge (HTML5, "This file will be played in the browser", 1280x820, fullscreen button on)
- **Cover:** `store/cover-630x500.png`

### Description

**Millions of collectible marbles from a single number. A seeded generator and a three.js
renderer, in TypeScript, with the source.**

Every seed is a marble: rarity tier with fixed, showable odds, then a pattern, finish and
colour scheme the tier allows, glass clarity, glow and sparkle, and a generated name. A rare
few (1.8% of rolls, 40% of Mythics) hold a **phenomenon**, a living shader effect inside the
glass.

Built for collectible systems:
- **Instances.** An item id (your inventory's, Steam's) gives a marble its own **wear float**
  from Mint to Chipped, drawn as real scratches and chips, a **pattern number** and a
  one-in-fifty **Shiny**. Store and trade ids; the marble rebuilds from the id anywhere.
- **Stable forever.** New traits are always drawn after old ones, so an owned marble never
  changes. Tested.
- **Runs anywhere.** The generator is pure TypeScript with no DOM: generate on your server,
  render on the client. Reference fixtures make porting it to another language easy (it has
  been ported to Luau).
- **The renderer:** refracting glass, interiors built from geometry, six ray-marched
  phenomena, nebula and magma interiors, wear, a close-up preview with drag-to-spin, and
  export to transparent PNG and GLB.
- **The Forge:** the page in the demo above, to roll, inspect and download marbles.
- **The pack builder:** renders a whole asset pack (PNGs, GLBs, atlases, turntables, a
  manifest) headless. Marble Forge Vol. 1 was made with it.

Needs Node 20+, three.js r160+, and Chrome for the pack builder. The licence lets you ship
it in your products; it doesn't let you resell the source or generated packs (see LICENSE).

---

## Before publishing

- Read and adjust `LICENSE-pack.txt` and `LICENSE-source.txt` (copyright name, terms).
- itch.io asks about AI: the marbles are procedural (no generative-AI imagery); the code was
  written with heavy AI assistance, so say so in the AI disclosure.
- Prices above are suggestions.
