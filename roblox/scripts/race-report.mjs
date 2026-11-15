// Run the playthrough simulation (race-report.luau) on a saved place version and print the report.
//   node roblox/scripts/race-report.mjs <placeVersion> [out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLuau } from './cloud.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [version, out] = process.argv.slice(2);
const r = await runLuau(readFileSync(join(here, 'race-report.luau'), 'utf8'), version, '300s');
if (r.state !== 'COMPLETE') {
  console.error(r.state, JSON.stringify(r.error ?? ''), r.logs.slice(-5));
  process.exit(1);
}
const rep = JSON.parse(r.output.results[0]);
if (out) writeFileSync(out, JSON.stringify(rep, null, 2));
const t = (x) => (x == null ? '   -  ' : x.toFixed(1).padStart(6));
console.log(`${rep.runs} runs\n`);
console.log('profile      finish  median   best  worst  respawns  gold silver bronze none');
for (const p of rep.profiles) {
  console.log(`${p.name.padEnd(12)} ${(p.finishRate * 100).toFixed(0).padStart(5)}%  ${t(p.median)} ${t(p.best)} ${t(p.worst)}   ${p.respawnsPerRun.toFixed(2).padStart(6)}   ${String(p.medals.Gold).padStart(4)} ${String(p.medals.Silver).padStart(6)} ${String(p.medals.Bronze).padStart(6)} ${String(p.medals.none).padStart(4)}`);
}
console.log('\nsection            time%  bumps/visit  falls  air%  top speed');
const total = rep.sections.reduce((a, s) => a + s.ticks, 0);
for (const s of rep.sections) {
  console.log(`${s.name.padEnd(18)} ${((s.ticks / total) * 100).toFixed(1).padStart(5)}  ${(s.bumps / Math.max(1, s.visits)).toFixed(2).padStart(11)}  ${String(s.falls).padStart(5)}  ${((s.air / Math.max(1, s.ticks)) * 100).toFixed(1).padStart(4)}  ${s.topSpeed.toFixed(0).padStart(9)}`);
}

// The gate (test-all's "playthrough" suite): every kind of driver finishes every run, nobody needs
// more than one respawn a run on average, and no section bounces drivers off its walls.
const checks = [];
for (const p of rep.profiles) {
  checks.push([`${p.name} always finishes`, p.finishRate === 1]);
  checks.push([`${p.name} respawns under 1 a run`, p.respawnsPerRun < 1]);
}
for (const s of rep.sections) checks.push([`${s.name} under 2 bumps a visit`, s.bumps / Math.max(1, s.visits) < 2]);
checks.push(['the expert wins gold', rep.profiles[0].medals.Gold === 8]);
const bad = checks.filter(([, ok]) => !ok);
for (const [name] of bad) console.log(`FAIL ${name}`);
console.log(`\nplaythrough: ${checks.length} checks, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
