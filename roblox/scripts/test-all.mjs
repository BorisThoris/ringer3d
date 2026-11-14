// The whole test loop in one command: build a test place (every script also packed as a module so
// it can be compiled in the cloud), upload it as a Saved (unpublished) version, then run every
// cloud test suite against that version on Roblox's own servers (Open Cloud Luau Execution).
// Exits non-zero if anything fails.
//   node roblox/scripts/test-all.mjs [suite ...]      (default: all suites below)
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SUITES = process.argv.slice(2).length ? process.argv.slice(2) : ['smoke', 'look', 'client', 'marbles', 'sim'];
const run = (args, env = {}) =>
  execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });

console.log(run(['roblox/scripts/build.mjs', 'roblox/build/check.rbxlx'], { CHECK: '1' }).trim());
const published = run(['roblox/scripts/publish.mjs', 'roblox/build/check.rbxlx', 'Saved']);
const version = published.match(/version (\d+)/)?.[1];
if (!version) {
  console.error('could not read the saved version from:\n' + published);
  process.exit(1);
}
console.log(`testing saved version ${version}`);

let failed = 0;
for (const suite of SUITES) {
  let out = '';
  let ok = false;
  try {
    out = run(['roblox/scripts/run-luau.mjs', `roblox/tests/${suite}.luau`, version], { LUAU_TIMEOUT: '300s' });
    // A suite passes when its task completes, nothing printed FAIL, and it returned PASS (or,
    // for the parity suites, says its parity holds).
    ok = /state COMPLETE/.test(out) && !/\bFAIL\b/.test(out.replace(/"results":\[.*$/s, ''));
  } catch (e) {
    out = String(e.stdout ?? '') + String(e.stderr ?? e.message);
  }
  const summary = out.match(/\d+ checks, \d+ failed|parity holds/)?.[0] ?? (ok ? 'passed' : 'failed');
  console.log(`${ok ? 'PASS' : 'FAIL'} ${suite}: ${summary}`);
  if (!ok) {
    failed++;
    console.log(out.split('\n').filter((l) => /FAIL|error|Error/.test(l)).slice(0, 20).join('\n'));
  }
}
process.exit(failed ? 1 : 0);
