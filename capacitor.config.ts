import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.boristhoris.ringer3d',
  appName: 'Ringer 3D',
  webDir: 'dist',
  backgroundColor: '#121a33',
  ios: {
    contentInset: 'never',
    backgroundColor: '#121a33',
  },
  android: {
    backgroundColor: '#121a33',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
    },
  },
};

export default config;
