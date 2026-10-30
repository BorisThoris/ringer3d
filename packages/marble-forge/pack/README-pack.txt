MARBLE FORGE - VOLUME 1
Collectible glass marbles, procedurally generated and rendered

{{COUNT}} marbles: {{TIERS}}, of which {{FX}} hold a phenomenon.

WHAT'S INSIDE
  png/1024, png/512, png/256, png/128, png/64
      Every marble as a transparent PNG at five sizes. The glass keeps its tint and its
      refraction (rendered over black and white and matted), so it sits on any background.
  glb/
      Every marble as a 3D model (binary glTF, radius 1 unit), with physically based glass:
      transmission, iridescence, sheen and clearcoat travel as standard glTF extensions and
      load in Blender, Godot 4, Unity (glTFast), Unreal 5 and three.js. The animated
      phenomena are shaders and have no glTF form: in the models they are a glowing core.
  phenomena/<marble>/
      For every phenomenon marble: a 32-frame turntable sprite sheet (8 across, 256 px,
      12 fps, transparent), plus a GIF and an MP4 of it.
  sheets/icons-128.png + icons-128.json
      All marbles in one 128 px atlas, 16 across, with each one's frame rectangle.
  manifest.json, marbles.csv
      Every marble's name, rarity, pattern, finish, colour scheme, colours, glass clarity,
      glow, sparkle and phenomenon, so you can build loot tables and shops from data.

RARITY
  Common, Rare, Epic, Legendary and Mythic, as the generator rolls them: the higher the tier,
  the rarer the patterns, finishes and glow it may have.

PHENOMENA
  Aurora   northern lights drifting through the glass
  Inferno  a fire that never goes out
  Void     a black hole wrapped in its own burning disc
  Storm    a thundercloud, and lightning inside it
  Geode    crystals growing inward from the shell
  Starfall stars orbiting a tiny nebula

NAMES
  Every file is numbered and named after its marble (e.g. 001-ruby-swirl.png). The names come
  from the generator; rename freely.

WANT MORE?
  These are a few hundred of the millions of marbles the generator makes. The Marble Forge
  generator (sold separately) makes any number of them, live in three.js or as files, with
  wear, float values and one-in-fifty Shinies for collectible systems.

LICENCE
  See LICENSE.txt.
