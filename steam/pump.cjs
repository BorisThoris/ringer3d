// Starts Steam and runs its callback loop. steamworks.js normally does both (init, then
// setInterval(runCallbacks)), but its loop is Steam's "manual dispatch" loop: it consumes every
// finished asynchronous call, and drops the results of calls it didn't make itself. Ours
// (leaderboards, social.cjs) would never arrive. So we start Steam through the same native
// binding and run one shared frame: let Steam take in what arrived, hand our finished calls their
// results, then let steamworks.js dispatch everything else as before.
const path = require('node:path');
const { flat } = require('./flatlib.cjs');

const NATIVE = {
  'win32-x64': 'win64/steamworksjs.win32-x64-msvc.node',
  'linux-x64': 'linux64/steamworksjs.linux-x64-gnu.node',
  'darwin-x64': 'osx/steamworksjs.darwin-x64.node',
  'darwin-arm64': 'osx/steamworksjs.darwin-arm64.node',
};

let native = null;
let timer = null;
let pipe = 0;
let RunFrame = null;
let GetResult = null;
/** call handle (bigint) -> { size, expected, resolve, reject, until } */
const pending = new Map();

function binding() {
  if (native) return native;
  const rel = NATIVE[`${process.platform}-${process.arch}`];
  if (!rel) throw new Error(`Steam: unsupported platform ${process.platform}-${process.arch}`);
  native = require(path.join(path.dirname(require.resolve('steamworks.js')), 'dist', rel));
  return native;
}

function frame() {
  if (pending.size && RunFrame) {
    RunFrame(pipe);
    const now = Date.now();
    for (const [call, p] of pending) {
      const buf = Buffer.alloc(p.size);
      const failed = [false];
      if (GetResult(pipe, call, buf, p.size, p.expected, failed)) {
        pending.delete(call);
        if (failed[0]) p.reject(new Error(`${p.what}: the call failed`));
        else p.resolve(buf);
      } else if (now > p.until) {
        pending.delete(call);
        p.reject(new Error(`${p.what}: Steam did not answer`));
      }
    }
  }
  binding().runCallbacks();
}

/** Initialise Steam for `appId` and start the loop; returns steamworks.js's client API. */
function initSteam(appId) {
  const { init, runCallbacks: _r, restartAppIfNecessary: _x, ...api } = binding();
  init(appId);
  try {
    const { f } = flat();
    pipe = f('int32 SteamAPI_GetHSteamPipe()')();
    RunFrame = f('void SteamAPI_ManualDispatch_RunFrame(int32 pipe)');
    GetResult = f('bool SteamAPI_ManualDispatch_GetAPICallResult(int32 pipe, uint64 call, void* out, int size, int expected, _Out_ bool* failed)');
  } catch {
    // No koffi: steamworks.js features still work; our asynchronous calls won't.
  }
  clearInterval(timer);
  timer = setInterval(frame, 1000 / 30);
  return api;
}

/** The bytes of an asynchronous Steam call's result (`expected` = its callback id). */
function callResult(call, size, expected, what = 'Steam call') {
  if (!GetResult) return Promise.reject(new Error(`${what}: koffi unavailable`));
  if (!call || BigInt(call) === 0n) return Promise.reject(new Error(`${what}: Steam refused the call`));
  return new Promise((resolve, reject) => pending.set(BigInt(call), { size, expected, resolve, reject, what, until: Date.now() + 15000 }));
}

function stopSteam() {
  clearInterval(timer);
  timer = null;
  for (const p of pending.values()) p.reject(new Error(`${p.what}: Steam stopped`));
  pending.clear();
}

module.exports = { initSteam, callResult, stopSteam };
