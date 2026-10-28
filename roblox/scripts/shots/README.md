# In-game screenshots without touching the desktop

Studio renders on the GPU inside a private window station (`Start-IsolatedProcess.ps1`), but a
window capture there is solid black. Roblox's own `CaptureService` works:

1. `node scripts/build.mjs`, then `node scripts/shots/mark.cjs build/ringer.rbxlx <dir>/shots.rbxlx`
   (adds `ReplicatedStorage.ShotRig`; the plugin does nothing in any other place).
2. Copy `RingerShotRig.lua` to `%LOCALAPPDATA%\Roblox\Plugins\`.
3. `pass.ps1 -Name <set>` (paths at its top point at the shots folder): Studio opens the place in the
   private station, the plugin runs it, stages a bot match on every field, holds a scripted camera
   and captures; the PNGs land in `%LOCALAPPDATA%\Roblox\tmp-capture-storage` and are copied out
   with their labels.
4. Delete the plugin afterwards.

The rig runs without a player, so the HUD is not in the shots.
