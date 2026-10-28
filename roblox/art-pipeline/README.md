# Store art pipeline

The icon, thumbnails and item images in `../store/art/` were made on this PC, offline:

1. `gen_sdxl.py <out>`: background art with Stable Diffusion XL base from `D:/hf-cache`. The
   weights are read sequentially once first, which keeps loading fast on the hard drive.
   `gen.py` / `gen2.py` are the same jobs for Z-Image-Turbo (much slower to load here).
2. `icon_variants.py`: more seeds for the icon; the pick has one subject and no text.
3. `thumbs.mjs`: 1920x1080 thumbnails: art plus a big outlined headline at the top (the bottom
   stays clear, Roblox lays player counts over it), and the 512 px icon.
4. `finish.mjs`: badge, pass and product images.

The scripts carry the paths they were run with (`D:/agent-work/ringer3d/roblox-art`); point them
at a folder of your own. Uploading is in `../scripts/creator-hub/` and `../scripts/thumbnails.mjs`.

The thumbnails are artwork, not screenshots; `../store/art/ingame/` has real frames of the game
(see `../scripts/shots/`).
