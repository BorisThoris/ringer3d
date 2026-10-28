// node roblox/scripts/publish.mjs <place.rbxlx> [Saved|Published]
import { publishPlace } from './cloud.mjs';

const [file, type = 'Published'] = process.argv.slice(2);
const r = await publishPlace(file, type);
console.log(`${type} version ${r.versionNumber}`);
