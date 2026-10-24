import type { CapacitorConfig } from '@capacitor/cli';

// iOS and Android wrap the same web build. Online play needs a reachable
// server: build with VITE_LOBBY_URL=wss://your-host/lobby, or players can
// type a server in the Online screen.
const config: CapacitorConfig = {
  appId: 'com.boristhoris.ringer3d',
  appName: 'Ringer 3D',
  webDir: 'dist',
  backgroundColor: '#0b0f1a',
  android: { allowMixedContent: true },
  ios: { contentInset: 'never' },
};

export default config;
