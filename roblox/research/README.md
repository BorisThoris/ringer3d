# Research behind the store page and the look

## Name and store page (2026-10-28)

- `competitors.mjs` → `competitors.txt`: Roblox search results for our keywords. "marble" returns
  races and slides only (Steal An Egg, Huge Marble Slide, BE A BALL): no marble shooting game.
  Nobody searches "ringer".
- `genres.mjs` → `genres.txt`: genres of the nearest games. "Duels" is a genre word of its own;
  the closest game, "[UPD] 8 Ball Duels", sits in Sports & Racing > Sports with ~3,800 playing.
- So: title `[🎃] Marble DUELS 🔮` (seasonal bracket tag, genre word in capitals), keywords in the
  first 100 characters of the description, genre Sports, emoji-first item names. Sources:
  Roblox Creator Docs on icons and thumbnails, rolearn.dev on title/description/tags.

## The look (2026-10-29)

Roblox doesn't publish per-game revenue. Proxies used: rowatcher's Q1 2026 estimates of the
top earners (Rivals, Blox Fruits, Brookhaven, Adopt Me!, Pet Simulator 99, Steal a Brainrot,
Fisch, Dress to Impress) and Roblox's "Top Playing Now" sort (`style/fetch.mjs` pulls their
icons and thumbnails; `style/thumbs1.jpg`, `thumbs2.jpg`, `icons.jpg` are the sheets).

What they share, and what Marble DUELS took from it:

| Seen in the top earners | In the game |
| --- | --- |
| Flat, saturated toy colours in smooth plastic, no realistic textures | Fields and lobby in SmoothPlastic toy colours (`Config.ARENAS`, `Main`) |
| Bright sky, punchy colour | `lighting.json`: Future, bloom, saturation and contrast |
| A cute mascot with big eyes | The giant Jack-o'-Marble with a face over the lobby |
| Collectibles on show with their rarity | Showcase pedestals with name + rarity labels in rarity colours |
| Huge outlined text, gold / rainbow numbers | MARBLE DUELS sign; gold gradient coins with commas and "+N" pops |
| Icon buttons, red "!" when something waits | Side buttons with icons; red badge on Daily |

`screens/before.jpg` and `screens/after.jpg` are real Roblox frames before and after the restyle.
