// node roblox/scripts/run-luau.mjs <script.luau> [placeVersion]
// Runs the script on a cloud server for the place (latest published version by default).
import { readFileSync } from 'node:fs';
import { runLuau } from './cloud.mjs';

const [file, version] = process.argv.slice(2);
const r = await runLuau(readFileSync(file, 'utf8'), version, process.env.LUAU_TIMEOUT ?? '120s');
for (const l of r.logs) console.log(typeof l === 'string' ? l : `[${l.messageType ?? ''}] ${l.message}`);
console.log('state', r.state, r.error ? JSON.stringify(r.error) : '', r.output ? JSON.stringify(r.output) : '');
if (r.state !== 'COMPLETE') process.exit(1);
