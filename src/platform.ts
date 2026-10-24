import { Capacitor } from '@capacitor/core';

/** Thin layer over native features so the same build runs on web, iOS, Android and desktop. */
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'web' | 'ios' | 'android'
export const isDesktopShell = '__TAURI_INTERNALS__' in globalThis;

type HapticsModule = typeof import('@capacitor/haptics');
let haptics: HapticsModule | null = null;

export async function initPlatform() {
  if (!isNative) return;
  haptics = await import('@capacitor/haptics');
  try {
    const { StatusBar } = await import('@capacitor/status-bar');
    await StatusBar.hide();
  } catch {
    /* not available */
  }
}

/** Short tactile tick; strength 0..1. */
export function vibrate(ms: number) {
  if (haptics) {
    const { Haptics, ImpactStyle } = haptics;
    void Haptics.impact({ style: ms > 20 ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {});
    return;
  }
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}
