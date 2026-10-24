/**
 * Haptics: native taps in the iOS/Android apps (Capacitor), the vibration
 * API in mobile browsers, nothing on desktop.
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

let enabled = true;

export function setHaptics(on: boolean): void {
  enabled = on;
}

export function tap(strength: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (!enabled) return;
  if (Capacitor.isNativePlatform()) {
    const style = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }[strength];
    void Haptics.impact({ style }).catch(() => {});
    return;
  }
  try {
    navigator.vibrate?.({ light: 8, medium: 16, heavy: 30 }[strength]);
  } catch {
    /* not supported */
  }
}
