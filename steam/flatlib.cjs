// Steam's flat C API (steam_api64.dll) through koffi, for what steamworks.js doesn't bind:
// inventory, leaderboards, friends, the timeline. Steam must already be initialised
// (steamworks.init): the DLL is the one steamworks.js loaded, so both share its state.
const fs = require('node:fs');
const path = require('node:path');

let cached = null;

function dllPath() {
  const candidates = [
    path.join(path.dirname(require.resolve('steamworks.js')), 'dist', 'win64', 'steam_api64.dll'),
    path.join(path.dirname(process.execPath), 'steam_api64.dll'),
  ];
  const p = candidates.find((c) => fs.existsSync(c));
  if (!p) throw new Error('steam_api64.dll not found');
  return p;
}

/** { koffi, f(sig), tryF(sig) }: f throws on a missing export, tryF returns null. */
function flat() {
  if (cached) return cached;
  const koffi = require('koffi');
  const lib = koffi.load(dllPath());
  const f = (sig) => lib.func(sig);
  const tryF = (sig) => {
    try {
      return lib.func(sig);
    } catch {
      return null;
    }
  };
  cached = { koffi, f, tryF };
  return cached;
}

/** Read a C string through a size-query-then-fill call: read(buf|null, [n]) -> bool. */
function readString(read) {
  const n = [0];
  if (!read(null, n) || !n[0]) return '';
  const buf = Buffer.alloc(n[0]);
  return read(buf, n) ? buf.toString('utf8').replace(/\0.*$/s, '') : '';
}

module.exports = { flat, readString };
