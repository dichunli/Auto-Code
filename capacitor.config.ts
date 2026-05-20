import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: "com.autorepair.app",
  appName: "汽修管家",
  webDir: ".next",
  server: {
    url: "http://192.168.1.75:3000",
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
