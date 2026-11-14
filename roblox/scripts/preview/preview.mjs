// Scene previews without Studio. Step 1 (this script): build each scene on a Roblox cloud server
// from a saved place version and dump it (dump.luau). Step 2 (render.mjs, run in the isolated
// window station): rebuild the dumps in three.js and screenshot them from fixed cameras.
//   node roblox/scripts/preview/preview.mjs <placeVersion> <outDir> [scene ...]
// Scenes: lobby, the field ids (desk culdesac grass sand ice gravel minigolf), race:<name>.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLuau } from '../cloud.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [version, outDir, ...asked] = process.argv.slice(2);
if (!version || !outDir) {
  console.error('usage: preview.mjs <placeVersion> <outDir> [scene ...]');
  process.exit(2);
}
const scenes = asked.length ? asked : ['lobby', 'desk', 'culdesac', 'grass', 'sand', 'ice', 'gravel', 'minigolf'];
const template = readFileSync(join(here, 'dump.luau'), 'utf8');
mkdirSync(outDir, { recursive: true });

for (const scene of scenes) {
  const dump = {};
  for (const part of ['parts', 'terrain']) {
    const script = template.replace('%SCENE%', scene).replace('%PART%', part);
    const r = await runLuau(script, version, '240s');
    if (r.state !== 'COMPLETE') {
      console.error(`${scene} ${part}: ${r.state}`, JSON.stringify(r.error ?? ''), r.logs.slice(-5));
      process.exit(1);
    }
    Object.assign(dump, JSON.parse(r.output.results[0]));
  }
  const file = join(outDir, `${scene.replace(':', '-')}.json`);
  writeFileSync(file, JSON.stringify(dump));
  console.log(`${scene}: ${(dump.parts ?? []).length} parts, ${(dump.terrain?.cols ?? []).length} terrain columns -> ${file}`);
}
