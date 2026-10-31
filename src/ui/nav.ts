import { useEffect, useRef } from 'react';

/**
 * Back, the way phones expect it. Every way of going back (Android's back button and gesture,
 * the browser's back, Esc, the ‹ in a screen's header) ends up in goBack(), which asks:
 *   1. the newest open layer (a sheet, a dialog, the pause menu) to close, else
 *   2. the screen stack (App) to step back, else
 *   3. nobody: the app is on its home screen, and the system takes over (Android backgrounds
 *      the app, a browser leaves the page).
 *
 * Android: MainActivity sends the system back here (window.ringerBack) and moves the app to the
 * background when it answers 'exit'. Browsers: while there is somewhere to go back to, one guard
 * entry sits in the history; the browser's back consumes it, and it is put back afterwards.
 */

type Layer = { id: number; back: () => void };
const layers: Layer[] = [];
let nextId = 1;
let base: { can: () => boolean; back: () => boolean } = { can: () => false, back: () => false };

/** The screen stack's own back (App). */
export function setBaseBack(can: () => boolean, back: () => boolean) {
  base = { can, back };
  scheduleSync();
}

export function canGoBack(): boolean {
  return layers.length > 0 || base.can();
}

/** Goes back one step; false when there was nowhere to go (home screen). */
export function goBack(): boolean {
  const top = layers[layers.length - 1];
  let done = false;
  if (top) {
    top.back();
    done = true;
  } else done = base.back();
  scheduleSync();
  return done;
}

/** While `active`, back calls `onBack` (closing a sheet, resuming a paused match...). */
export function useBack(active: boolean, onBack: () => void) {
  const fn = useRef(onBack);
  fn.current = onBack;
  useEffect(() => {
    if (!active) return;
    const layer: Layer = { id: nextId++, back: () => fn.current() };
    layers.push(layer);
    scheduleSync();
    return () => {
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
      scheduleSync();
    };
  }, [active]);
}

// ---- Browser history guard ----------------------------------------------------------------
const native = (): boolean => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
let guarded = false;
let ignorePops = 0;
let syncQueued = false;

function scheduleSync() {
  if (syncQueued) return;
  syncQueued = true;
  // After React has applied whatever the back changed.
  setTimeout(() => {
    syncQueued = false;
    syncGuard();
  }, 0);
}

function syncGuard() {
  if (native()) return;
  const want = canGoBack();
  if (want && !guarded) {
    history.pushState({ ringerGuard: true }, '');
    guarded = true;
  } else if (!want && guarded) {
    // Home again by the app's own buttons: take the guard back out, quietly.
    guarded = false;
    ignorePops++;
    history.back();
  }
}

let installed = false;
/** Wires the system back sources to goBack(). `typing` says when Esc belongs to the game. */
export function installBack(escBelongsToGame: () => boolean) {
  if (installed) return;
  installed = true;
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) {
      ignorePops--;
      return;
    }
    guarded = false;
    goBack();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || escBelongsToGame()) return;
    if (goBack()) e.preventDefault();
  });
  // Android's back button and back gesture (MainActivity).
  (window as unknown as { ringerBack: () => string }).ringerBack = () => (goBack() ? 'handled' : 'exit');
}
