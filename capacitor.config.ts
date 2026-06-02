import type { CapacitorConfig } from '@capacitor/cli';

/*
 * ========== APP 架构说明 ==========
 *
 * 本项目使用 Next.js App Router，有 middleware、API Routes、Server Actions 等，
 * 不支持 output: 'export' 纯静态导出。因此 APP 必须使用远程服务器模式。
 *
 * 【关键约束】Android WebView 的 getUserMedia() 只在 HTTPS 或 localhost 下工作，
 * HTTP + IP 地址（如 http://192.168.1.75:3000）会被拒绝访问摄像头。
 * 所以 APP 中所有摄像头相关功能（车牌识别、VIN识别、扫码）必须使用 Capacitor
 * 原生插件（@capacitor/camera），不能依赖 WebView 的 getUserMedia()。
 *
 * 改前端代码后只需部署服务器，不需要重新打包 APK。
 * 只有修改 Android 原生代码或安装新插件时才需要重新打包。
 */
const config: CapacitorConfig = {
  appId: "com.autorepair.app",
  appName: "汽修管家",
  webDir: ".next",
  /* 远程服务器模式：APP WebView 连接服务器加载页面 */
  server: {
    url: "http://192.168.1.75:3000",
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
